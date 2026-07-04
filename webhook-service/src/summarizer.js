const axios = require('axios');
const { BOLD_MARKER_SYNTAX_HINT } = require('./bold-marker');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const RULES = `Simplify this meeting summary. Respond with EXACTLY this format and nothing else:

OVERVIEW:
<no more than 3 sentences, one per distinct domain (e.g. market/strategy, engineering/product, operations/team); each sentence states exactly one fact/decision/status — never chain multiple facts into one sentence with semicolons; if a topic has several sub-facts, keep only the single most decision-relevant one and drop the rest; omit detail already covered in action items>

ACTION_ITEMS:
<grouped by assignee under a "**Name**" heading; each item opens with a deliverable verb naming what changes as a result (Get/Send/Confirm/Update/Schedule or similar) — never a bare process verb alone (discuss/follow up/coordinate/review) with no concrete outcome attached; no timestamps; where two assignees share an overlapping task, merge it into one item noting joint ownership; if an item has no clear deadline, do not guess one — append "(TBC)"; if no concrete deliverable can be identified for an item, use the closest honest verb and append "(outcome: TBC)" rather than inventing specificity; ${BOLD_MARKER_SYNTAX_HINT}>`;

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

    // Don't assume content[0] is the text block — extended-thinking-capable models prepend a
    // "thinking" block before the actual "text" block, so index into content by type instead.
    const text = response?.data?.content?.find((block) => block.type === 'text')?.text;
    if (!text) {
      throw new Error('summarizer response had no text content');
    }
    return parseResponse(text);
  }

  return { simplify };
}

module.exports = { createSummarizer };
