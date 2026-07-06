const axios = require('axios');

const FIREFLIES_URL = 'https://api.fireflies.ai/graphql';

function buildQuery(meetingId) {
  // Feature 7: fetch sentences for speaker attribution (top key-point per speaker)
  return `query { transcript(id: "${meetingId}") { title transcript_url meeting_attendees { displayName } summary { action_items overview } sentences { speaker_name text } } }`;
}

// Feature 7: Extract the single most substantive sentence per speaker as an attribution quote.
// Uses sentence length as a heuristic for substance — longer = more likely to be a decision/insight.
function extractSpeakerAttributions(sentences) {
  if (!sentences || sentences.length === 0) return [];
  const bySpeaker = new Map();
  for (const { speaker_name, text } of sentences) {
    if (!speaker_name || !text || text.trim().length < 20) continue;
    const existing = bySpeaker.get(speaker_name);
    if (!existing || text.length > existing.length) {
      bySpeaker.set(speaker_name, text.trim());
    }
  }
  return Array.from(bySpeaker.entries()).map(([speaker, quote]) => ({ speaker, quote }));
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
        // Feature 7: extract speaker attributions from sentence-level data
        const speakerAttributions = extractSpeakerAttributions(transcript.sentences ?? []);
        return {
          title: transcript.title,
          attendees,
          overview: summary.overview,
          action_items: summary.action_items,
          recordingUrl: transcript.transcript_url ?? null,
          speakerAttributions,
        };
      }

      if (attempt < retries) {
        await sleep(delayMs);
      }
    }

    return null;
  }

  return { fetchSummary };
}

module.exports = { createFirefliesClient, extractSpeakerAttributions };
