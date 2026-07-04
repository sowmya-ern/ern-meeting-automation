const test = require('node:test');
const assert = require('node:assert/strict');

const { handleFirefliesWebhook } = require('../src/handle-webhook');
const { createSeenMeetings } = require('../src/seen-meetings');
const { createMeetingRouter } = require('../src/meeting-router');

function fakeDeps({ summary = { title: 'ERN Daily Sync', overview: 'ov', action_items: 'ai' }, fetchSummaryImpl, meetingRouter } = {}) {
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
    const router = meetingRouter || createMeetingRouter([{ match: 'ERN Daily Sync', chatId: 'super-team-chat' }]);
    return { firefliesClient, notifier, seenMeetings, meetingRouter: router, calls };
}

test('ignores events that are not "meeting.summarized"', async () => {
    const deps = fakeDeps();
    const result = await handleFirefliesWebhook({ eventType: 'Something else', meetingId: 'm1' }, deps);
    assert.deepEqual(result, { status: 'ignored', meetingId: 'm1' });
    assert.equal(deps.calls.fetchSummary, 0);
});

test('returns duplicate on a second call for the same meetingId without calling firefliesClient again', async () => {
    const deps = fakeDeps();
    const event = { eventType: 'meeting.summarized', meetingId: 'm1' };

    const first = await handleFirefliesWebhook(event, deps);
    assert.equal(first.status, 'processed');
    assert.equal(deps.calls.fetchSummary, 1);

    const second = await handleFirefliesWebhook(event, deps);
    assert.deepEqual(second, { status: 'duplicate', meetingId: 'm1' });
    assert.equal(deps.calls.fetchSummary, 1, 'firefliesClient should not be called again');
});

test('calls notifier.notifySummaryTo the routed chat on success', async () => {
    const deps = fakeDeps({ summary: { title: 'ERN Daily Sync', overview: 'ov', action_items: 'ai' } });
    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm2' }, deps);
    assert.equal(result.status, 'processed');
    assert.equal(deps.calls.notifySummaryTo, 1);
    assert.equal(deps.calls.notifyOpsFailure, 0);
    assert.equal(deps.calls.notifyUnrouted, 0);
});

test('calls notifier.notifyOpsFailure when fetchSummary resolves null', async () => {
    const deps = fakeDeps({ fetchSummaryImpl: async () => null });
    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm3' }, deps);
    assert.equal(result.status, 'failed');
    assert.equal(deps.calls.notifyOpsFailure, 1);
    assert.equal(deps.calls.notifySummaryTo, 0);
});

test('calls notifier.notifyOpsFailure when fetchSummary throws', async () => {
    const deps = fakeDeps({ fetchSummaryImpl: async () => { throw new Error('boom'); } });
    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm4' }, deps);
    assert.equal(result.status, 'failed');
    assert.equal(deps.calls.notifyOpsFailure, 1);
});

test('calls notifier.notifyUnrouted when no routing rule matches the meeting title', async () => {
    const deps = fakeDeps({ summary: { title: 'Random 1:1', overview: 'ov', action_items: 'ai' } });
    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm5' }, deps);
    assert.equal(result.status, 'unrouted');
    assert.equal(deps.calls.notifyUnrouted, 1);
    assert.equal(deps.calls.notifySummaryTo, 0);
    assert.equal(deps.calls.notifyOpsFailure, 0);
});

test('uses the summarizer to simplify the summary before notifying, when a summarizer is provided', async () => {
    const deps = fakeDeps({ summary: { title: 'ERN Daily Sync', attendees: ['A'], overview: 'long overview', action_items: 'long items' } });
    let notified;
    deps.notifier.notifySummaryTo = async (chatId, summary) => { deps.calls.notifySummaryTo += 1; notified = summary; };
    const summarizer = { simplify: async () => ({ overview: 'short overview', action_items: 'short items' }) };

    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm6' }, { ...deps, summarizer });

    assert.equal(result.status, 'processed');
    assert.equal(notified.overview, 'short overview');
    assert.equal(notified.action_items, 'short items');
    assert.equal(notified.title, 'ERN Daily Sync', 'title/attendees should pass through unchanged');
});

test('falls back to the raw summary when the summarizer throws', async () => {
    const deps = fakeDeps({ summary: { title: 'ERN Daily Sync', overview: 'long overview', action_items: 'long items' } });
    let notified;
    deps.notifier.notifySummaryTo = async (chatId, summary) => { deps.calls.notifySummaryTo += 1; notified = summary; };
    const summarizer = { simplify: async () => { throw new Error('anthropic api down'); } };

    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm7' }, { ...deps, summarizer });

    assert.equal(result.status, 'processed');
    assert.equal(notified.overview, 'long overview');
    assert.equal(notified.action_items, 'long items');
    assert.equal(deps.calls.notifyOpsFailure, 0, 'a summarizer failure must not be treated as a processing failure');
});

test('does not call meetingHistory or historyConsolidator when the meeting has no seriesKey', async () => {
    const deps = fakeDeps();
    const meetingHistory = { getSeriesState: async () => { throw new Error('should not be called'); } };
    const historyConsolidator = { consolidate: async () => { throw new Error('should not be called'); } };

    const result = await handleFirefliesWebhook(
        { eventType: 'meeting.summarized', meetingId: 'm8' },
        { ...deps, meetingHistory, historyConsolidator }
    );

    assert.equal(result.status, 'processed');
});

