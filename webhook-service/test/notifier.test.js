const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotifier } = require('../src/notifier');

test('notifySummary posts to chatId with overview and action items', async () => {
  const calls = [];

  const httpPost = async (url, body) => {
    calls.push({ url, body });
  };

  const notifier = createNotifier({
    botToken: 'test-token',
    chatId: 'chat-1',
    opsChatId: 'ops-1',
    httpPost,
  });

  const summary = { overview: 'Great meeting', action_items: 'Do the thing' };

  await notifier.notifySummary(summary);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.telegram.org/bottest-token/sendMessage');
  assert.equal(calls[0].body.chat_id, 'chat-1');
  assert.match(calls[0].body.text, /Great meeting/);
  assert.match(calls[0].body.text, /Do the thing/);
  assert.equal('parse_mode' in calls[0].body, false);
});

test('notifyOpsFailure posts to opsChatId with meetingId and reason', async () => {
  const calls = [];

  const httpPost = async (url, body) => {
    calls.push({ url, body });
  };

  const notifier = createNotifier({
    botToken: 'test-token',
    chatId: 'chat-1',
    opsChatId: 'ops-1',
    httpPost,
  });

  await notifier.notifyOpsFailure('meeting-42', 'fetchSummary timed out');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.telegram.org/bottest-token/sendMessage');
  assert.equal(calls[0].body.chat_id, 'ops-1');
  assert.match(calls[0].body.text, /meeting-42/);
  assert.match(calls[0].body.text, /fetchSummary timed out/);
  assert.equal('parse_mode' in calls[0].body, false);
});
