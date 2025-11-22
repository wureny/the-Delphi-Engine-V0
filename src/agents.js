const { randomUUID } = require('crypto');
const { callChat, safeJson, getClient } = require('./llm');

const STATIC_EVENT =
  '美国 SEC 于今日宣布，将对大型稳定币发行方进行更严格的信息披露要求，包括储备透明度、链上审计频率，以及收益型产品（如 Earn、Staking）的合规边界。同时 SEC 表示，正在评估是否将某些高流通量稳定币纳入“系统性风险监控清单”，并将在两周内举办听证会。';

const agentDefs = {
  macroPolicy: {
    id: 'macroPolicy',
    name: 'Macro-Policy Agent',
    role: '监管/系统性风险/资金流向视角',
    schema: {
      reg_policy_impact: 'string',
      risk_scenario: 'string',
      likelihood: 'number',
      macro_actions: 'MacroAction[]',
    },
    card: buildAgentCard({
      name: 'Macro-Policy Agent',
      description: '金融监管逻辑/系统性风险/资金流向，美联储/财政部 vs SEC',
      skills: [
        {
          id: 'macro-policy',
          name: 'Macro Policy',
          description: '评估监管冲击与系统性风险，给出流动性与风控动作',
          tags: ['regulation', 'systemic-risk', 'policy'],
        },
      ],
    }),
  },
  microStructure: {
    id: 'microStructure',
    name: 'Market-Microstructure Agent',
    role: '微结构/资金流/费率/短时价格行为',
    schema: {
      volatility_estimate: 'string',
      funding_rate_change: 'string',
      flow_signals: 'string[]',
      micro_actions: 'MicroAction[]',
    },
    card: buildAgentCard({
      name: 'Market-Microstructure Agent',
      description: 'gas spike/MEV/套利、短时流向与价格行为、借贷利率因子',
      skills: [
        {
          id: 'microstructure',
          name: 'Microstructure',
          description: '分析波动率/费率/流向，提供微观交易动作',
          tags: ['micro', 'flow', 'mev', 'funding'],
        },
      ],
    }),
  },
  sectorRotation: {
    id: 'sectorRotation',
    name: 'Sector Rotation Agent',
    role: '赛道配置与再定价',
    schema: {
      winning_sectors: 'string[]',
      losing_sectors: 'string[]',
      rotation_recommendation: 'string',
      allocation_actions: 'AllocationAction[]',
    },
    card: buildAgentCard({
      name: 'Sector Rotation Agent',
      description: '稳定币监管→赛道受伤/受益，RWA/衍生品/隐私/AI Agent 再定价',
      skills: [
        {
          id: 'sector-rotation',
          name: 'Sector Rotation',
          description: '识别受伤/受益赛道，给出配置动作',
          tags: ['rotation', 'allocation', 'narrative'],
        },
      ],
    }),
  },
  blackboard: {
    id: 'blackboard',
    name: 'Blackboard',
    role: '收集、冲突检测、追问、统一决策',
    schema: {
      opinions: 'AgentOpinions',
      global_view: 'GlobalView',
      follow_up: 'FollowUp',
      decision: 'UnifiedDecision',
    },
    card: buildAgentCard({
      name: 'Blackboard',
      description: '协调多智能体、冲突检测、追问、统一决策',
      skills: [
        {
          id: 'coordination',
          name: 'Coordination',
          description: '收集多 Agent 输出并统一决策',
          tags: ['blackboard', 'coordination', 'fusion'],
        },
      ],
      version: '0.1.0',
      capabilities: { streaming: true, push_notifications: false },
    }),
  },
};

