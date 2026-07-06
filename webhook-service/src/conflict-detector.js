// Feature 11: Cross-meeting conflict detection.
// After each meeting is processed, compare the new open_items against the other company's
// latest series_state in Supabase. If the LLM finds a contradiction between the two sets of
// items (e.g. Bond says "defer Neobank" while ERN says "prioritise Neobank this week"), it
// flags the conflict to the ops chat so it can be resolved before it causes confusion.
//
// Design: best-effort only (same ADR-0003 precedent as history consolidation) — a failure
// here must never surface as a notifyOpsFailure or block the post-meeting pipeline.

const axios = require('axios');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const CONFLICT_RULES = `You are checking whether two sets of meeting action items from two different companies contain contradictory decisions or priorities.

Respond with EXACTLY this format and nothing else:

CONFLICTS:
<a JSON array of objects, each { "summary": string, "bond_item": string, "ern_item": string }.
Only include genuine contradictions — cases where one company's open item directly conflicts with or contradicts another company's open item on the same topic or shared resource (e.g. a shared vendor, a shared team member, a shared timeline, or a shared strategic direction).
Do NOT flag items that are merely unrelated or that address the same topic from different angles without contradiction.
If there are no genuine contradictions, return an empty array: []>`;

function buildConflictPrompt({ bondItems, ernItems }) {
  return `${CONFLICT_RULES}

Bond Open Items:
${JSON.stringify(bondItems, null, 2)}

ERN Open Items:
${JSON.stringify(ernItems, null, 2)}`;
}

function parseConflictResponse(text) {
  const match = text.match(/CONFLICTS:\s*([\s\S]*)/);
  if (!match) return [];
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return [];
  }
}

function defaultHttpPost(url, body, config) {
  return axios.post(url, body, config);
}

function createConflictDetector({ apiKey, model = 'claude-sonnet-5', maxTokens = 512, httpPost = defaultHttpPost }) {
  // Detect contradictions between Bond and ERN open items.
  // Returns an array of conflict objects (may be empty).
  async function detect({ bondSeriesState, ernSeriesState }) {
    const bondItems = (bondSeriesState?.open_items ?? []).filter((i) => i.status === 'open');
    const ernItems = (ernSeriesState?.open_items ?? []).filter((i) => i.status === 'open');

    // Skip if either side has no open items — nothing to compare
    if (bondItems.length === 0 || ernItems.length === 0) return [];

    const response = await httpPost(
      ANTHROPIC_URL,
      {
        model,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [{ role: 'user', content: buildConflictPrompt({ bondItems, ernItems }) }],
      },
      { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
    );

    const text = response?.data?.content?.find((block) => block.type === 'text')?.text;
    if (!text) return [];
    return parseConflictResponse(text);
  }

  return { detect };
}

module.exports = { createConflictDetector };
