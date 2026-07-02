const axios = require('axios');

function defaultHttpPost(url, body, config) {
  return axios.post(url, body, config);
}

function createNotifier({ botToken, chatId, opsChatId, httpPost = defaultHttpPost }) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  async function notifySummary(summary) {
    const text = `Post-Meeting Summary\n\nOverview:\n${summary.overview}\n\nAction Items:\n${summary.action_items}`;
    await httpPost(url, { chat_id: chatId, text });
  }

  async function notifyOpsFailure(meetingId, reason) {
    const text = `Error processing meeting ${meetingId}: ${reason}`;
    await httpPost(url, { chat_id: opsChatId, text });
  }

  return { notifySummary, notifyOpsFailure };
}

module.exports = { createNotifier };
