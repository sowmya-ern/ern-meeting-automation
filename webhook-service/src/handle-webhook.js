// Fireflies Webhooks V2 event name (the V1 name, 'Transcription completed', is legacy —
// see app.js for the V2 payload-field translation: `event`/`meeting_id` -> `eventType`/`meetingId`).
const MEETING_SUMMARIZED = 'meeting.summarized';

async function simplifyOrFallback(summarizer, summary, seriesState) {
    if (!summarizer) {
        return summary;
    }
    try {
        const { overview, action_items } = await summarizer.simplify(summary, seriesState);
        return { ...summary, overview, action_items };
    } catch (error) {
        return summary;
    }
}

// Returns null (treated as "no history yet") on any failure -- a degraded/unreachable history
// store must never block the pipeline, same precedent as the summarizer's own fallback.
async function fetchSeriesStateOrNull(meetingHistory, seriesKey) {
    if (!meetingHistory || !seriesKey) return null;
    try {
        return await meetingHistory.getSeriesState(seriesKey);
    } catch (error) {
        return null;
    }
}

// Best-effort: runs only after notifySummaryTo has already succeeded, so a failure here must
// never surface as notifyOpsFailure or affect what was already sent (ADR-0003's "a degraded
// feature is not an ops failure" precedent, extended to this second automatic model call).
async function consolidateHistoryBestEffort({ meetingHistory, historyConsolidator, seriesKey, seriesState, meetingId, rawSummary, condensedSummary }) {
    if (!meetingHistory || !historyConsolidator) return;
    try {
        const updated = await historyConsolidator.consolidate({ seriesState, meeting: rawSummary });
        await meetingHistory.appendHistory({
            series_key: seriesKey,
            meeting_id: meetingId,
            title: rawSummary.title,
            attendees: rawSummary.attendees ?? [],
            raw_overview: rawSummary.overview,
            raw_action_items: rawSummary.action_items,
            condensed_overview: condensedSummary.overview,
            condensed_action_items: condensedSummary.action_items,
        });
        await meetingHistory.upsertSeriesState(seriesKey, { open_items: updated.open_items, narrative: updated.narrative, lastMeetingId: meetingId });
    } catch (error) {
        // swallow -- best-effort, see comment above
    }
}

async function handleFirefliesWebhook({ eventType, meetingId }, { firefliesClient, notifier, seenMeetings, meetingRouter, summarizer, meetingHistory, historyConsolidator }) {
    if (eventType !== MEETING_SUMMARIZED) {
        return { status: 'ignored', meetingId };
    }

    if (seenMeetings.has(meetingId)) {
        return { status: 'duplicate', meetingId };
    }
    seenMeetings.markSeen(meetingId);

    try {
        const rawSummary = await firefliesClient.fetchSummary(meetingId);

        if (!rawSummary) {
            await notifier.notifyOpsFailure(meetingId, 'summary was not ready after retrying');
            return { status: 'failed', meetingId };
        }

        const seriesKey = meetingRouter.resolveSeriesKey(rawSummary.title);
        const seriesState = await fetchSeriesStateOrNull(meetingHistory, seriesKey);

        const summary = await simplifyOrFallback(summarizer, rawSummary, seriesState);

        const chatId = meetingRouter.resolveChatId(summary.title);
        if (!chatId) {
            await notifier.notifyUnrouted(meetingId, summary.title, summary);
            return { status: 'unrouted', meetingId };
        }

        await notifier.notifySummaryTo(chatId, summary);

        if (seriesKey) {
            await consolidateHistoryBestEffort({ meetingHistory, historyConsolidator, seriesKey, seriesState, meetingId, rawSummary, condensedSummary: summary });
        }

        return { status: 'processed', meetingId };
    } catch (error) {
        await notifier.notifyOpsFailure(meetingId, error.message).catch(() => {});
        return { status: 'failed', meetingId };
    }
}

module.exports = { handleFirefliesWebhook };
