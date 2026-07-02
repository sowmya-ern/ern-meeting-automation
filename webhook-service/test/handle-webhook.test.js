const test = require('node:test');
const assert = require('node:assert/strict');

const { handleFirefliesWebhook } = require('../src/handle-webhook');
const { createSeenMeetings } = require('../src/seen-meetings');

function fakeDeps({ summary = { overview: 'ov', action_items: 'ai' }, fetchSummaryImpl } = {}) {
    const calls = { fetchSummary: 0, notifySummary: 0, notifyOpsFailure: 0 };
    const firefliesClient = {
        fetchSummary: async (meetingId) => {
            calls.fetchSummary += 1;
            if (fetchSummaryImpl) return fetchSummaryImpl(meetingId);
            return summary;
        },
    };
    const notifier = {
        notifySummary: async () => { calls.notifySummary += 1; },
        notifyOpsFailure: async () => { calls.notifyOpsFailure += 1; },
    };
    const seenMeetings = createSeenMeetings();
    return { firefliesClient, notifier, seenMeetings, calls };
}

test('ignores events that are not "Transcription completed"', async () => {
    const deps = fakeDeps();
    const result = await handleFirefliesWebhook({ eventType: 'Something else', meetingId: 'm1' }, deps);
    assert.deepEqual(result, { status: 'ignored', meetingId: 'm1' });
    assert.equal(deps.calls.fetchSummary, 0);
});

test('returns duplicate on a second call for the same meetingId without calling firefliesClient again', async () => {
    const deps = fakeDeps();
    const event = { eventType: 'Transcription completed', meetingId: 'm1' };

    const first = await handleFirefliesWebhook(event, deps);
    assert.equal(first.status, 'processed');
    assert.equal(deps.calls.fetchSummary, 1);

    const second = await handleFirefliesWebhook(event, deps);
    assert.deepEqual(second, { status: 'duplicate', meetingId: 'm1' });
    assert.equal(deps.calls.fetchSummary, 1, 'firefliesClient should not be called again');
});

test('calls notifier.notifySummary on success', async () => {
    const deps = fakeDeps({ summary: { overview: 'ov', action_items: 'ai' } });
    const result = await handleFirefliesWebhook({ eventType: 'Transcription completed', meetingId: 'm2' }, deps);
    assert.equal(result.status, 'processed');
    assert.equal(deps.calls.notifySummary, 1);
    assert.equal(deps.calls.notifyOpsFailure, 0);
});

test('calls notifier.notifyOpsFailure when fetchSummary resolves null', async () => {
    const deps = fakeDeps({ fetchSummaryImpl: async () => null });
    const result = await handleFirefliesWebhook({ eventType: 'Transcription completed', meetingId: 'm3' }, deps);
    assert.equal(result.status, 'failed');
    assert.equal(deps.calls.notifyOpsFailure, 1);
    assert.equal(deps.calls.notifySummary, 0);
});

test('calls notifier.notifyOpsFailure when fetchSummary throws', async () => {
    const deps = fakeDeps({ fetchSummaryImpl: async () => { throw new Error('boom'); } });
    const result = await handleFirefliesWebhook({ eventType: 'Transcription completed', meetingId: 'm4' }, deps);
    assert.equal(result.status, 'failed');
    assert.equal(deps.calls.notifyOpsFailure, 1);
});
