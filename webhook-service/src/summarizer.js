const axios = require('axios');
const { BOLD_MARKER_SYNTAX_HINT } = require('./bold-marker');
const { getProfile } = require('./company-profiles');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const RULES = `Simplify this meeting summary. Respond with EXACTLY this format and nothing else:

OVERVIEW:
<no more than 3 sentences, one per distinct domain (e.g. market/strategy, engineering/product, operations/team); each sentence states exactly one fact/decision/status — never chain multiple facts into one sentence with semicolons; if a topic has several sub-facts, keep only the single most decision-relevant one and drop the rest; omit detail already covered in action items>

SECTIONS:
<one or more blocks, each exactly three lines (EMOJI:, HEADER:, BULLETS:), separated by a blank line between blocks:
EMOJI: <a single emoji matching the topic's nature, e.g. 💰 for market/finance, 🛠 for engineering/product, 👥 for team/ops>
HEADER: <short department/topic name, Title Case, e.g. "Engineering", "Marketing">
BULLETS: <one bullet per line starting with "- "; prefix a line with "⚠️ " (after the dash) when it describes a blocker — something explicitly waiting on, blocked by, or pending another person or event>
Group the meeting's actual topics into these sections; do not invent a section with no real content behind it.>

ACTION_ITEMS:
<grouped by assignee under a "**Name**" heading; each item opens with a deliverable verb naming what changes as a result (Get/Send/Confirm/Update/Schedule or similar) — never a bare process verb alone (discuss/follow up/coordinate/review) with no concrete outcome attached; prefix an item with "⚠️ " when it is blocked (waiting on/blocked by/pending another person or event); if this meeting's content shows a task's ownership was handed off from one person to another, list it under the NEW owner's heading, not the original owner's — this is a deliberate handoff reassignment, not an error; no timestamps; where two assignees share an overlapping task, merge it into one item noting joint ownership; if an item has no clear deadline, do not guess one and do not add a placeholder — simply omit the deadline; if no concrete deliverable can be identified for an item, use the closest honest verb without inventing specificity or flagging the gap; ${BOLD_MARKER_SYNTAX_HINT}>

NEXT_STEPS:
<one or two bullet lines ("- " prefix) naming a broader team-level next step or upcoming milestone; if none is evident from this meeting, output exactly "- None noted this cycle.">`;

function buildPrompt({ title, attendees, overview, action_items }, context = {}) {
  const { seriesState, company } = context;

  const hasSeriesContext = seriesState && ((seriesState.open_items && seriesState.open_items.length) || seriesState.narrative);
  const seriesBlock = hasSeriesContext
    ? `\nPrior open items and narrative for this meeting series (for reference only -- you may note an item is recurring, but do not invent detail beyond what's here):\nOpen items:\n${JSON.stringify(seriesState.open_items ?? [], null, 2)}\nNarrative so far:\n${seriesState.narrative ?? ''}\n`
    : '';

  const profile = company ? getProfile(company) : null;
  const toneLine = profile ? `\nTone for this team: ${profile.tone}.\n` : '';

  return `${RULES}
${seriesBlock}${toneLine}
Meeting: ${title}
Attendees: ${(attendees ?? []).join(', ')}

Overview:
${overview}

Action Items:
${action_items}`;
}

function parseSections(sectionsText) {
  const blocks = sectionsText.trim().split(/\n\s*\n/).filter(Boolean);
  return blocks.map((block) => {
    const emojiMatch = block.match(/EMOJI:\s*(.+)/);
    const headerMatch = block.match(/HEADER:\s*(.+)/);
    const bulletsMatch = block.match(/BULLETS:\s*([\s\S]*)/);
    const bullets = (bulletsMatch ? bulletsMatch[1] : '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('-'))
      .map((line) => line.replace(/^-\s*/, ''));
    return {
      emoji: emojiMatch ? emojiMatch[1].trim() : '',
      header: headerMatch ? headerMatch[1].trim() : '',
      bullets,
    };
  });
}

// Strips each line's leading "- " bullet marker (NEXT_STEPS is one or two bullet lines) so
// downstream consumers (notifier.js's formatTodosBody) get clean text, not raw markdown.
function cleanBulletText(rawText) {
  return rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^-\s*/, ''))
    .join('\n');
}

