const test = require('node:test');
const assert = require('node:assert/strict');
const { createFirefliesClient } = require('../src/fireflies-client');

function fakeSleep() {
  return Promise.resolve();
}

test('returns the summary on the first successful call', async () => {
  let httpPostCalls = 0;
  let sleepCalls = 0;

  const summary = { overview: 'Great meeting', action_items: 'Do the thing' };

  const httpPost = async () => {
    httpPostCalls += 1;
    return { data: { data: { transcript: { title: 'ERN Daily Sync', summary } } } };
  };

  const sleep = async () => {
    sleepCalls += 1;
    return fakeSleep();
  };

  const client = createFirefliesClient({
    apiKey: 'test-key',
    retries: 3,
    delayMs: 1,
    sleep,
    httpPost,
  });

  const result = await client.fetchSummary('meeting-1');

  assert.deepEqual(result, { title: 'ERN Daily Sync', attendees: [], ...summary });
  assert.equal(httpPostCalls, 1);
  assert.equal(sleepCalls, 0);
});

test('includes attendee display names from meeting_attendees when present', async () => {
  const summary = { overview: 'Great meeting', action_items: 'Do the thing' };
  const meeting_attendees = [{ displayName: 'Taweh Bey Solowii' }, { displayName: 'Vinson Leow' }];

  const httpPost = async () => ({
    data: { data: { transcript: { title: 'Bond Daily Standup', summary, meeting_attendees } } },
  });

  const client = createFirefliesClient({
    apiKey: 'test-key',
    retries: 3,
    delayMs: 1,
    sleep: fakeSleep,
    httpPost,
  });

  const result = await client.fetchSummary('meeting-attendees');

  assert.deepEqual(result.attendees, ['Taweh Bey Solowii', 'Vinson Leow']);
});

test('retries the configured number of times then returns null', async () => {
  let httpPostCalls = 0;
  let sleepCalls = 0;

  const httpPost = async () => {
    httpPostCalls += 1;
    return { data: { data: { transcript: { summary: { overview: '', action_items: '' } } } } };
  };

  const sleep = async () => {
    sleepCalls += 1;
    return fakeSleep();
  };

  const client = createFirefliesClient({
    apiKey: 'test-key',
    retries: 3,
    delayMs: 1,
    sleep,
    httpPost,
  });

  const result = await client.fetchSummary('meeting-2');

  assert.equal(result, null);
  assert.equal(httpPostCalls, 3);
  assert.equal(sleepCalls, 2);
});

test('does not call sleep after a successful attempt', async () => {
  let httpPostCalls = 0;
  let sleepCalls = 0;

  const summary = { overview: 'Second time lucky', action_items: 'Follow up' };

  const httpPost = async () => {
    httpPostCalls += 1;
    if (httpPostCalls === 1) {
      return { data: { data: { transcript: { title: 'ERN Daily Sync', summary: { overview: '', action_items: '' } } } } };
    }
    return { data: { data: { transcript: { title: 'ERN Daily Sync', summary } } } };
  };

  const sleep = async () => {
    sleepCalls += 1;
    return fakeSleep();
  };

  const client = createFirefliesClient({
    apiKey: 'test-key',
    retries: 10,
    delayMs: 1,
    sleep,
    httpPost,
  });

  const result = await client.fetchSummary('meeting-3');

  assert.deepEqual(result, { title: 'ERN Daily Sync', attendees: [], ...summary });
  assert.equal(httpPostCalls, 2);
  assert.equal(sleepCalls, 1);
});
