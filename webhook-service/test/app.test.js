const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');

const { createApp } = require('../src/app');
const { createSeenMeetings } = require('../src/seen-meetings');

const SECRET = 'test-secret';

function sign(body) {
    return 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

function startTestServer({ fetchSummaryImpl } = {}) {
    const calls = { notifySummary: [], notifyOpsFailure: [] };
    const firefliesClient = {
        fetchSummary: fetchSummaryImpl || (async () => ({ overview: 'ov', action_items: 'ai' })),
    };
    const notifier = {
        notifySummary: async (summary) => { calls.notifySummary.push(summary); },
        notifyOpsFailure: async (meetingId, reason) => { calls.notifyOpsFailure.push({ meetingId, reason }); },
    };

    let resolveProcessed;
    const processed = new Promise((resolve) => { resolveProcessed = resolve; });

    const app = createApp({
        secret: SECRET,
        firefliesClient,
        notifier,
        seenMeetings: createSeenMeetings(),
        onProcessed: (result) => resolveProcessed(result),
    });

    const server = app.listen(0);
    const port = server.address().port;

    return { server, port, calls, processed };
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

test('smoke: a validly signed "Transcription completed" webhook is acked and processed end-to-end', async () => {
    const { server, port, calls, processed } = startTestServer();
    try {
        const res = await postWebhook(port, { eventType: 'Transcription completed', meetingId: 'smoke-1' });
        assert.equal(res.status, 200);

        const result = await processed;
        assert.deepEqual(result, { status: 'processed', meetingId: 'smoke-1' });
        assert.equal(calls.notifySummary.length, 1);
        assert.equal(calls.notifyOpsFailure.length, 0);
    } finally {
        server.close();
    }
});

test('smoke: a webhook with a bad signature is rejected with 401 and never reaches the notifier', async () => {
    const { server, port, calls } = startTestServer();
    try {
        const res = await postWebhook(port, { eventType: 'Transcription completed', meetingId: 'smoke-2' }, { signature: 'sha256=deadbeef' });
        assert.equal(res.status, 401);
        assert.equal(calls.notifySummary.length, 0);
        assert.equal(calls.notifyOpsFailure.length, 0);
    } finally {
        server.close();
    }
});

test('smoke: when the summary never becomes ready, an ops-failure alert fires instead of a summary', async () => {
    const { server, port, calls, processed } = startTestServer({ fetchSummaryImpl: async () => null });
    try {
        await postWebhook(port, { eventType: 'Transcription completed', meetingId: 'smoke-3' });
        const result = await processed;
        assert.equal(result.status, 'failed');
        assert.equal(calls.notifyOpsFailure.length, 1);
        assert.equal(calls.notifySummary.length, 0);
    } finally {
        server.close();
    }
});
