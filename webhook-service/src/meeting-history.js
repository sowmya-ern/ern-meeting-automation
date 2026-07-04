const axios = require('axios');

function defaultHttpGet(url, config) {
  return axios.get(url, config);
}

function defaultHttpPost(url, body, config) {
  return axios.post(url, body, config);
}

function createMeetingHistory({ url, serviceKey, httpGet = defaultHttpGet, httpPost = defaultHttpPost }) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  async function getSeriesState(seriesKey) {
    const response = await httpGet(
      `${url}/rest/v1/series_state?series_key=eq.${encodeURIComponent(seriesKey)}&select=open_items,narrative`,
      { headers }
    );
    const row = response?.data?.[0];
    if (!row) return null;
    return { open_items: row.open_items ?? [], narrative: row.narrative ?? '' };
  }

  async function appendHistory(row) {
    await httpPost(`${url}/rest/v1/meeting_history`, row, { headers });
  }

  async function upsertSeriesState(seriesKey, { open_items, narrative, lastMeetingId }) {
    await httpPost(
      `${url}/rest/v1/series_state`,
      { series_key: seriesKey, open_items, narrative, last_meeting_id: lastMeetingId },
      { headers: { ...headers, Prefer: 'resolution=merge-duplicates' } }
    );
  }

  return { getSeriesState, appendHistory, upsertSeriesState };
}

module.exports = { createMeetingHistory };
