// Symbolic chat keys the pre-meeting Cloud Routine references over the relay endpoint (see
// ADR-0004), instead of ever holding a real Telegram chat_id or the bot token itself.
function buildRelayChatMap(env) {
  return {
    BOND_NEBULA: env.TELEGRAM_CHAT_BOND_NEBULA,
    BOND_TEAM: env.TELEGRAM_CHAT_BOND_TEAM,
    ERN_EXEC_STANDUP: env.TELEGRAM_CHAT_ERN_EXEC_STANDUP,
    ERN_SUPER_TEAM: env.TELEGRAM_CHAT_ERN_SUPER_TEAM,
    OPS: env.TELEGRAM_OPS_CHAT_ID,
  };
}

function resolveRelayChatId(map, chatKey) {
  return map[chatKey] ?? null;
}

module.exports = { buildRelayChatMap, resolveRelayChatId };
