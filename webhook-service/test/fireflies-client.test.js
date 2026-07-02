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
    return { data: { data: { transcript: { summary } } } };
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

  assert.deepEqual(result, summary);
  assert.equal(httpPostCalls, 1);
  assert.equal(sleepCalls, 0);
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
      return { data: { data: { transcript: { summary: { overview: '', action_items: '' } } } } };
    }
    return { data: { data: { transcript: { summary } } } };
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

  assert.deepEqual(result, summary);
  assert.equal(httpPostCalls, 2);
  assert.equal(sleepCalls, 1);
});
