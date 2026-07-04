// Company classification data for the Fireflies-Telegram notetaker (2026-07-04 "Agent
// Briefing" doc, Section 2). Consumed by company-classifier.js (content-based fallback, only
// when routing-table.js's title match fails) and summarizer.js (per-company tone hint).
const PROFILES = {
  BOND: {
    label: 'Bond',
    tone: 'semi-formal, highly execution-focused',
    keywords: ['Zero G', 'GSR', 'Turtle Club', 'Wormhole', 'Cicada', 'Midas', 'Flow Trader', 'RE7 API', 'TVL', 'Perp DEX', 'LSTs'],
    attendees: ['Taweh Bey Solowii', 'Vinson Leow', 'Hoa Ha', 'Sowmya Raghavan', 'Caitlin Sarah', 'Red'],
  },
  ERN: {
    label: 'ERN',
    tone: 'casual-executive, decision-focused',
    keywords: ['Live to Earn', 'Apkudo', 'Vodafone', 'Delos', 'CosmicWire', 'Selini Summit', 'FDV', 'eSIM', 'Klaviyo'],
    attendees: ['Dr. Jonathan', 'Vinson Leow', 'Keli Whitlock', 'Sowmya Raghavan', 'Hoa Ha', 'Jerad Finck', 'Rob Christensen'],
  },
};

function getProfile(company) {
  return PROFILES[company] ?? null;
}

module.exports = { PROFILES, getProfile };
