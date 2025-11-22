const OpenAI = require('openai');
const { loadApiKey } = require('./config');

let client = null;
function getClient() {
  if (client) return client;
  const key = loadApiKey();
  if (!key) return null;
  client = new OpenAI({ apiKey: key });
  return client;
}

async function callChat(messages, { model = 'gpt-4o-mini', temperature = 0.3 } = {}) {
  const cli = getClient();
  if (!cli) throw new Error('OPENAI_API_KEY missing');
  const res = await cli.chat.completions.create({
    model,
    temperature,
    messages,
  });
  return res.choices?.[0]?.message?.content?.trim() || '';
}

function safeJson(str) {
  try {
    const cleaned = str.trim().replace(/^```(json)?/i, '').replace(/```$/, '');
    return JSON.parse(cleaned);
  } catch (e) {
    return null;
  }
}

module.exports = {
  callChat,
  safeJson,
  getClient,
};
