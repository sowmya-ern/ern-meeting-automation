const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');

const { createApp } = require('../src/app');
const { createSeenMeetings } = require('../src/seen-meetings');
const { createMeetingRouter } = require('../src/meeting-router');

const SECRET = 'test-secret';
const RELAY_SECRET = 'test-relay-secret';
const ROUTED_TITLE = 'ERN Daily Sync';

function sign(body) {
    return 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

function startTestServer({ fetchSummaryImpl } = {}) {
    const calls = { notifySummaryTo: [], notifyOpsFailure: [], notifyUnrouted: [], sendPlainText: [] };
    const firefliesClient = {
        fetchSummary: fetchSummaryImpl || (async () => ({ title: ROUTED_TITLE, overview: 'ov', action_items: 'ai' })),
    };
    const notifier = {
        notifySummaryTo: async (chatId, summary) => { calls.notifySummaryTo.push({ chatId, summary }); },
        notifyOpsFailure: async (meetingId, reason) => { calls.notifyOpsFailure.push({ meetingId, reason }); },
        notifyUnrouted: async (meetingId, title, summary) => { calls.notifyUnrouted.push({ meetingId, title, summary }); },
        sendPlainText: async (chatId, text) => { calls.sendPlainText.push({ chatId, text }); },
    };
    const meetingRouter = createMeetingRouter([{ match: ROUTED_TITLE, chatId: 'super-team-chat' }]);
    const relayChatMap = { BOND_TEAM: 'bond-chat' };

    let resolveProcessed;
    const processed = new Promise((resolve) => { resolveProcessed = resolve; });

    const app = createApp({
        secret: SECRET,
        relaySecret: RELAY_SECRET,
        firefliesClient,
        notifier,
        seenMeetings: createSeenMeetings(),
        meetingRouter,
        relayChatMap,
        onProcessed: (result) => resolveProcessed(result),
    });

    const server = app.listen(0);
    const port = server.address().port;

    return { server, port, calls, processed };
}

function postRelay(port, bodyObj, { authHeader } = {}) {
    const body = JSON.stringify(bodyObj);
    const auth = authHeader !== undefined ? authHeader : `Bearer ${RELAY_SECRET}`;

    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                host: '127.0.0.1',
                port,
                path: '/relay/telegram-agenda',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    ...(auth !== null ? { Authorization: auth } : {}),
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode, body: data }));
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function postWebhook(port, bodyObj, { signature } = {}) {
    const body = JSON.stringify(bodyObj);
    const sig = signature !== undefined ? signature : sign(body);

    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                host: '127.0.0.1',
                port,
                path: '/webhook/fireflies',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    ...(sig !== null ? { 'x-hub-signature': sig } : {}),
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode, body: data }));
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

test('smoke: a validly signed Fireflies V2 "meeting.summarized" webhook is acked and routed end-to-end', async () => {
    const { server, port, calls, processed } = startTestServer();
    try {
        const res = await postWebhook(port, { event: 'meeting.summarized', meeting_id: 'smoke-1', timestamp: '2026-07-03T00:00:00Z' });
        assert.equal(res.status, 200);

        const result = await processed;
        assert.deepEqual(result, { status: 'processed', meetingId: 'smoke-1' });
        assert.equal(calls.notifySummaryTo.length, 1);
        assert.equal(calls.notifySummaryTo[0].chatId, 'super-team-chat');
        assert.equal(calls.notifyOpsFailure.length, 0);
        assert.equal(calls.notifyUnrouted.length, 0);
    } finally {
        server.close();
    }
});

test('smoke: a webhook with a bad signature is rejected with 401 and never reaches the notifier', async () => {
    const { server, port, calls } = startTestServer();
    try {
        const res = await postWebhook(port, { event: 'meeting.summarized', meeting_id: 'smoke-2' }, { signature: 'sha256=deadbeef' });
        assert.equal(res.status, 401);
        assert.equal(calls.notifySummaryTo.length, 0);
        assert.equal(calls.notifyOpsFailure.length, 0);
    } finally {
        server.close();
    }
});

test('smoke: when the summary never becomes ready, an ops-failure alert fires instead of a summary', async () => {
    const { server, port, calls, processed } = startTestServer({ fetchSummaryImpl: async () => null });
    try {
        await postWebhook(port, { event: 'meeting.summarized', meeting_id: 'smoke-3' });
        const result = await processed;
        assert.equal(result.status, 'failed');
        assert.equal(calls.notifyOpsFailure.length, 1);
        assert.equal(calls.notifySummaryTo.length, 0);
    } finally {
        server.close();
    }
});

test('smoke: an unrecognized meeting title falls back to the ops chat instead of being dropped', async () => {
    const { server, port, calls, processed } = startTestServer({
        fetchSummaryImpl: async () => ({ title: 'Random 1:1', overview: 'ov', action_items: 'ai' }),
    });
    try {
        await postWebhook(port, { event: 'meeting.summarized', meeting_id: 'smoke-4' });
        const result = await processed;
        assert.equal(result.status, 'unrouted');
        assert.equal(calls.notifyUnrouted.length, 1);
        assert.equal(calls.notifySummaryTo.length, 0);
    } finally {
        server.close();
    }
});

test('smoke: a relay request with a valid token and known chatKey sends plain text to the resolved chat', async () => {
    const { server, port, calls } = startTestServer();
    try {
        const res = await postRelay(port, { chatKey: 'BOND_TEAM', text: 'Bond Agenda...' });
        assert.equal(res.status, 200);
        assert.equal(calls.sendPlainText.length, 1);
        assert.deepEqual(calls.sendPlainText[0], { chatId: 'bond-chat', text: 'Bond Agenda...' });
    } finally {
        server.close();
    }
});

test('smoke: a relay request with a wrong token is rejected with 401 and never sends', async () => {
    const { server, port, calls } = startTestServer();
    try {
        const res = await postRelay(port, { chatKey: 'BOND_TEAM', text: 'Bond Agenda...' }, { authHeader: 'Bearer wrong-token' });
        assert.equal(res.status, 401);
        assert.equal(calls.sendPlainText.length, 0);
    } finally {
        server.close();
    }
});

test('smoke: a relay request with an unknown chatKey is rejected with 400 and never sends', async () => {
    const { server, port, calls } = startTestServer();
    try {
        const res = await postRelay(port, { chatKey: 'NOT_A_KEY', text: 'Bond Agenda...' });
        assert.equal(res.status, 400);
        assert.equal(calls.sendPlainText.length, 0);
    } finally {
        server.close();
    }
});
