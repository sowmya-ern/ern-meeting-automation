const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistoryConsolidator } = require('../src/history-consolidator');

function textResponse(text) {
  return { data: { content: [{ type: 'text', text }] } };
}

test('consolidate() sends prior state + this meeting to the Anthropic API and parses updated state back out', async () => {
  const calls = [];
  const httpPost = async (url, body, config) => {
    calls.push({ url, body, config });
    return textResponse('OPEN_ITEMS:\n[{"text":"Ship X","assignee":"A","status":"open","first_seen":"2026-06-20"}]\n\nNARRATIVE:\nX is still in progress.');
  };
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost });

  const seriesState = { open_items: [], narrative: '' };
  const meeting = { title: 'Bond Daily', attendees: ['A'], overview: 'raw overview', action_items: 'raw items' };
  const result = await consolidator.consolidate({ seriesState, meeting });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].config.headers['x-api-key'], 'test-key');
  assert.match(calls[0].body.messages[0].content, /raw overview/);
  assert.match(calls[0].body.messages[0].content, /raw items/);

  assert.deepEqual(result.open_items, [{ text: 'Ship X', assignee: 'A', status: 'open', first_seen: '2026-06-20', carry_over_count: 0 }]);
  assert.equal(result.narrative, 'X is still in progress.');
});

test('consolidate() includes prior open items and narrative in the prompt when seriesState is populated', async () => {
  const calls = [];
  const httpPost = async (url, body) => {
    calls.push({ body });
    return textResponse('OPEN_ITEMS:\n[]\n\nNARRATIVE:\nUpdated.');
  };
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost });

  const seriesState = { open_items: [{ text: 'Old item', assignee: 'B', status: 'open' }], narrative: 'Prior narrative text.' };
  const meeting = { title: 'Bond Daily', attendees: ['B'], overview: 'ov', action_items: 'ai' };
  await consolidator.consolidate({ seriesState, meeting });

  assert.match(calls[0].body.messages[0].content, /Old item/);
  assert.match(calls[0].body.messages[0].content, /Prior narrative text\./);
});

test('consolidate() handles a null seriesState (first tracked meeting for a series) without throwing', async () => {
  const httpPost = async () => textResponse('OPEN_ITEMS:\n[]\n\nNARRATIVE:\nFirst meeting tracked.');
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost });

  const result = await consolidator.consolidate({ seriesState: null, meeting: { title: 'Bond Daily', overview: 'ov', action_items: 'ai' } });
  assert.deepEqual(result.open_items, []);
  assert.equal(result.narrative, 'First meeting tracked.');
});

test('consolidate() finds the text block even when a "thinking" block precedes it in content[]', async () => {
  const httpPost = async () => ({
    data: {
      content: [
        { type: 'thinking', thinking: '', signature: 'abc' },
        { type: 'text', text: 'OPEN_ITEMS:\n[]\n\nNARRATIVE:\nOk.' },
      ],
    },
  });
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost });

  const result = await consolidator.consolidate({ seriesState: null, meeting: { title: 'T', overview: 'ov', action_items: 'ai' } });
  assert.equal(result.narrative, 'Ok.');
});

test('consolidate() rejects when the response is missing the expected OPEN_ITEMS/NARRATIVE markers', async () => {
  const httpPost = async () => textResponse('not the expected format');
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost });

  await assert.rejects(() => consolidator.consolidate({ seriesState: null, meeting: { title: 'T', overview: 'ov', action_items: 'ai' } }));
});

test('consolidate() rejects when OPEN_ITEMS is not valid JSON', async () => {
  const httpPost = async () => textResponse('OPEN_ITEMS:\nnot json\n\nNARRATIVE:\nOk.');
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost });

  await assert.rejects(() => consolidator.consolidate({ seriesState: null, meeting: { title: 'T', overview: 'ov', action_items: 'ai' } }));
});
