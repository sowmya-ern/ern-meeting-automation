const axios = require('axios');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const RULES = `You maintain a running tracker of open action items and a short narrative for a recurring meeting series. Respond with EXACTLY this format and nothing else:

OPEN_ITEMS:
<a JSON array of objects, each { "text": string, "assignee": string, "status": "open" or "closed", "first_seen": string, "closed_reason": string (only when status is "closed") }. Carry forward every item from Prior Open Items unchanged unless this meeting's content clearly shows it was addressed -- only then set status to "closed" and add closed_reason describing what happened. Never guess a closure -- if unsure whether an item was resolved, leave it "open". Add a new item only when this meeting's raw content clearly introduces a new, distinct task -- merge a new mention into an existing open item instead of duplicating it when they're clearly the same task resurfacing.>

NARRATIVE:
<no more than 3 sentences describing the series' ongoing themes/decisions across meetings so far; each sentence states exactly one fact/decision/status, never chained with semicolons; update it to reflect this meeting, don't just repeat the prior narrative unchanged>`;

function buildPrompt({ seriesState, meeting }) {
  const priorItems = JSON.stringify(seriesState?.open_items ?? [], null, 2);
  const priorNarrative = seriesState?.narrative || '(none yet -- this is the first tracked meeting for this series)';

  return `${RULES}

Prior Open Items:
${priorItems}

Prior Narrative:
${priorNarrative}

This Meeting: ${meeting.title}
Attendees: ${(meeting.attendees ?? []).join(', ')}

Overview:
${meeting.overview}

Action Items:
${meeting.action_items}`;
}

function parseResponse(text) {
  const match = text.match(/OPEN_ITEMS:\s*([\s\S]*?)\s*NARRATIVE:\s*([\s\S]*)/);
  if (!match) {
    throw new Error('history-consolidator response did not contain the expected OPEN_ITEMS:/NARRATIVE: sections');
  }
  const open_items = JSON.parse(match[1].trim());
  const narrative = match[2].trim();
  return { open_items, narrative };
}

function defaultHttpPost(url, body, config) {
  return axios.post(url, body, config);
}

function createHistoryConsolidator({ apiKey, model = 'claude-sonnet-5', maxTokens = 1024, httpPost = defaultHttpPost }) {
  async function consolidate({ seriesState, meeting }) {
    const response = await httpPost(
      ANTHROPIC_URL,
      { model, max_tokens: maxTokens, messages: [{ role: 'user', content: buildPrompt({ seriesState, meeting }) }] },
      { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
    );

    // Don't assume content[0] is the text block -- extended-thinking-capable models prepend a
    // "thinking" block before the actual "text" block (found via a live e2e test in summarizer.js).
    const text = response?.data?.content?.find((block) => block.type === 'text')?.text;
    if (!text) {
      throw new Error('history-consolidator response had no text content');
    }
    return parseResponse(text);
  }

  return { consolidate };
}

module.exports = { createHistoryConsolidator };
