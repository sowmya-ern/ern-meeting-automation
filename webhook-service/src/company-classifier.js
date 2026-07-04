// Content-based company classifier — the fallback path used ONLY when meeting-router.js's
// title match returns null (see routing-table.js). Never changes routing destination, only
// which tone/company label gets used downstream.
const { PROFILES } = require('./company-profiles');

function countHits(haystack, needles) {
  const lower = haystack.toLowerCase();
  return needles.reduce((count, needle) => (lower.includes(needle.toLowerCase()) ? count + 1 : count), 0);
}

function createCompanyClassifier() {
  function classify({ overview, action_items, attendees }) {
    const text = `${overview ?? ''} ${action_items ?? ''}`;
    const attendeeNames = (attendees ?? []).join(' ');

    const scores = Object.entries(PROFILES).map(([company, profile]) => ({
      company,
      score: countHits(text, profile.keywords) + countHits(attendeeNames, profile.attendees),
    }));
    scores.sort((a, b) => b.score - a.score);

    const [top, second] = scores;
    if (!top || top.score === 0) return null;
    if (second && second.score === top.score) return null; // tie -- don't guess
    return top.company;
  }

  return { classify };
}

module.exports = { createCompanyClassifier };
