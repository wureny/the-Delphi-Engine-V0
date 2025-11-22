const express = require('express');
const cors = require('cors');
const path = require('path');
const { randomUUID } = require('crypto');
const {
  agentDefs,
  handleAgentMessage,
  STATIC_EVENT,
  buildMessage,
  annotateOpinions,
  respondFollowUp,
} = require('./agents');
const { buildGlobalView, askFollowUp, buildDecision, llmSynthesize } = require('./blackboard');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const sseClients = new Set();
const tasks = new Map();

let latestState = {
  news: null,
  opinions: null,
  annotations: null,
  globalView: null,
  followUp: null,
  decision: null,
  logs: [],
  agents: agentDefs,
  lastTask: null,
};

function pushEvent(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  sseClients.forEach((res) => res.write(payload));
  latestState.logs = [...(latestState.logs || []), event].slice(-300);
}

app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.get('/api/state', (_req, res) => {
  res.json(latestState);
});

app.get('/api/agents', (_req, res) => {
  res.json(agentDefs);
});

app.get('/v1/agentCard', (_req, res) => {
  res.json(agentDefs.blackboard.card);
});

app.post('/v1/message:send', async (req, res) => {
  try {
    const task = await runDelphiTask(normalizeMessage(req.body?.message, req.body?.task_id), req.body?.task_id);
    res.json({ task });
  } catch (err) {
    console.error(err);
    pushEvent({ type: 'error', ts: Date.now(), data: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/v1/tasks/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json(task);
});

app.get('/v1/tasks', (_req, res) => {
  res.json({ tasks: Array.from(tasks.values()) });
});

app.get('/v1/message:stream', (_req, res) => {
  // Alias of /events for spec-like streaming
  res.redirect('/events');
});

app.post('/api/run', async (req, res) => {
  try {
    const task = await runDelphiTask(normalizeMessage(req.body?.message));
    res.json({ ok: true, task });
  } catch (err) {
    console.error(err);
    pushEvent({ type: 'error', ts: Date.now(), data: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(port, () => {
  console.log(`Delphi Engine running at http://localhost:${port}`);
});

// --- Orchestration logic ---

const STATIC_NEWS = () => ({
  headline: STATIC_EVENT,
  source: 'static_demo',
  fetchedAt: new Date().toISOString(),
});

function nowISO() {
  return new Date().toISOString();
}

function normalizeMessage(message, taskId) {
  if (!message || !message.parts) {
    return {
      message_id: randomUUID(),
      role: 'ROLE_USER',
      parts: [{ text: STATIC_EVENT }],
      task_id: taskId,
      metadata: { ts: nowISO(), generated: true },
    };
  }
  return {
    message_id: message.message_id || randomUUID(),
    role: message.role || 'ROLE_USER',
    parts: message.parts,
    task_id: message.task_id || taskId,
    metadata: { ...(message.metadata || {}), ts: nowISO() },
  };
}

function taskStatus(state, text) {
  return {
    state,
    message: buildTextMessage(text),
    timestamp: nowISO(),
  };
}

function buildTextMessage(text) {
  return {
    message_id: randomUUID(),
    role: 'ROLE_AGENT',
    parts: [{ text }],
    metadata: { ts: nowISO() },
  };
}

async function runDelphiTask(requestMessage, taskIdMaybe) {
  let task = null;
  if (taskIdMaybe && tasks.has(taskIdMaybe)) {
    task = tasks.get(taskIdMaybe);
    task.history.push(requestMessage);
    task.status = taskStatus('TASK_STATE_SUBMITTED', 'Task resumed');
  } else {
    const taskId = `task-${randomUUID()}`;
    const contextId = `ctx-${new Date().getFullYear()}`;
    task = {
      id: taskId,
      context_id: contextId,
      status: taskStatus('TASK_STATE_SUBMITTED', 'Task created'),
      artifacts: [],
      history: [requestMessage],
      metadata: {},
    };
    tasks.set(taskId, task);
  }
  pushEvent({ type: 'a2a.task_status', ts: Date.now(), data: { task_id: task.id, status: task.status } });

  const news = extractNews(requestMessage);
  latestState.news = news;
  pushEvent({ type: 'news', ts: Date.now(), data: news });

  task.status = taskStatus('TASK_STATE_WORKING', 'Collecting agent opinions');
  pushEvent({ type: 'a2a.task_status', ts: Date.now(), data: { task_id: task.id, status: task.status } });

  const opinions = await orchestrateOpinions(news, task);
  latestState.opinions = opinions;
  pushEvent({ type: 'opinions', ts: Date.now(), data: opinions });

  const annotations = await collectAnnotations(opinions, task);
  latestState.annotations = annotations;
  pushEvent({ type: 'annotations', ts: Date.now(), data: annotations });

  let globalView = buildGlobalView(opinions);
  latestState.globalView = globalView;
  pushEvent({ type: 'global_view', ts: Date.now(), data: globalView });

  let followUp = askFollowUp(globalView, opinions.microStructure || opinions.macroPolicy);
  const followUpMsg = buildMessage('ROLE_AGENT', followUp);
  task.history.push(followUpMsg);
  pushEvent({ type: 'a2a.message', ts: Date.now(), data: { task_id: task.id, message: followUpMsg } });
  pushEvent({ type: 'follow_up', ts: Date.now(), data: followUp });

  const followUpResponse = await sendFollowUpToAgent('microStructure', followUp, task);

  // Try LLM synthesis for blackboard; fallback to deterministic if unavailable
  let decisionPayload = null;
  try {
    const llmResult = await llmSynthesize(opinions, annotations);
    if (llmResult?.global_view) {
      globalView = llmResult.global_view;
      latestState.globalView = globalView;
      pushEvent({ type: 'global_view', ts: Date.now(), data: globalView });
    }
    if (llmResult?.follow_up) {
      followUp = llmResult.follow_up;
    }
    if (llmResult?.decision) {
      decisionPayload = llmResult.decision;
    }
  } catch (e) {
    // fall back quietly
  }

  const decision = decisionPayload
    ? { decision: decisionPayload, tags: ['multi-agent', 'blackboard', 'llm'], follow_up_applied: decisionPayload.micro_follow_up || {}, source: opinions, conflicts: [], explanation: 'LLM synthesized' }
    : buildDecision(opinions, followUp, followUpResponse, annotations);
  const decisionMsg = buildMessage('ROLE_AGENT', decision);
  task.history.push(decisionMsg);
  latestState.followUp = followUp;
  latestState.decision = decision;
  pushEvent({ type: 'decision', ts: Date.now(), data: decision });

  const artifact = {
    artifact_id: randomUUID(),
    name: 'delphi_unified_decision',
    description: '融合长/短/宏观点与追问后的统一决策',
    parts: [{ data: { opinions, annotations, globalView, followUp, decision } }],
    metadata: { createdAt: nowISO() },
  };
  const annotationArtifact = {
    artifact_id: randomUUID(),
    name: 'annotations',
    description: 'Agents 标注彼此输出的标签',
    parts: [{ data: annotations }],
    metadata: { createdAt: nowISO() },
  };
  task.artifacts.push(artifact);
  task.artifacts.push(annotationArtifact);

  task.status = taskStatus('TASK_STATE_COMPLETED', 'Delphi pipeline completed');
  pushEvent({ type: 'a2a.task_status', ts: Date.now(), data: { task_id: task.id, status: task.status } });

  latestState.lastTask = task;
  latestState.agents = agentDefs;
  latestState.logs = latestState.logs;
  return task;
}

function extractNews(message) {
  const textPart = message.parts?.find((p) => p.text)?.text;
  if (textPart) {
    return { headline: textPart, source: 'user_input', fetchedAt: nowISO() };
  }
  return STATIC_NEWS();
}

async function orchestrateOpinions(news, task) {
  const agentOrder = ['macroPolicy', 'microStructure', 'sectorRotation'];
  const opinions = {};

  for (const id of agentOrder) {
    const request = buildMessage('ROLE_USER', { headline: news.headline, to: id });
    task.history.push(request);
    pushEvent({ type: 'a2a.message', ts: Date.now(), data: { task_id: task.id, message: request } });
    const response = await handleAgentMessage(id, request, news);
    task.history.push(response);
    pushEvent({ type: 'a2a.message', ts: Date.now(), data: { task_id: task.id, message: response } });
    if (id === 'macroPolicy') opinions.macroPolicy = response.parts[0].data;
    if (id === 'microStructure') opinions.microStructure = response.parts[0].data;
    if (id === 'sectorRotation') opinions.sectorRotation = response.parts[0].data;
  }
  return opinions;
}

async function collectAnnotations(opinions, task) {
  const agentOrder = ['macroPolicy', 'microStructure', 'sectorRotation'];
  const all = {};
  for (const id of agentOrder) {
    const req = buildMessage('ROLE_USER', { opinions, to: id, intent: 'annotation_request' });
    task.history.push(req);
    pushEvent({ type: 'a2a.message', ts: Date.now(), data: { task_id: task.id, message: req } });
    const res = await annotateOpinions(id, opinions);
    task.history.push(res);
    pushEvent({ type: 'a2a.message', ts: Date.now(), data: { task_id: task.id, message: res } });
    all[id] = res.parts?.[0]?.data?.annotations || [];
  }
  return all;
}

async function sendFollowUpToAgent(agentId, followUp, task) {
  const req = buildMessage('ROLE_USER', { followUp, to: agentId, intent: 'follow_up' });
  task.history.push(req);
  pushEvent({ type: 'a2a.message', ts: Date.now(), data: { task_id: task.id, message: req } });
  const res = respondFollowUp(agentId, followUp);
  if (res) {
    task.history.push(res);
    pushEvent({ type: 'a2a.message', ts: Date.now(), data: { task_id: task.id, message: res } });
    return res;
  }
  return null;
}

module.exports = app;
