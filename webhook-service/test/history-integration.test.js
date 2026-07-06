const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistoryConsolidator } = require('../src/history-consolidator');
const { createMeetingHistory } = require('../src/meeting-history');

test('a real history-consolidator output is accepted as-is by meeting-history.upsertSeriesState, no field mismatch', async () => {
  const fakeAnthropicPost = async () => ({
    data: { content: [{ type: 'text', text: 'OPEN_ITEMS:\n[{"text":"Ship X","assignee":"A","status":"open","first_seen":"2026-07-01"}]\n\nNARRATIVE:\nX is progressing.' }] },
  });
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost: fakeAnthropicPost });

  const upsertCalls = [];
  const fakeSupabasePost = async (url, body, config) => { upsertCalls.push({ url, body, config }); };
  const meetingHistory = createMeetingHistory({ url: 'https://example.supabase.co', serviceKey: 'test-key', httpPost: fakeSupabasePost });

  const { open_items, narrative } = await consolidator.consolidate({
    seriesState: null,
    meeting: { title: 'Bond Daily', attendees: ['A'], overview: 'ov', action_items: 'ai' },
  });
  await meetingHistory.upsertSeriesState('BOND_TEAM', { open_items, narrative, lastMeetingId: 'm1' });

  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0].body.open_items, [{ text: 'Ship X', assignee: 'A', status: 'open', first_seen: '2026-07-01', carry_over_count: 0 }]);
  assert.equal(upsertCalls[0].body.narrative, 'X is progressing.');
});

test('a real meeting-history.getSeriesState output is accepted as-is by history-consolidator.consolidate as seriesState input', async () => {
  const fakeSupabaseGet = async () => ({
    data: [{ open_items: [{ text: 'Old item', assignee: 'B', status: 'open', first_seen: '2026-06-20' }], narrative: 'Prior narrative.' }],
  });
  const meetingHistory = createMeetingHistory({ url: 'https://example.supabase.co', serviceKey: 'test-key', httpGet: fakeSupabaseGet });

  const anthropicCalls = [];
  const fakeAnthropicPost = async (url, body) => {
    anthropicCalls.push({ body });
    return { data: { content: [{ type: 'text', text: 'OPEN_ITEMS:\n[]\n\nNARRATIVE:\nUpdated.' }] } };
  };
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost: fakeAnthropicPost });

  const seriesState = await meetingHistory.getSeriesState('BOND_TEAM');
  await consolidator.consolidate({ seriesState, meeting: { title: 'Bond Daily', overview: 'ov', action_items: 'ai' } });

  assert.match(anthropicCalls[0].body.messages[0].content, /Old item/);
  assert.match(anthropicCalls[0].body.messages[0].content, /Prior narrative\./);
});
