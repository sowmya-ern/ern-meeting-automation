const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotifier } = require('../src/notifier');

test('notifySummaryTo posts to the given chatId with overview and action items', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };

    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });
    const summary = { title: 'ERN Daily Sync', overview: 'Great meeting', action_items: 'Do the thing' };

    await notifier.notifySummaryTo('chat-1', summary);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.telegram.org/bottest-token/sendMessage');
    assert.equal(calls[0].body.chat_id, 'chat-1');
    assert.match(calls[0].body.text, /Great meeting/);
    assert.match(calls[0].body.text, /Do the thing/);
    assert.equal('parse_mode' in calls[0].body, false);
});

test('notifyOpsFailure posts to opsChatId with meetingId and reason', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };

    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });
    await notifier.notifyOpsFailure('meeting-42', 'fetchSummary timed out');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.chat_id, 'ops-1');
    assert.match(calls[0].body.text, /meeting-42/);
    assert.match(calls[0].body.text, /fetchSummary timed out/);
    assert.equal('parse_mode' in calls[0].body, false);
});

test('notifyUnrouted posts to opsChatId with the meeting title and summary', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };

    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });
    const summary = { title: 'Random 1:1', overview: 'ov', action_items: 'ai' };
    await notifier.notifyUnrouted('meeting-7', 'Random 1:1', summary);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.chat_id, 'ops-1');
    assert.match(calls[0].body.text, /Random 1:1/);
    assert.match(calls[0].body.text, /meeting-7/);
    assert.match(calls[0].body.text, /ov/);
    assert.equal('parse_mode' in calls[0].body, false);
});
