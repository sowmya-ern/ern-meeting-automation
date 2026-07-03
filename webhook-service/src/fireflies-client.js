const axios = require('axios');

const FIREFLIES_URL = 'https://api.fireflies.ai/graphql';

function buildQuery(meetingId) {
  return `query { transcript(id: "${meetingId}") { title meeting_attendees { displayName } summary { action_items overview } } }`;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultHttpPost(url, body, config) {
  return axios.post(url, body, config);
}

function createFirefliesClient({
  apiKey,
  retries = 10,
  delayMs = 30_000,
  sleep = defaultSleep,
  httpPost = defaultHttpPost,
}) {
  async function fetchSummary(meetingId) {
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const response = await httpPost(
        FIREFLIES_URL,
        { query: buildQuery(meetingId) },
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );

      const transcript = response?.data?.data?.transcript;
      const summary = transcript?.summary;

      if (summary?.overview) {
        const attendees = (transcript.meeting_attendees ?? []).map((a) => a.displayName);
        return { title: transcript.title, attendees, overview: summary.overview, action_items: summary.action_items };
      }

      if (attempt < retries) {
        await sleep(delayMs);
      }
    }

    return null;
  }

  return { fetchSummary };
}

module.exports = { createFirefliesClient };
