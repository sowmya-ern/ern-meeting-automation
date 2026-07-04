const test = require('node:test');
const assert = require('node:assert/strict');

const { handleFirefliesWebhook } = require('../src/handle-webhook');
const { createSeenMeetings } = require('../src/seen-meetings');
const { createMeetingRouter } = require('../src/meeting-router');

function fakeDeps({ summary = { title: 'ERN Daily Sync', overview: 'ov', action_items: 'ai' }, fetchSummaryImpl, meetingRouter, companyClassifier } = {}) {
    const calls = { fetchSummary: 0, notifyAgendaOverviewTo: 0, notifyTodosTo: 0, notifyOpsFailure: 0, notifyUnrouted: 0 };
    const firefliesClient = {
        fetchSummary: async (meetingId) => {
            calls.fetchSummary += 1;
            if (fetchSummaryImpl) return fetchSummaryImpl(meetingId);
            return summary;
        },
    };
    const notifier = {
        notifyAgendaOverviewTo: async () => { calls.notifyAgendaOverviewTo += 1; },
        notifyTodosTo: async () => { calls.notifyTodosTo += 1; },
        notifyOpsFailure: async () => { calls.notifyOpsFailure += 1; },
        notifyUnrouted: async () => { calls.notifyUnrouted += 1; },
    };
    const seenMeetings = createSeenMeetings();
    const router = meetingRouter || createMeetingRouter([{ match: 'ERN Daily Sync', chatId: 'super-team-chat', company: 'ERN' }]);
    return { firefliesClient, notifier, seenMeetings, meetingRouter: router, companyClassifier, calls };
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

test('sends both the Agenda/Overview and To-Dos messages to the routed chat on success', async () => {
    const deps = fakeDeps({ summary: { title: 'ERN Daily Sync', overview: 'ov', action_items: 'ai' } });
    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm2' }, deps);
    assert.equal(result.status, 'processed');
    assert.equal(deps.calls.notifyAgendaOverviewTo, 1);
    assert.equal(deps.calls.notifyTodosTo, 1);
    assert.equal(deps.calls.notifyOpsFailure, 0);
    assert.equal(deps.calls.notifyUnrouted, 0);
});

test('calls notifier.notifyOpsFailure when fetchSummary resolves null', async () => {
    const deps = fakeDeps({ fetchSummaryImpl: async () => null });
    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm3' }, deps);
    assert.equal(result.status, 'failed');
    assert.equal(deps.calls.notifyOpsFailure, 1);
    assert.equal(deps.calls.notifyAgendaOverviewTo, 0);
    assert.equal(deps.calls.notifyTodosTo, 0);
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
    assert.equal(deps.calls.notifyAgendaOverviewTo, 0);
    assert.equal(deps.calls.notifyOpsFailure, 0);
});

test('uses the summarizer to simplify the summary before notifying, when a summarizer is provided', async () => {
    const deps = fakeDeps({ summary: { title: 'ERN Daily Sync', attendees: ['A'], overview: 'long overview', action_items: 'long items' } });
    let notifiedOverview, notifiedTodos;
    deps.notifier.notifyAgendaOverviewTo = async (chatId, summary) => { deps.calls.notifyAgendaOverviewTo += 1; notifiedOverview = summary; };
    deps.notifier.notifyTodosTo = async (chatId, summary) => { deps.calls.notifyTodosTo += 1; notifiedTodos = summary; };
    const summarizer = { simplify: async () => ({ overview: 'short overview', sections: [], action_items: 'short items', next_steps: '' }) };

    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm6' }, { ...deps, summarizer });

    assert.equal(result.status, 'processed');
    assert.equal(notifiedOverview.overview, 'short overview');
    assert.equal(notifiedTodos.action_items, 'short items');
    assert.equal(notifiedOverview.title, 'ERN Daily Sync', 'title/attendees should pass through unchanged');
});

test('falls back to the raw summary when the summarizer throws', async () => {
    const deps = fakeDeps({ summary: { title: 'ERN Daily Sync', overview: 'long overview', action_items: 'long items' } });
    let notifiedOverview, notifiedTodos;
    deps.notifier.notifyAgendaOverviewTo = async (chatId, summary) => { deps.calls.notifyAgendaOverviewTo += 1; notifiedOverview = summary; };
    deps.notifier.notifyTodosTo = async (chatId, summary) => { deps.calls.notifyTodosTo += 1; notifiedTodos = summary; };
    const summarizer = { simplify: async () => { throw new Error('anthropic api down'); } };

    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm7' }, { ...deps, summarizer });

    assert.equal(result.status, 'processed');
    assert.equal(notifiedOverview.overview, 'long overview');
    assert.equal(notifiedTodos.action_items, 'long items');
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

test('fetches series state, passes it to the summarizer as context.seriesState, and writes updated history when the meeting has a seriesKey', async () => {
    const router = createMeetingRouter([{ match: 'Bond Daily', chatId: 'bond-chat', seriesKey: 'BOND_TEAM', company: 'BOND' }]);
    const deps = fakeDeps({ summary: { title: 'Bond Daily', attendees: ['A'], overview: 'raw ov', action_items: 'raw ai' }, meetingRouter: router });

    const historyCalls = { getSeriesState: [], appendHistory: [], upsertSeriesState: [] };
    const meetingHistory = {
        getSeriesState: async (seriesKey) => { historyCalls.getSeriesState.push(seriesKey); return { open_items: [{ text: 'Old', status: 'open' }], narrative: 'Prior narrative.' }; },
        appendHistory: async (row) => { historyCalls.appendHistory.push(row); },
        upsertSeriesState: async (seriesKey, state) => { historyCalls.upsertSeriesState.push({ seriesKey, state }); },
    };

    let summarizerCalledWith;
    const summarizer = { simplify: async (summary, context) => { summarizerCalledWith = { summary, context }; return { overview: 'condensed ov', sections: [], action_items: 'condensed ai', next_steps: '' }; } };

    const historyConsolidator = { consolidate: async ({ seriesState, meeting }) => ({ open_items: [{ text: 'Old', status: 'closed', closed_reason: 'done' }], narrative: 'Updated narrative.' }) };

    const result = await handleFirefliesWebhook(
        { eventType: 'meeting.summarized', meetingId: 'm9' },
        { ...deps, summarizer, meetingHistory, historyConsolidator }
    );

    assert.equal(result.status, 'processed');
    assert.deepEqual(historyCalls.getSeriesState, ['BOND_TEAM']);
    assert.deepEqual(summarizerCalledWith.context.seriesState, { open_items: [{ text: 'Old', status: 'open' }], narrative: 'Prior narrative.' });
    assert.equal(summarizerCalledWith.context.company, 'BOND');

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
    const router = createMeetingRouter([{ match: 'Bond Daily', chatId: 'bond-chat', seriesKey: 'BOND_TEAM', company: 'BOND' }]);
    const deps = fakeDeps({ summary: { title: 'Bond Daily', overview: 'ov', action_items: 'ai' }, meetingRouter: router });

    const meetingHistory = { getSeriesState: async () => { throw new Error('supabase down'); }, appendHistory: async () => {}, upsertSeriesState: async () => {} };
    let summarizerCalledWithContext;
    const summarizer = { simplify: async (summary, context) => { summarizerCalledWithContext = context; return { overview: 'ov', sections: [], action_items: 'ai', next_steps: '' }; } };

    const result = await handleFirefliesWebhook(
        { eventType: 'meeting.summarized', meetingId: 'm10' },
        { ...deps, summarizer, meetingHistory, historyConsolidator: { consolidate: async () => ({ open_items: [], narrative: '' }) } }
    );

    assert.equal(result.status, 'processed');
    assert.equal(deps.calls.notifyOpsFailure, 0);
    assert.equal(summarizerCalledWithContext.seriesState, null);
});

test('a historyConsolidator failure does not block the summary, does not call notifyOpsFailure, and skips the history write', async () => {
    const router = createMeetingRouter([{ match: 'Bond Daily', chatId: 'bond-chat', seriesKey: 'BOND_TEAM', company: 'BOND' }]);
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
    assert.equal(deps.calls.notifyAgendaOverviewTo, 1);
    assert.equal(deps.calls.notifyTodosTo, 1);
    assert.equal(deps.calls.notifyOpsFailure, 0);
    assert.equal(historyCalls.appendHistory, 0);
    assert.equal(historyCalls.upsertSeriesState, 0);
});

test('resolves company via the routing table and passes it to the summarizer', async () => {
    const router = createMeetingRouter([{ match: 'Bond Daily', chatId: 'bond-chat', company: 'BOND' }]);
    const deps = fakeDeps({ summary: { title: 'Bond Daily Standup', overview: 'ov', action_items: 'ai' }, meetingRouter: router });
    let summarizerCalledWithCompany;
    const summarizer = { simplify: async (summary, context) => { summarizerCalledWithCompany = context.company; return { overview: 'ov', sections: [], action_items: 'ai', next_steps: '' }; } };

    await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm12' }, { ...deps, summarizer });

    assert.equal(summarizerCalledWithCompany, 'BOND');
});

test('falls back to the content classifier for company when the title has no routing match, but still routes to notifyUnrouted', async () => {
    const router = createMeetingRouter([{ match: 'ERN Daily Sync', chatId: 'super-team-chat', company: 'ERN' }]);
    const summary = { title: 'Ad Hoc Bond Sync', overview: 'Discussed TVL and RE7 API.', action_items: 'ai' };
    const deps = fakeDeps({ summary, meetingRouter: router });
    let unroutedCompany;
    deps.notifier.notifyUnrouted = async (meetingId, title, s, company) => { deps.calls.notifyUnrouted += 1; unroutedCompany = company; };
    const companyClassifier = { classify: () => 'BOND' };

    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm13' }, { ...deps, companyClassifier });

    assert.equal(result.status, 'unrouted');
    assert.equal(unroutedCompany, 'BOND');
});

test('both post-meeting messages are attempted independently — a failure in one does not block the other', async () => {
    const deps = fakeDeps({ summary: { title: 'ERN Daily Sync', overview: 'ov', action_items: 'ai' } });
    deps.notifier.notifyAgendaOverviewTo = async () => { deps.calls.notifyAgendaOverviewTo += 1; throw new Error('telegram down'); };
    deps.notifier.notifyTodosTo = async () => { deps.calls.notifyTodosTo += 1; };

    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm14' }, deps);

    assert.equal(result.status, 'processed');
    assert.equal(deps.calls.notifyAgendaOverviewTo, 1);
    assert.equal(deps.calls.notifyTodosTo, 1, 'the To-Dos send must still be attempted even though Agenda/Overview failed');
    assert.equal(deps.calls.notifyOpsFailure, 1, 'the partial failure must be reported to ops');
});

test('the reverse partial failure (To-Dos fails, Agenda/Overview succeeds) is also both-attempted and reported', async () => {
    const deps = fakeDeps({ summary: { title: 'ERN Daily Sync', overview: 'ov', action_items: 'ai' } });
    deps.notifier.notifyAgendaOverviewTo = async () => { deps.calls.notifyAgendaOverviewTo += 1; };
    deps.notifier.notifyTodosTo = async () => { deps.calls.notifyTodosTo += 1; throw new Error('telegram down'); };

    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm15' }, deps);

    assert.equal(result.status, 'processed');
    assert.equal(deps.calls.notifyAgendaOverviewTo, 1);
    assert.equal(deps.calls.notifyTodosTo, 1);
    assert.equal(deps.calls.notifyOpsFailure, 1);
});
