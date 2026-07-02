const TRANSCRIPTION_COMPLETED = 'Transcription completed';

async function handleFirefliesWebhook({ eventType, meetingId }, { firefliesClient, notifier, seenMeetings, meetingRouter }) {
    if (eventType !== TRANSCRIPTION_COMPLETED) {
        return { status: 'ignored', meetingId };
    }

    if (seenMeetings.has(meetingId)) {
        return { status: 'duplicate', meetingId };
    }
    seenMeetings.markSeen(meetingId);

    try {
        const summary = await firefliesClient.fetchSummary(meetingId);

        if (!summary) {
            await notifier.notifyOpsFailure(meetingId, 'summary was not ready after retrying');
            return { status: 'failed', meetingId };
        }

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
