const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRoutingRules, assertOrderingIsSafe } = require('../src/routing-table');

test('buildRoutingRules reads each chat ID from the given env object, most-specific-first, each tagged with a seriesKey', () => {
  const env = {
    TELEGRAM_CHAT_BOND_NEBULA: 'nebula-chat',
    TELEGRAM_CHAT_BOND_TEAM: 'bond-chat',
    TELEGRAM_CHAT_ERN_EXEC_STANDUP: 'exec-chat',
    TELEGRAM_CHAT_ERN_SUPER_TEAM: 'super-chat',
  };
  const rules = buildRoutingRules(env);
  assert.deepEqual(rules, [
    { match: 'Bond <> Nebula', chatId: 'nebula-chat', seriesKey: 'BOND_NEBULA' },
    { match: 'Bond', chatId: 'bond-chat', seriesKey: 'BOND_TEAM' },
    { match: 'ERN Daily Executive Standup', chatId: 'exec-chat', seriesKey: 'ERN_EXEC_STANDUP' },
    { match: 'ERN Daily Sync', chatId: 'super-chat', seriesKey: 'ERN_SUPER_TEAM' },
  ]);
});

test('assertOrderingIsSafe does not throw for the real production rule table', () => {
  const rules = buildRoutingRules({
    TELEGRAM_CHAT_BOND_NEBULA: 'a', TELEGRAM_CHAT_BOND_TEAM: 'b',
    TELEGRAM_CHAT_ERN_EXEC_STANDUP: 'c', TELEGRAM_CHAT_ERN_SUPER_TEAM: 'd',
  });
  assert.doesNotThrow(() => assertOrderingIsSafe(rules));
});

test('assertOrderingIsSafe throws when a looser rule is checked before the more specific rule it would swallow', () => {
  const broken = [
    { match: 'Bond', chatId: 'bond-chat', seriesKey: 'BOND_TEAM' },
    { match: 'Bond <> Nebula', chatId: 'nebula-chat', seriesKey: 'BOND_NEBULA' },
  ];
  assert.throws(() => assertOrderingIsSafe(broken), /"Bond".*"Bond <> Nebula"/);
});
