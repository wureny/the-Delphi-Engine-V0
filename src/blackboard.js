const { buildEnvelope } = require('./agents');

const { callChat, safeJson, getClient } = require('./llm');

function buildGlobalView(opinions) {
  const conflict =
    opinions.macroPolicy?.risk_scenario?.includes('systemic') &&
    opinions.microStructure?.volatility_estimate === 'elevated'
      ? 'policy-micro resonance'
      : 'mixed';

  return {
    macro_policy: opinions.macroPolicy?.reg_policy_impact || 'unknown',
    microstructure: opinions.microStructure?.volatility_estimate || 'unknown',
    sector_rotation: opinions.sectorRotation?.rotation_recommendation || 'unknown',
    risks: ['stablecoin', 'liquidity', 'regulatory'],
    conflict,
  };
}

function askFollowUp(globalView, shortTermOpinion) {
  const adjustmentNeeded = globalView.conflict.includes('resonance') ? 0.3 : 0.15;
  return {
    to: 'Market-Microstructure Agent',
    question: 'Given micro liquidity/fee conditions, should we trim short-term leverage and exposure?',
    fields: {
      adjustment_needed: adjustmentNeeded,
      adjustment_comment: adjustmentNeeded > 0.2 ? 'Reduce leverage and short-term exposure' : 'Maintain stance',
    },
    based_on: shortTermOpinion,
  };
}

function buildDecision(opinions, followUp, followUpResponse, annotations) {
  const fu = followUpResponse?.parts?.[0]?.data || followUp?.fields || {};
  const conflicts = [];
  if (opinions.macroPolicy?.risk_scenario) conflicts.push(opinions.macroPolicy.risk_scenario);
  if (opinions.microStructure?.volatility_estimate === 'elevated') conflicts.push('micro vol elevated');
  if (annotations) {
    Object.values(annotations).forEach((arr) => {
      (arr || []).forEach((a) => {
        if (a.severity === 'high') conflicts.push(`high:${a.label}`);
      });
    });
  }
  const peerComments = flattenAnnotations(annotations);
  return {
    decision: {
      focus: 'portfolio_risk',
      macro_actions: opinions.macroPolicy?.macro_actions || [],
      micro_actions: opinions.microStructure?.micro_actions || [],
      sector_actions: opinions.sectorRotation?.allocation_actions || [],
      micro_follow_up: fu,
      peer_comments: peerComments,
    },
    tags: ['multi-agent', 'blackboard', 'conflict-resolution'],
    follow_up_applied: fu,
    source: opinions,
    conflicts,
    explanation: 'Synthesized via blackboard: regulation/systemic risk + microstructure liquidity/fees + sector rotations.',
  };
}

function flattenAnnotations(annotations) {
  if (!annotations) return [];
  const list = [];
  Object.entries(annotations).forEach(([from, arr]) => {
    (arr || []).forEach((a) => {
      list.push({
        from,
        target: a.target || '',
        label: a.label || '',
        severity: a.severity || '',
        comment: a.comment || '',
      });
    });
  });
  return list;
}

async function llmSynthesize(opinions, annotations) {
  const cli = getClient();
  if (!cli) return null;
  const sys = `You are the Blackboard coordinator. Given heterogeneous agent outputs (macro policy, microstructure, sector rotation) and peer annotations, produce:
{
  "global_view": { "macro_policy": string, "microstructure": string, "sector_rotation": string, "risks": string[], "conflict": string },
  "follow_up": { "to": string, "question": string, "fields": { "adjustment_needed": number, "adjustment_comment": string } },
  "decision": {
    "focus": string,
    "macro_actions": array,
    "micro_actions": array,
    "sector_actions": array,
    "micro_follow_up": object
  }
}
Return ONLY JSON.`;
  const user = `Agent outputs:\n${JSON.stringify(opinions, null, 2)}\nAnnotations:\n${JSON.stringify(annotations, null, 2)}`;
  const content = await callChat([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ], { temperature: 0.2 });
  return safeJson(content);
}

module.exports = {
  buildGlobalView,
  askFollowUp,
  buildDecision,
  llmSynthesize,
};

function buildFollowUpEnvelope(followUp, correlationId) {
  return buildEnvelope({
    from: 'agent:blackboard',
    to: 'agent:shortTerm',
    intent: 'follow_up',
    correlationId,
    payload: followUp,
  });
}

module.exports = {
  buildGlobalView,
  askFollowUp,
  buildDecision,
  buildFollowUpEnvelope,
};
