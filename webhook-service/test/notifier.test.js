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

test('notifyUnrouted posts to unroutedChatId (not opsChatId) with the meeting title, summary, and guessed company when given', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };

    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', unroutedChatId: 'super-team-chat', httpPost });
    const summary = { title: 'Random 1:1', overview: 'ov', action_items: 'ai' };
    await notifier.notifyUnrouted('meeting-7', 'Random 1:1', summary, 'BOND');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.chat_id, 'super-team-chat');
    assert.match(calls[0].body.text, /Random 1:1/);
    assert.match(calls[0].body.text, /meeting-7/);
    assert.match(calls[0].body.text, /ov/);
    assert.match(calls[0].body.text, /classified as Bond by content/);
    assert.equal(calls[0].body.parse_mode, 'HTML');
});

test('notifyUnrouted omits the classification note when no company is guessed', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };

    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', unroutedChatId: 'super-team-chat', httpPost });
    const summary = { title: 'Random 1:1', overview: 'ov', action_items: 'ai' };
    await notifier.notifyUnrouted('meeting-8', 'Random 1:1', summary, null);

    assert.doesNotMatch(calls[0].body.text, /classified as/);
});

test('notifyAgendaOverviewTo renders the title, overview, and section blocks with emoji/bold headers and bullets', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };
    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });

    const summary = {
        title: 'Bond Daily Standup',
        overview: 'Ship X progressed.',
        sections: [{ emoji: '🛠', header: 'Engineering', bullets: ['Shipped the API', '⚠️ Waiting on RE7'] }],
    };
    await notifier.notifyAgendaOverviewTo('chat-1', summary);

    const { text } = calls[0].body;
    assert.match(text, /Bond Daily Standup/);
    assert.match(text, /Ship X progressed\./);
    assert.match(text, /<b>Engineering<\/b>/);
    assert.match(text, /• Shipped the API/);
    assert.match(text, /• ⚠️ Waiting on RE7/);
    assert.equal(calls[0].body.parse_mode, 'HTML');
});

test('notifyAgendaOverviewTo renders overview-only when sections is absent (raw-fallback case)', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };
    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });

    await notifier.notifyAgendaOverviewTo('chat-1', { title: 'ERN Daily Sync', overview: 'Raw overview text.' });

    const { text } = calls[0].body;
    assert.match(text, /Raw overview text\./);
});

test('notifyAgendaOverviewTo escapes HTML special characters in overview and section bullets', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };
    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });

    await notifier.notifyAgendaOverviewTo('chat-1', {
        title: 'T', overview: 'A <script> & things', sections: [{ emoji: '👥', header: 'Team', bullets: ['<b>raw</b> tag'] }],
    });

    const { text } = calls[0].body;
    assert.match(text, /A &lt;script&gt; &amp; things/);
    assert.doesNotMatch(text, /<script>/);
});

test('notifyTodosTo groups action items, converts assignee names to handles, and includes the recording link', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };
    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });

    await notifier.notifyTodosTo('chat-1', {
        title: 'Bond Daily Standup',
        action_items: '**Vinson Leow**\n⚠️ Get the doc.',
        next_steps: 'Prep board update',
        recordingUrl: 'https://app.fireflies.ai/view/abc123',
    });

    const { text } = calls[0].body;
    assert.match(text, /<b>@vinsonleow<\/b>/);
    assert.match(text, /⚠️ Get the doc\./);
    assert.match(text, /Prep board update/);
    assert.match(text, /https:\/\/app\.fireflies\.ai\/view\/abc123/);
});

test('notifyTodosTo omits the recording line and Next Steps section when absent', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };
    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });

    await notifier.notifyTodosTo('chat-1', { title: 'T', action_items: '**Name**\nGet the doc.' });

    const { text } = calls[0].body;
    assert.doesNotMatch(text, /Recording/);
    assert.doesNotMatch(text, /Next Steps/);
});
