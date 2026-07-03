const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRelayChatMap, resolveRelayChatId } = require('../src/relay-chat-keys');

const env = {
  TELEGRAM_CHAT_BOND_NEBULA: 'nebula-chat',
  TELEGRAM_CHAT_BOND_TEAM: 'bond-chat',
  TELEGRAM_CHAT_ERN_EXEC_STANDUP: 'exec-chat',
  TELEGRAM_CHAT_ERN_SUPER_TEAM: 'super-chat',
  TELEGRAM_OPS_CHAT_ID: 'ops-chat',
};

test('resolveRelayChatId resolves a known symbolic key to its chat ID', () => {
  const map = buildRelayChatMap(env);
  assert.equal(resolveRelayChatId(map, 'BOND_TEAM'), 'bond-chat');
  assert.equal(resolveRelayChatId(map, 'OPS'), 'ops-chat');
});

test('resolveRelayChatId returns null for an unknown key rather than throwing', () => {
  const map = buildRelayChatMap(env);
  assert.equal(resolveRelayChatId(map, 'NOT_A_REAL_KEY'), null);
});
