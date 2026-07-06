const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRoutingRules, assertOrderingIsSafe } = require('../src/routing-table');

test('buildRoutingRules reads each chat ID from the given env object, most-specific-first, each tagged with a seriesKey and a company', () => {
  const env = {
    TELEGRAM_CHAT_BOND_NEBULA: 'nebula-chat',
    TELEGRAM_CHAT_BOND_TEAM: 'bond-chat',
    TELEGRAM_CHAT_ERN_EXEC_STANDUP: 'exec-chat',
    TELEGRAM_CHAT_ERN_NEBULA: 'ern-nebula-chat',
    TELEGRAM_CHAT_ERN_SUPER_TEAM: 'super-chat',
  };
  const rules = buildRoutingRules(env);
  assert.deepEqual(rules, [
    { match: 'Bond <> Nebula', chatId: 'nebula-chat', seriesKey: 'BOND_NEBULA', company: 'BOND', isExternalFacing: true },
    { match: 'Bond <> 0g Weekly Sync', chatId: 'bond-chat', seriesKey: 'BOND_TEAM', company: 'BOND', isExternalFacing: true },
    { match: 'BOND Daily Standup', chatId: 'bond-chat', seriesKey: 'BOND_TEAM', company: 'BOND', isExternalFacing: false },
    { match: 'Bond', chatId: 'bond-chat', seriesKey: 'BOND_TEAM', company: 'BOND', isExternalFacing: false },
    { match: 'ERN Daily Executive Standup', chatId: 'exec-chat', seriesKey: 'ERN_EXEC_STANDUP', company: 'ERN', isExternalFacing: false },
    { match: 'ERN <> Nebula', chatId: 'ern-nebula-chat', seriesKey: 'ERN_NEBULA', company: 'ERN', isExternalFacing: true },
    { match: 'ERN Daily Sync', chatId: 'super-chat', seriesKey: 'ERN_SUPER_TEAM', company: 'ERN', isExternalFacing: false },
    { match: 'ERN Catchup', chatId: 'super-chat', seriesKey: 'ERN_SUPER_TEAM', company: 'ERN', isExternalFacing: false },
    { match: 'Sowmya / Vinson', chatId: 'super-chat', seriesKey: 'ERN_SUPER_TEAM', company: 'ERN', isExternalFacing: false },
    { match: 'Vinson / Sowmya', chatId: 'super-chat', seriesKey: 'ERN_SUPER_TEAM', company: 'ERN', isExternalFacing: false },
    { match: 'ERN', chatId: 'super-chat', seriesKey: 'ERN_SUPER_TEAM', company: 'ERN', isExternalFacing: false },
  ]);
});

test('assertOrderingIsSafe does not throw for the real production rule table', () => {
  const rules = buildRoutingRules({
    TELEGRAM_CHAT_BOND_NEBULA: 'a', TELEGRAM_CHAT_BOND_TEAM: 'b',
    TELEGRAM_CHAT_ERN_EXEC_STANDUP: 'c', TELEGRAM_CHAT_ERN_NEBULA: 'd', TELEGRAM_CHAT_ERN_SUPER_TEAM: 'e',
  });
  assert.doesNotThrow(() => assertOrderingIsSafe(rules));
});

test('assertOrderingIsSafe throws when a looser rule is checked before the more specific rule it would swallow', () => {
  const broken = [
    { match: 'Bond', chatId: 'bond-chat', seriesKey: 'BOND_TEAM', company: 'BOND' },
    { match: 'Bond <> Nebula', chatId: 'nebula-chat', seriesKey: 'BOND_NEBULA', company: 'BOND' },
  ];
  assert.throws(() => assertOrderingIsSafe(broken), /"Bond".*"Bond <> Nebula"/);
});

test('new Bond/ERN sub-series patterns route to the expected chat via meeting-router', () => {
  const { createMeetingRouter } = require('../src/meeting-router');
  const rules = buildRoutingRules({
    TELEGRAM_CHAT_BOND_NEBULA: 'nebula-chat', TELEGRAM_CHAT_BOND_TEAM: 'bond-chat',
    TELEGRAM_CHAT_ERN_EXEC_STANDUP: 'exec-chat', TELEGRAM_CHAT_ERN_NEBULA: 'ern-nebula-chat',
    TELEGRAM_CHAT_ERN_SUPER_TEAM: 'super-chat',
  });
  const router = createMeetingRouter(rules);
  assert.equal(router.resolveChatId('BOND Daily Standup - 2026-07-04'), 'bond-chat');
  assert.equal(router.resolveChatId('Bond <> 0g Weekly Sync'), 'bond-chat');
  assert.equal(router.resolveChatId('ERN <> Nebula catch-up'), 'ern-nebula-chat');
  assert.equal(router.resolveChatId('Meet – ERN Catchup'), 'super-chat');
  assert.equal(router.resolveChatId('Meet – ERN Daily Sync'), 'super-chat');
});
