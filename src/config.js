const fs = require('fs');
const path = require('path');

function loadApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const candidate = path.join(process.cwd(), '..', 'e.txt');
  try {
    const raw = fs.readFileSync(candidate, 'utf8');
    const match = raw.match(/API_KEY\s*=\s*([A-Za-z0-9._-]+)/);
    if (match) return match[1].trim();
  } catch (_) {
    // ignore
  }
  return null;
}

module.exports = {
  loadApiKey,
};
