// The real business data behind meeting-router.js's generic matcher — kept in its own tested
// module because meeting-router.js's algorithm is correctly generic, but *this* data (which
// chat each series maps to, and the ordering that keeps "Bond <> Nebula" from being swallowed
// by the looser "Bond" rule) is what has to be correct in production.
//
// Kept in sync manually with the identical table in routines/pre-meeting-reminder.md — a
// Cloud Routine prompt has no code path to require() this file (ADR-0001/0002), so update
// both when this table changes.
function buildRoutingRules(env) {
  return [
    { match: 'Bond <> Nebula', chatId: env.TELEGRAM_CHAT_BOND_NEBULA },
    { match: 'Bond', chatId: env.TELEGRAM_CHAT_BOND_TEAM },
    { match: 'ERN Daily Executive Standup', chatId: env.TELEGRAM_CHAT_ERN_EXEC_STANDUP },
    { match: 'ERN Daily Sync', chatId: env.TELEGRAM_CHAT_ERN_SUPER_TEAM },
  ];
}

// meeting-router.js checks rules in array order and returns the first match. If an earlier
// rule's `match` is a substring of a later rule's `match`, any title meant for the later
// (more specific) rule would incorrectly be caught by the earlier (looser) one first.
function assertOrderingIsSafe(rules) {
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      if (rules[j].match.includes(rules[i].match)) {
        throw new Error(
          `routing rule "${rules[i].match}" is checked before "${rules[j].match}" and would ` +
          `incorrectly catch titles meant for it — move "${rules[i].match}" after "${rules[j].match}"`
        );
      }
    }
  }
}

module.exports = { buildRoutingRules, assertOrderingIsSafe };
