# ADR-0004: Pre-meeting routine relays through webhook-service instead of holding real Telegram credentials

## Status
Accepted (2026-07-03)

## Context
Registering the pre-meeting Cloud Routine requires it to send Telegram messages. The obvious
approach — give the routine `TELEGRAM_BOT_TOKEN` and the real chat IDs, matching what
`webhook-service` already holds — hits a real problem: Anthropic's own Cloud Routines
documentation explicitly warns that the routine Environment's environment-variable settings
should not hold secrets or credentials. There is no encrypted secrets store for Cloud Routines
today (an open, unimplemented feature request). Separately, the `RemoteTrigger`/`/schedule`
routine-creation API has no dedicated secrets field at all — the only way to get a value into
a routine's config through that path is embedding it directly in the stored prompt/config as
plaintext. Neither path is actually safe for a real bot token that can message any chat the bot
is a member of.

## Decision
The pre-meeting routine never receives `TELEGRAM_BOT_TOKEN` or a real Telegram chat_id. Instead:
- `webhook-service` gains a new authenticated endpoint, `POST /relay/telegram-agenda`, guarded
  by a shared `RELAY_SECRET` (checked via `verify-relay-token.js`, the same
  timing-safe-comparison pattern as `verify-signature.js`).
- The endpoint accepts `{ chatKey, text }` — `chatKey` is a symbolic name (`BOND_TEAM`,
  `BOND_NEBULA`, `ERN_EXEC_STANDUP`, `ERN_SUPER_TEAM`, `OPS`; see `relay-chat-keys.js`), not a
  real chat_id. `webhook-service` resolves the real chat_id server-side and sends `text`
  verbatim via `notifier.sendPlainText` (no `parse_mode` — the routine already composes final
  plain text itself, same reasoning as the original pre-HTML notifier design).
- The routine's only credential is `RELAY_SECRET` plus the deployed `WEBHOOK_RELAY_URL`. It
  never sees the bot token and never sees a real chat_id, only symbolic keys that are
  meaningless outside this system.

## Consequences
- `RELAY_SECRET` still has to reach the routine through the same disclaimed mechanism (routine
  prompt/config or the Environment's env-var panel) — this doesn't solve "Cloud Routines have
  no real secrets store." What it changes is the blast radius: a leaked `RELAY_SECRET` only
  lets someone post a plain-text message to one of five known, fixed chats through our own
  relay. A leaked `TELEGRAM_BOT_TOKEN` would let someone impersonate the bot anywhere it's a
  member, read `getUpdates`, and act with the bot's full API surface. `RELAY_SECRET` is also
  trivially rotatable (change one env var on Render) without touching Telegram at all.
- One more moving part: the routine now depends on `webhook-service` being deployed and
  reachable, not just on Telegram's API directly. If `webhook-service` is down, pre-meeting
  agendas fail too, not just post-meeting summaries — an acceptable coupling given both already
  live in the same project and go live together.
- `relay-chat-keys.js`'s symbolic-key table must be kept in sync with `routing-table.js`'s
  literal table by hand (same forced-duplication shape as the routing table already has with
  the routine's prose, per ADR-0001/0002) — there's no code path from the routine prompt to
  either module.
- If Anthropic ships a real encrypted secrets store for Cloud Routines, this relay becomes
  unnecessary complexity and could be removed in favor of the routine calling Telegram directly
  — revisit this ADR if that happens.
