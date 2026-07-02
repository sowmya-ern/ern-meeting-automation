const test = require('node:test');
const assert = require('node:assert/strict');

const { handleFirefliesWebhook } = require('../src/handle-webhook');
const { createSeenMeetings } = require('../src/seen-meetings');
const { createMeetingRouter } = require('../src/meeting-router');

function fakeDeps({ summary = { title: 'ERN Daily Sync', overview: 'ov', action_items: 'ai' }, fetchSummaryImpl } = {}) {
    const calls = { fetchSummary: 0, notifySummaryTo: 0, notifyOpsFailure: 0, notifyUnrouted: 0 };
    const firefliesClient = {
        fetchSummary: async (meetingId) => {
            calls.fetchSummary += 1;
            if (fetchSummaryImpl) return fetchSummaryImpl(meetingId);
            return summary;
        },
    };
    const notifier = {
        notifySummaryTo: async () => { calls.notifySummaryTo += 1; },
        notifyOpsFailure: async () => { calls.notifyOpsFailure += 1; },
        notifyUnrouted: async () => { calls.notifyUnrouted += 1; },
    };
    const seenMeetings = createSeenMeetings();
    const meetingRouter = createMeetingRouter([{ match: 'ERN Daily Sync', chatId: 'super-team-chat' }]);
    return { firefliesClient, notifier, seenMeetings, meetingRouter, calls };
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

test('calls notifier.notifySummaryTo the routed chat on success', async () => {
    const deps = fakeDeps({ summary: { title: 'ERN Daily Sync', overview: 'ov', action_items: 'ai' } });
    const result = await handleFirefliesWebhook({ eventType: 'Transcription completed', meetingId: 'm2' }, deps);
    assert.equal(result.status, 'processed');
    assert.equal(deps.calls.notifySummaryTo, 1);
    assert.equal(deps.calls.notifyOpsFailure, 0);
    assert.equal(deps.calls.notifyUnrouted, 0);
});

test('calls notifier.notifyOpsFailure when fetchSummary resolves null', async () => {
    const deps = fakeDeps({ fetchSummaryImpl: async () => null });
    const result = await handleFirefliesWebhook({ eventType: 'Transcription completed', meetingId: 'm3' }, deps);
    assert.equal(result.status, 'failed');
    assert.equal(deps.calls.notifyOpsFailure, 1);
    assert.equal(deps.calls.notifySummaryTo, 0);
});

test('calls notifier.notifyOpsFailure when fetchSummary throws', async () => {
    const deps = fakeDeps({ fetchSummaryImpl: async () => { throw new Error('boom'); } });
    const result = await handleFirefliesWebhook({ eventType: 'Transcription completed', meetingId: 'm4' }, deps);
    assert.equal(result.status, 'failed');
    assert.equal(deps.calls.notifyOpsFailure, 1);
});

test('calls notifier.notifyUnrouted when no routing rule matches the meeting title', async () => {
    const deps = fakeDeps({ summary: { title: 'Random 1:1', overview: 'ov', action_items: 'ai' } });
    const result = await handleFirefliesWebhook({ eventType: 'Transcription completed', meetingId: 'm5' }, deps);
    assert.equal(result.status, 'unrouted');
    assert.equal(deps.calls.notifyUnrouted, 1);
    assert.equal(deps.calls.notifySummaryTo, 0);
    assert.equal(deps.calls.notifyOpsFailure, 0);
});
