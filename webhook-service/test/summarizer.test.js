const test = require('node:test');
const assert = require('node:assert/strict');
const { createSummarizer } = require('../src/summarizer');

function fakeResponse(text) {
  return { data: { content: [{ type: 'text', text }] } };
}

const FULL_RESPONSE = [
  'OVERVIEW:',
  'One condensed sentence.',
  '',
  'SECTIONS:',
  'EMOJI: 🛠',
  'HEADER: Engineering',
  'BULLETS:',
  '- Shipped the new API',
  '- ⚠️ Waiting on RE7 to confirm the schema',
  '',
  'ACTION_ITEMS:',
  '**Vinson Leow**',
  'Review the **July 15** deadline.',
  '',
  'NEXT_STEPS:',
  '- Prep for the board update next week',
].join('\n');

test('simplify() sends the raw summary to the Anthropic Messages API and parses all four condensed sections back out', async () => {
  const calls = [];
  const httpPost = async (url, body, config) => {
    calls.push({ url, body, config });
    return fakeResponse(FULL_RESPONSE);
  };

  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });
  const raw = { title: 'Meet', attendees: ['Vinson Leow'], overview: 'long overview...', action_items: 'long action items...' };

  const result = await summarizer.simplify(raw);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].config.headers['x-api-key'], 'test-key');
  assert.match(calls[0].body.messages[0].content, /long overview\.\.\./);
  assert.match(calls[0].body.messages[0].content, /long action items\.\.\./);

  assert.equal(result.overview, 'One condensed sentence.');
  assert.deepEqual(result.sections, [
    { emoji: '🛠', header: 'Engineering', bullets: ['Shipped the new API', '⚠️ Waiting on RE7 to confirm the schema'] },
  ]);
  assert.equal(result.action_items, '**Vinson Leow**\nReview the **July 15** deadline.');
  assert.equal(result.next_steps, 'Prep for the board update next week');
});

test('simplify() rejects when the API call fails, so the caller can fall back to the raw summary', async () => {
  const httpPost = async () => { throw new Error('network down'); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await assert.rejects(
    () => summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' }),
    /network down/
  );
});

test('simplify() finds the text block even when a "thinking" block precedes it in content[]', async () => {
  const httpPost = async () => ({
    data: { content: [{ type: 'thinking', thinking: '', signature: 'abc' }, { type: 'text', text: FULL_RESPONSE }] },
  });
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  const result = await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' });

  assert.equal(result.overview, 'One condensed sentence.');
});

test('simplify() rejects when the response text is missing the expected section markers', async () => {
  const httpPost = async () => fakeResponse('not the expected format');
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await assert.rejects(() => summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' }));
});

test('simplify() handles a SECTIONS block with multiple sections and an empty NEXT_STEPS', async () => {
  const text = [
    'OVERVIEW:', 'One.', '',
    'SECTIONS:',
    'EMOJI: 💰', 'HEADER: Market', 'BULLETS:', '- Deal closed',
    '',
    'EMOJI: 👥', 'HEADER: Team', 'BULLETS:', '- Hired one engineer',
    '',
    'ACTION_ITEMS:', '**Name**', 'Get the doc.', '',
    'NEXT_STEPS:', '- None noted this cycle.',
  ].join('\n');
  const httpPost = async () => fakeResponse(text);
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  const result = await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' });

  assert.equal(result.sections.length, 2);
  assert.deepEqual(result.sections[0], { emoji: '💰', header: 'Market', bullets: ['Deal closed'] });
  assert.deepEqual(result.sections[1], { emoji: '👥', header: 'Team', bullets: ['Hired one engineer'] });
  assert.equal(result.next_steps, 'None noted this cycle.');
});

test('simplify() sends a prompt banning semicolon-chained overview sentences, bare process verbs, and inventing deadlines/outcomes', async () => {
  const calls = [];
  const httpPost = async (url, body) => { calls.push({ url, body }); return fakeResponse(FULL_RESPONSE); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' });

  const prompt = calls[0].body.messages[0].content;
  assert.match(prompt, /never chain multiple facts into one sentence with semicolons/);
  assert.match(prompt, /never a bare process verb alone \(discuss\/follow up\/coordinate\/review\)/);
  assert.match(prompt, /do not guess one and do not add a placeholder — simply omit the deadline/);
  assert.match(prompt, /without inventing specificity or flagging the gap/);
  assert.doesNotMatch(prompt, /\(TBC\)/);
  assert.doesNotMatch(prompt, /outcome: TBC/);
});

test('simplify() sends a prompt requiring blockers to be flagged with the warning emoji', async () => {
  const calls = [];
  const httpPost = async (url, body) => { calls.push({ url, body }); return fakeResponse(FULL_RESPONSE); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' });

  const prompt = calls[0].body.messages[0].content;
  assert.match(prompt, /waiting on.*blocked by.*pending/i);
  assert.match(prompt, /⚠️/);
});

test('simplify() sends a prompt requiring a task to be reassigned to the new owner on a clear handoff', async () => {
  const calls = [];
  const httpPost = async (url, body) => { calls.push({ url, body }); return fakeResponse(FULL_RESPONSE); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' });

  const prompt = calls[0].body.messages[0].content;
  assert.match(prompt, /handoff/i);
  assert.match(prompt, /new owner/i);
});

test('simplify() includes prior open items and narrative in the prompt when context.seriesState is passed', async () => {
  const calls = [];
  const httpPost = async (url, body) => { calls.push({ body }); return fakeResponse(FULL_RESPONSE); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  const seriesState = { open_items: [{ text: 'Old item', assignee: 'B', status: 'open' }], narrative: 'Prior narrative text.' };
  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' }, { seriesState });

  const prompt = calls[0].body.messages[0].content;
  assert.match(prompt, /Old item/);
  assert.match(prompt, /Prior narrative text\./);
});

test('simplify() omits the series-context block entirely when context.seriesState is not passed (backward compatible)', async () => {
  const calls = [];
  const httpPost = async (url, body) => { calls.push({ body }); return fakeResponse(FULL_RESPONSE); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' });

  const prompt = calls[0].body.messages[0].content;
  assert.doesNotMatch(prompt, /Prior open items/);
});

test('simplify() includes the company tone hint in the prompt when context.company is passed', async () => {
  const calls = [];
  const httpPost = async (url, body) => { calls.push({ url, body }); return fakeResponse(FULL_RESPONSE); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' }, { company: 'BOND' });

  const prompt = calls[0].body.messages[0].content;
  assert.match(prompt, /semi-formal, highly execution-focused/);
});

test('simplify() omits any tone hint when no company is passed, and both context fields can be passed together', async () => {
  const calls = [];
  const httpPost = async (url, body) => { calls.push({ url, body }); return fakeResponse(FULL_RESPONSE); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' }, { seriesState: { open_items: [], narrative: 'N.' } });

  const prompt = calls[0].body.messages[0].content;
  assert.doesNotMatch(prompt, /execution-focused/);
  assert.doesNotMatch(prompt, /decision-focused/);
  assert.match(prompt, /N\./);
});
