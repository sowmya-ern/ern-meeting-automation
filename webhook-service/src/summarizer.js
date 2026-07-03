const axios = require('axios');
const { BOLD_MARKER_SYNTAX_HINT } = require('./bold-marker');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const RULES = `Simplify this meeting summary. Respond with EXACTLY this format and nothing else:

OVERVIEW:
<no more than 3 sentences, one per distinct domain (e.g. market/strategy, engineering/product, operations/team); omit detail already covered in action items>

ACTION_ITEMS:
<grouped by assignee under a "**Name**" heading; each item starts with an imperative verb; no timestamps; where two assignees share an overlapping task, merge it into one item noting joint ownership; ${BOLD_MARKER_SYNTAX_HINT}>`;

function buildPrompt({ title, attendees, overview, action_items }) {
  return `${RULES}

Meeting: ${title}
Attendees: ${(attendees ?? []).join(', ')}

Overview:
${overview}

Action Items:
${action_items}`;
}

function parseResponse(text) {
  const match = text.match(/OVERVIEW:\s*([\s\S]*?)\s*ACTION_ITEMS:\s*([\s\S]*)/);
  if (!match) {
    throw new Error('summarizer response did not contain the expected OVERVIEW:/ACTION_ITEMS: sections');
  }
  return { overview: match[1].trim(), action_items: match[2].trim() };
}

function defaultHttpPost(url, body, config) {
  return axios.post(url, body, config);
}

function createSummarizer({ apiKey, model = 'claude-sonnet-5', maxTokens = 1024, httpPost = defaultHttpPost }) {
  async function simplify(summary) {
    const response = await httpPost(
      ANTHROPIC_URL,
      { model, max_tokens: maxTokens, messages: [{ role: 'user', content: buildPrompt(summary) }] },
      { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
    );

    const text = response?.data?.content?.[0]?.text;
    if (!text) {
      throw new Error('summarizer response had no text content');
    }
    return parseResponse(text);
  }

  return { simplify };
}

module.exports = { createSummarizer };