function parseResponse(text) {
  const match = text.match(/OVERVIEW:\s*([\s\S]*?)\s*SECTIONS:\s*([\s\S]*?)\s*ACTION_ITEMS:\s*([\s\S]*?)\s*NEXT_STEPS:\s*([\s\S]*)/);
  if (!match) {
    throw new Error('summarizer response did not contain the expected OVERVIEW:/SECTIONS:/ACTION_ITEMS:/NEXT_STEPS: sections');
  }
  const [, overview, sectionsText, action_items, next_steps] = match;
  return {
    overview: overview.trim(),
    sections: parseSections(sectionsText),
    action_items: action_items.trim(),
    next_steps: cleanBulletText(next_steps.trim()),
  };
}

function defaultHttpPost(url, body, config) {
  return axios.post(url, body, config);
}

function createSummarizer({ apiKey, model = 'claude-sonnet-5', maxTokens = 1024, httpPost = defaultHttpPost }) {
  // context: { seriesState, company }, both optional -- see docs/superpowers/plans/
  // 2026-07-04-fireflies-telegram-notetaker.md Task 6 for why this replaced the
  // meeting-history plan's positional `seriesState` second parameter.
  async function simplify(summary, context) {
    const response = await httpPost(
      ANTHROPIC_URL,
      { model, max_tokens: maxTokens, messages: [{ role: 'user', content: buildPrompt(summary, context) }] },
      { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
    );

    const text = response?.data?.content?.find((block) => block.type === 'text')?.text;
    if (!text) {
      throw new Error('summarizer response had no text content');
    }
    return parseResponse(text);
  }

  async function generatePreMeetingReminder({ title, description, attendees, seriesState }) {
    const RULES = `You are generating a Pre-Meeting Reminder for a Telegram group chat.
The output MUST be exactly this format (do not use MarkdownV2 escaping, just plain text with emojis):

⏰ <Meeting Title> — Pre-Meeting Reminder
<@handles of attendees>
Sending ahead of today's call. Please come prepared on the following:

📌 <@handle 1>
• <Action item 1 from history>
• <Action item 2 from history>

📌 <@handle 2>
• <Action item 1 from history>

📎 Please review before joining
• <Any links or docs mentioned in the description or history>

🕐 See you on the call. Reply here if you can't make it.

Rules:
1. Group action items by assignee using their @handle (or name if no handle).
2. Use the provided attendee list to know who is expected.
3. If seriesState is provided, use the open_items to populate the assignee lists.
4. Keep bullets short and actionable.
5. If there are no open items, derive topics from the description.
6. Do NOT invent items.
7. Use the exact emojis shown.`;

    const openItemsJson = seriesState?.open_items ? JSON.stringify(seriesState.open_items) : 'None';
    const narrative = seriesState?.narrative || 'None';
    
    const prompt = `${RULES}

Meeting Title: ${title}
Attendees: ${attendees.join(', ')}
Description: ${description}
Prior Open Items: ${openItemsJson}
Prior Narrative: ${narrative}`;

    const response = await httpPost(
      ANTHROPIC_URL,
      {
        model,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      }
    );

    const text = response?.data?.content?.[0]?.text;
    if (!text) throw new Error('LLM returned empty response for pre-meeting reminder');
    
    // Use attendee-handles to replace names with handles in the generated text
    const { handleFor } = require('./attendee-handles');
    // Simple replacement for known names that might appear without handles
    let final = text;
    attendees.forEach(name => {
      const handle = handleFor(name);
      if (handle !== name) {
        final = final.replace(new RegExp(name, 'g'), handle);
      }
    });
    
    return final;
  }

  return { simplify, generatePreMeetingReminder };
}

module.exports = { createSummarizer };
