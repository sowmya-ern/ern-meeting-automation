const axios = require('axios');
const { handleFor } = require('./attendee-handles');
const { toHtmlBold } = require('./bold-marker');

function defaultHttpPost(url, body, config) {
    return axios.post(url, body, config);
}

function escapeHtml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Escapes third-party text first, then converts **bold** markers into <b> tags via the shared
// bold-marker.js contract — the only way bold reaches Telegram, since we never trust raw HTML
// from Fireflies or the summarizer.
function withBoldMarkers(text) {
    return toHtmlBold(escapeHtml(text));
}

function formatSummaryBody(summary) {
    const mentions = (summary.attendees ?? []).map(handleFor).map(escapeHtml).join(' ');
    const mentionsLine = mentions ? `${mentions}\n` : '';
    return `Hey guys please find here the meeting summary for today. Please lmk if anything's missing.\n${mentionsLine}${escapeHtml(summary.title)} Summary\n\nOverview:\n${withBoldMarkers(summary.overview)}\n\nAction Items:\n${withBoldMarkers(summary.action_items)}`;
}

function createNotifier({ botToken, opsChatId, httpPost = defaultHttpPost }) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    function send(chatId, text, parseMode = 'HTML') {
        const body = { chat_id: chatId, text };
        if (parseMode) body.parse_mode = parseMode;
        return httpPost(url, body);
    }

    async function notifySummaryTo(chatId, summary) {
        await send(chatId, formatSummaryBody(summary));
    }

    // Relay path for the pre-meeting Cloud Routine (see ADR-0004): the routine composes plain
    // text itself and never gets the bot token, so this sends it verbatim with no parse_mode —
    // same "no parse_mode" reasoning the whole notifier used before HTML rendering was added
    // for the summarizer's bold deadlines, just scoped to this one path.
    async function sendPlainText(chatId, text) {
        await send(chatId, text, null);
    }

    async function notifyOpsFailure(meetingId, reason) {
        await send(opsChatId, `Error processing meeting ${escapeHtml(meetingId)}: ${escapeHtml(reason)}`);
    }

    async function notifyUnrouted(meetingId, meetingTitle, summary) {
        const text = `No routing match for meeting "${escapeHtml(meetingTitle)}" (${escapeHtml(meetingId)}) — sending summary here instead.\n\n${formatSummaryBody(summary)}`;
        await send(opsChatId, text);
    }

    return { notifySummaryTo, notifyOpsFailure, notifyUnrouted, sendPlainText };
}

module.exports = { createNotifier };