test('fetches series state, passes it to the summarizer, and writes updated history when the meeting has a seriesKey', async () => {
    const router = createMeetingRouter([{ match: 'Bond Daily', chatId: 'bond-chat', seriesKey: 'BOND_TEAM' }]);
    const deps = fakeDeps({ summary: { title: 'Bond Daily', attendees: ['A'], overview: 'raw ov', action_items: 'raw ai' }, meetingRouter: router });

    const historyCalls = { getSeriesState: [], appendHistory: [], upsertSeriesState: [] };
    const meetingHistory = {
        getSeriesState: async (seriesKey) => { historyCalls.getSeriesState.push(seriesKey); return { open_items: [{ text: 'Old', status: 'open' }], narrative: 'Prior narrative.' }; },
        appendHistory: async (row) => { historyCalls.appendHistory.push(row); },
        upsertSeriesState: async (seriesKey, state) => { historyCalls.upsertSeriesState.push({ seriesKey, state }); },
    };

    let summarizerCalledWith;
    const summarizer = { simplify: async (summary, seriesState) => { summarizerCalledWith = { summary, seriesState }; return { overview: 'condensed ov', action_items: 'condensed ai' }; } };

    const historyConsolidator = { consolidate: async ({ seriesState, meeting }) => ({ open_items: [{ text: 'Old', status: 'closed', closed_reason: 'done' }], narrative: 'Updated narrative.' }) };

    const result = await handleFirefliesWebhook(
        { eventType: 'meeting.summarized', meetingId: 'm9' },
        { ...deps, summarizer, meetingHistory, historyConsolidator }
    );

    assert.equal(result.status, 'processed');
    assert.deepEqual(historyCalls.getSeriesState, ['BOND_TEAM']);
    assert.deepEqual(summarizerCalledWith.seriesState, { open_items: [{ text: 'Old', status: 'open' }], narrative: 'Prior narrative.' });

    assert.equal(historyCalls.appendHistory.length, 1);
    assert.equal(historyCalls.appendHistory[0].series_key, 'BOND_TEAM');
    assert.equal(historyCalls.appendHistory[0].meeting_id, 'm9');
    assert.equal(historyCalls.appendHistory[0].raw_overview, 'raw ov');
    assert.equal(historyCalls.appendHistory[0].condensed_overview, 'condensed ov');

    assert.equal(historyCalls.upsertSeriesState.length, 1);
    assert.equal(historyCalls.upsertSeriesState[0].seriesKey, 'BOND_TEAM');
    assert.deepEqual(historyCalls.upsertSeriesState[0].state.open_items, [{ text: 'Old', status: 'closed', closed_reason: 'done' }]);
    assert.equal(historyCalls.upsertSeriesState[0].state.narrative, 'Updated narrative.');
});

test('a getSeriesState failure is treated as no history yet, and does not block the summary or call notifyOpsFailure', async () => {
    const router = createMeetingRouter([{ match: 'Bond Daily', chatId: 'bond-chat', seriesKey: 'BOND_TEAM' }]);
    const deps = fakeDeps({ summary: { title: 'Bond Daily', overview: 'ov', action_items: 'ai' }, meetingRouter: router });

    const meetingHistory = { getSeriesState: async () => { throw new Error('supabase down'); }, appendHistory: async () => {}, upsertSeriesState: async () => {} };
    let summarizerCalledWith;
    const summarizer = { simplify: async (summary, seriesState) => { summarizerCalledWith = seriesState; return { overview: 'ov', action_items: 'ai' }; } };

    const result = await handleFirefliesWebhook(
        { eventType: 'meeting.summarized', meetingId: 'm10' },
        { ...deps, summarizer, meetingHistory, historyConsolidator: { consolidate: async () => ({ open_items: [], narrative: '' }) } }
    );

    assert.equal(result.status, 'processed');
    assert.equal(deps.calls.notifyOpsFailure, 0);
    assert.equal(summarizerCalledWith, null);
});

test('a historyConsolidator failure does not block the summary, does not call notifyOpsFailure, and skips the history write', async () => {
    const router = createMeetingRouter([{ match: 'Bond Daily', chatId: 'bond-chat', seriesKey: 'BOND_TEAM' }]);
    const deps = fakeDeps({ summary: { title: 'Bond Daily', overview: 'ov', action_items: 'ai' }, meetingRouter: router });

    const historyCalls = { appendHistory: 0, upsertSeriesState: 0 };
    const meetingHistory = {
        getSeriesState: async () => null,
        appendHistory: async () => { historyCalls.appendHistory += 1; },
        upsertSeriesState: async () => { historyCalls.upsertSeriesState += 1; },
    };
    const historyConsolidator = { consolidate: async () => { throw new Error('anthropic down'); } };

    const result = await handleFirefliesWebhook(
        { eventType: 'meeting.summarized', meetingId: 'm11' },
        { ...deps, meetingHistory, historyConsolidator }
    );

    assert.equal(result.status, 'processed');
    assert.equal(deps.calls.notifySummaryTo, 1);
    assert.equal(deps.calls.notifyOpsFailure, 0);
    assert.equal(historyCalls.appendHistory, 0);
    assert.equal(historyCalls.upsertSeriesState, 0);
});