function buildAgentCard({
  name,
  description,
  skills,
  version = '0.1.0',
  capabilities = { streaming: true },
}) {
  return {
    protocol_version: '1.0',
    name,
    description,
    supported_interfaces: [
      {
        url: 'http://localhost:3000',
        transport: 'http',
      },
    ],
    provider: {
      url: 'http://localhost:3000',
      organization: 'Delphi Engine Demo',
    },
    version,
    documentation_url: 'https://a2a-protocol.org/latest/specification',
    capabilities,
    security_schemes: {},
    security: [],
    default_input_modes: ['text/plain'],
    default_output_modes: ['application/json', 'text/plain'],
    skills,
    supports_authenticated_extended_card: false,
    signatures: [],
    icon_url: '',
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMessage(role, dataPayload) {
  return {
    message_id: randomUUID(),
    role,
    parts: [{ data: dataPayload }],
    metadata: { ts: new Date().toISOString() },
  };
}

async function handleAgentMessage(agentId, requestMessage, news) {
  try {
    switch (agentId) {
      case 'macroPolicy':
        return handleMacroPolicy(requestMessage, news);
      case 'microStructure':
        return handleMicroStructure(requestMessage, news);
      case 'sectorRotation':
        return handleSectorRotation(requestMessage, news);
      default:
        throw new Error(`Unknown agent ${agentId}`);
    }
  } catch (e) {
    return buildMessage('ROLE_AGENT', stubOpinion(agentId, news));
  }
}

async function handleMacroPolicy(_message, news) {
  const payload = await llmOpinion('macroPolicy', news, {
    schema: agentDefs.macroPolicy.schema,
    style: '宏观政策/系统性风险观察者，关注监管、资金流向、美联储/财政部/SEC',
  });
  return buildMessage('ROLE_AGENT', payload);
}

async function handleMicroStructure(_message, news) {
  const payload = await llmOpinion('microStructure', news, {
    schema: agentDefs.microStructure.schema,
    style: '市场微结构分析者，关注波动率/MEV/流向/费率/短时价格行为',
  });
  return buildMessage('ROLE_AGENT', payload);
}

async function handleSectorRotation(_message, news) {
  const payload = await llmOpinion('sectorRotation', news, {
    schema: agentDefs.sectorRotation.schema,
    style: '行业配置视角，赛道受伤/受益与叙事再定价',
  });
  return buildMessage('ROLE_AGENT', payload);
}

module.exports = {
  STATIC_EVENT,
  agentDefs,
  handleAgentMessage,
  buildMessage,
};

// --- Annotation and follow-up helpers ---

async function annotateOpinions(agentId, opinions) {
  try {
    const res = await llmAnnotation(agentId, opinions);
    return buildMessage('ROLE_AGENT', { from: agentId, annotations: res });
  } catch (e) {
    const fallback = fallbackAnnotations(agentId, opinions);
    return buildMessage('ROLE_AGENT', { from: agentId, annotations: fallback });
  }
}

async function respondFollowUp(agentId, followUp) {
  if (agentId !== 'microStructure') return null;
  try {
    const res = await llmFollowUp(agentId, followUp);
    return buildMessage('ROLE_AGENT', res);
  } catch (e) {
    const adj = followUp?.fields?.adjustment_needed || 0.2;
    return buildMessage('ROLE_AGENT', {
      adjustment_needed: adj,
      adjustment_comment: adj > 0.2 ? '减少杠杆与短线暴露' : '维持原计划',
    });
  }
}

module.exports.annotateOpinions = annotateOpinions;
module.exports.respondFollowUp = respondFollowUp;

// --- LLM helpers ---

async function llmOpinion(agentId, news, { schema, style }) {
  const cli = getClient();
  if (!cli) return stubOpinion(agentId, news);
  try {
    const sys = `你是 ${style} 的智能体，必须输出符合 JSON schema 的结构化意见。只输出 JSON，字段务必齐全。`;
    const user = `事件: ${news.headline}\n请按以下 schema 输出:\n${JSON.stringify(schema, null, 2)}\n字段要求精准、数据合理。`;
    const content = await callChat([
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ]);
    const parsed = safeJson(content);
    return parsed || stubOpinion(agentId, news);
  } catch (e) {
    return stubOpinion(agentId, news);
  }
}

async function llmAnnotation(agentId, opinions) {
  const cli = getClient();
  if (!cli) return fallbackAnnotations(agentId, opinions);
  const sys = `你是审阅者 ${agentId}，阅读其他 Agent 的输出，为他们加标注。输出 JSON 数组 annotations[{target,label,severity,comment,refs:[{field,snippet}]}]。severity 取 low|medium|high。`;
  const user = `各 Agent 输出:\n${JSON.stringify(opinions, null, 2)}\n请只输出 JSON 数组，不要多余文字。`;
  const content = await callChat([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ]);
  return safeJson(content) || fallbackAnnotations(agentId, opinions);
}

async function llmFollowUp(agentId, followUp) {
  const cli = getClient();
  if (!cli) {
    const adj = followUp?.fields?.adjustment_needed || 0.2;
    return {
      adjustment_needed: adj,
      adjustment_comment: adj > 0.2 ? '减少杠杆与短线暴露' : '维持原计划',
    };
  }
  const sys = `你是市场微结构 Agent，回答黑板追问，输出 JSON {adjustment_needed:number, adjustment_comment:string}`;
  const user = `追问: ${JSON.stringify(followUp, null, 2)}`;
  const content = await callChat([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ]);
  return safeJson(content) || {
    adjustment_needed: followUp?.fields?.adjustment_needed || 0.2,
    adjustment_comment: '维持原计划',
  };
}

function stubOpinion(agentId, news) {
  if (agentId === 'macroPolicy') {
    return {
      reg_policy_impact: 'stricter_disclosure',
      risk_scenario: 'stablecoin_systemic_monitor',
      likelihood: 0.65,
      macro_actions: [
        { type: 'reduce_risk', comment: '降低总体杠杆与风险暴露' },
        { type: 'raise_cash', comment: '提升现金与等值流动性' },
      ],
      meta: { agent: 'MacroPolicy', sourceEvent: news.headline },
    };
  }
  if (agentId === 'microStructure') {
    return {
      volatility_estimate: 'elevated',
      funding_rate_change: 'rising',
      flow_signals: ['outflows from stablecoin pools', 'gas spike risk'],
      micro_actions: [
        { type: 'reduce_leverage', comment: '降杠杆控制波动风险' },
        { type: 'basis_trade', comment: '高费率套利/做空波动率收敛' },
      ],
      meta: { agent: 'MicroStructure', sourceEvent: news.headline },
    };
  }
  return {
    winning_sectors: ['RWA', '合规友好资产'],
    losing_sectors: ['高杠杆稳定币收益', '依赖稳定币流动性的协议'],
    rotation_recommendation: '增配RWA，减配高依赖稳定币赛道',
    allocation_actions: [
      { type: 'increase', sector: 'RWA', size: '2-3% NAV' },
      { type: 'decrease', sector: 'stablecoin_yield', size: '2% NAV' },
    ],
    meta: { agent: 'SectorRotation', sourceEvent: news.headline },
  };
}

function fallbackAnnotations(agentId, opinions) {
  const annotations = [];
  if (agentId === 'microStructure' && opinions.macroPolicy) {
    annotations.push({
      target: 'macroPolicy',
      label: 'liquidity_short_term',
      severity: 'medium',
      comment: '微观流动性/费率或放大政策冲击，需降杠杆',
    });
  }
  if (agentId === 'macroPolicy' && opinions.microStructure) {
    annotations.push({
      target: 'microStructure',
      label: 'policy_overhang',
      severity: 'medium',
      comment: '政策听证会前的微观交易需控制总风险',
    });
  }
  if (agentId === 'sectorRotation') {
    annotations.push({
      target: 'macroPolicy',
      label: 'sector_shift',
      severity: 'low',
      comment: '监管冲击改变赛道预期，需在决策中强调行业再配置',
    });
  }
  return annotations;
}
