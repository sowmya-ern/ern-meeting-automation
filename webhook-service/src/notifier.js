const axios = require('axios');

function defaultHttpPost(url, body, config) {
    return axios.post(url, body, config);
}

function createNotifier({ botToken, opsChatId, httpPost = defaultHttpPost }) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    function send(chatId, text) {
        return httpPost(url, { chat_id: chatId, text });
    }

    async function notifySummaryTo(chatId, summary) {
        const text = `Post-Meeting Summary\n\nOverview:\n${summary.overview}\n\nAction Items:\n${summary.action_items}`;
        await send(chatId, text);
    }

    async function notifyOpsFailure(meetingId, reason) {
        await send(opsChatId, `Error processing meeting ${meetingId}: ${reason}`);
    }

    async function notifyUnrouted(meetingId, meetingTitle, summary) {
        const text = `No routing match for meeting "${meetingTitle}" (${meetingId}) — sending summary here instead.\n\nOverview:\n${summary.overview}\n\nAction Items:\n${summary.action_items}`;
        await send(opsChatId, text);
    }

    return { notifySummaryTo, notifyOpsFailure, notifyUnrouted };
}

module.exports = { createNotifier };
