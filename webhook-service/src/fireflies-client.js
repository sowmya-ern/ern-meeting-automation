const axios = require('axios');

const FIREFLIES_URL = 'https://api.fireflies.ai/graphql';

function buildQuery(meetingId) {
  return `query { transcript(id: "${meetingId}") { summary { action_items overview } } }`;
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

      const summary = response?.data?.data?.transcript?.summary;

      if (summary?.overview) {
        return summary;
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
