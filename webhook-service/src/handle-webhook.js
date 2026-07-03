// Fireflies Webhooks V2 event name (the V1 name, 'Transcription completed', is legacy —
// see app.js for the V2 payload-field translation: `event`/`meeting_id` -> `eventType`/`meetingId`).
const MEETING_SUMMARIZED = 'meeting.summarized';

async function simplifyOrFallback(summarizer, summary) {
    if (!summarizer) {
        return summary;
    }
    try {
        const { overview, action_items } = await summarizer.simplify(summary);
        return { ...summary, overview, action_items };
    } catch (error) {
        return summary;
    }
}

async function handleFirefliesWebhook({ eventType, meetingId }, { firefliesClient, notifier, seenMeetings, meetingRouter, summarizer }) {
    if (eventType !== MEETING_SUMMARIZED) {
        return { status: 'ignored', meetingId };
    }

    if (seenMeetings.has(meetingId)) {
        return { status: 'duplicate', meetingId };
    }
    seenMeetings.markSeen(meetingId);

    try {
        let summary = await firefliesClient.fetchSummary(meetingId);

        if (!summary) {
            await notifier.notifyOpsFailure(meetingId, 'summary was not ready after retrying');
            return { status: 'failed', meetingId };
        }

        summary = await simplifyOrFallback(summarizer, summary);

        const chatId = meetingRouter.resolveChatId(summary.title);
        if (!chatId) {
            await notifier.notifyUnrouted(meetingId, summary.title, summary);
            return { status: 'unrouted', meetingId };
        }

        await notifier.notifySummaryTo(chatId, summary);
        return { status: 'processed', meetingId };
    } catch (error) {
        await notifier.notifyOpsFailure(meetingId, error.message).catch(() => {});
        return { status: 'failed', meetingId };
    }
}

module.exports = { handleFirefliesWebhook };
