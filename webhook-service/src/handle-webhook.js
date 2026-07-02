const TRANSCRIPTION_COMPLETED = 'Transcription completed';

async function handleFirefliesWebhook({ eventType, meetingId }, { firefliesClient, notifier, seenMeetings }) {
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

        await notifier.notifySummary(summary);
        return { status: 'processed', meetingId };
    } catch (error) {
        await notifier.notifyOpsFailure(meetingId, error.message).catch(() => {});
        return { status: 'failed', meetingId };
    }
}

module.exports = { handleFirefliesWebhook };
