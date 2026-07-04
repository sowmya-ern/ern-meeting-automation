const test = require('node:test');
const assert = require('node:assert/strict');
const { createMeetingHistory } = require('../src/meeting-history');

const URL = 'https://example.supabase.co';
const SERVICE_KEY = 'test-service-key';

test('getSeriesState returns null when Supabase has no row for this series yet', async () => {
  const httpGet = async () => ({ data: [] });
  const history = createMeetingHistory({ url: URL, serviceKey: SERVICE_KEY, httpGet });

  const result = await history.getSeriesState('BOND_TEAM');
  assert.equal(result, null);
});

test('getSeriesState returns open_items and narrative when a row exists', async () => {
  const calls = [];
  const httpGet = async (url, config) => {
    calls.push({ url, config });
    return { data: [{ open_items: [{ text: 'Ship X', assignee: 'A', status: 'open' }], narrative: 'ongoing work on X' }] };
  };
  const history = createMeetingHistory({ url: URL, serviceKey: SERVICE_KEY, httpGet });

  const result = await history.getSeriesState('BOND_TEAM');

  assert.deepEqual(result, { open_items: [{ text: 'Ship X', assignee: 'A', status: 'open' }], narrative: 'ongoing work on X' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /series_state\?series_key=eq\.BOND_TEAM/);
  assert.equal(calls[0].config.headers.apikey, SERVICE_KEY);
  assert.equal(calls[0].config.headers.Authorization, `Bearer ${SERVICE_KEY}`);
});

test('getSeriesState defaults open_items/narrative when the row has null columns', async () => {
  const httpGet = async () => ({ data: [{ open_items: null, narrative: null }] });
  const history = createMeetingHistory({ url: URL, serviceKey: SERVICE_KEY, httpGet });

  const result = await history.getSeriesState('BOND_TEAM');
  assert.deepEqual(result, { open_items: [], narrative: '' });
});

test('appendHistory posts the row to meeting_history with auth headers', async () => {
  const calls = [];
  const httpPost = async (url, body, config) => { calls.push({ url, body, config }); };
  const history = createMeetingHistory({ url: URL, serviceKey: SERVICE_KEY, httpPost });

  const row = { series_key: 'BOND_TEAM', meeting_id: 'm1', title: 'Bond Daily' };
  await history.appendHistory(row);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${URL}/rest/v1/meeting_history`);
  assert.deepEqual(calls[0].body, row);
  assert.equal(calls[0].config.headers.apikey, SERVICE_KEY);
});

test('upsertSeriesState posts to series_state with the merge-duplicates Prefer header', async () => {
  const calls = [];
  const httpPost = async (url, body, config) => { calls.push({ url, body, config }); };
  const history = createMeetingHistory({ url: URL, serviceKey: SERVICE_KEY, httpPost });

  await history.upsertSeriesState('BOND_TEAM', { open_items: [{ text: 'x', status: 'open' }], narrative: 'n', lastMeetingId: 'm2' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${URL}/rest/v1/series_state`);
  assert.deepEqual(calls[0].body, {
    series_key: 'BOND_TEAM',
    open_items: [{ text: 'x', status: 'open' }],
    narrative: 'n',
    last_meeting_id: 'm2',
  });
  assert.equal(calls[0].config.headers.Prefer, 'resolution=merge-duplicates');
});
