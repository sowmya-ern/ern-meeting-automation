const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotifier } = require('../src/notifier');

test('notifySummaryTo posts to the given chatId with overview and action items', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };

    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });
    const summary = { title: 'ERN Daily Sync', attendees: [], overview: 'Great meeting', action_items: 'Do the thing' };

    await notifier.notifySummaryTo('chat-1', summary);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.telegram.org/bottest-token/sendMessage');
    assert.equal(calls[0].body.chat_id, 'chat-1');
    assert.match(calls[0].body.text, /Great meeting/);
    assert.match(calls[0].body.text, /Do the thing/);
    assert.equal(calls[0].body.parse_mode, 'HTML');
});

test('notifySummaryTo escapes HTML special characters and converts **bold** markers into <b> tags', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };

    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });
    const summary = {
        title: 'Bond Daily Standup',
        attendees: [],
        overview: 'A <script> & things',
        action_items: 'Review the **July 15** deadline',
    };

    await notifier.notifySummaryTo('chat-1', summary);

    const { text } = calls[0].body;
    assert.match(text, /A &lt;script&gt; &amp; things/);
    assert.match(text, /Review the <b>July 15<\/b> deadline/);
    assert.doesNotMatch(text, /<script>/);
});

test('notifySummaryTo opens with an @mention line built from attendee display names', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };

    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });
    const summary = {
        title: 'Bond Daily Standup',
        attendees: ['Taweh Bey Solowii', 'Vinson Leow', 'Random Guest'],
        overview: 'Great meeting',
        action_items: 'Do the thing',
    };

    await notifier.notifySummaryTo('chat-1', summary);

    const { text } = calls[0].body;
    assert.match(text, /@tawehbeysolowii @vinsonleow Random Guest/);
    assert.match(text, /Bond Daily Standup Summary/);
});

test('sendPlainText posts the given text to the given chatId with no parse_mode', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };
    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });

    await notifier.sendPlainText('chat-1', 'Hey guys, agenda text drafted by the routine.');

    assert.equal(calls[0].body.chat_id, 'chat-1');
    assert.equal(calls[0].body.text, 'Hey guys, agenda text drafted by the routine.');
    assert.equal('parse_mode' in calls[0].body, false, 'the relay path sends verbatim text the routine already composed, not HTML');
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
    assert.equal(calls[0].body.parse_mode, 'HTML');
});

test('notifyUnrouted posts to unroutedChatId (not opsChatId) with the meeting title and summary', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };

    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', unroutedChatId: 'super-team-chat', httpPost });
    const summary = { title: 'Random 1:1', overview: 'ov', action_items: 'ai' };
    await notifier.notifyUnrouted('meeting-7', 'Random 1:1', summary);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.chat_id, 'super-team-chat');
    assert.match(calls[0].body.text, /Random 1:1/);
    assert.match(calls[0].body.text, /meeting-7/);
    assert.match(calls[0].body.text, /ov/);
    assert.equal(calls[0].body.parse_mode, 'HTML');
});
