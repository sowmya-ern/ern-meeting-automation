# ADR-0005: Persistent meeting history + automatic cross-meeting consolidation

## Status
Proposed (2026-07-04)

## Context
Every meeting is summarized in isolation today: `summarizer.js` calls the Anthropic API with
only that meeting's raw Fireflies overview/action_items, and `seen-meetings.js` — the only
state this project has ever kept — is an in-memory `Set` used purely for webhook-delivery
idempotency, not content. It doesn't even survive a restart on Render's free tier. As a result,
recurring action items look brand new every week, previously-resolved items aren't recognized
as resolved, and there is no way for a summary to say "this was flagged two weeks ago" — the
exact gap the user raised: the Telegram bot has no access to prior context, so it can't build
on it.

This is the second deliberate reversal of the "plain, stateless, deterministic pipeline"
principle recorded in ADR-0003 (the first was the live summarizer call). This one goes further:
it introduces the project's first real persistent datastore and a second automatic model call
per meeting.

## Decision
- **Store full history, indefinitely**, in a new Supabase Postgres project (`meeting_history`
  table — append-only, one row per processed meeting: series, meeting id, date, attendees, raw
  and condensed overview/action_items). This is the durable substrate; nothing is deleted.
- **Derive a consolidated view per meeting series** (`series_state` table — one row per series,
  upserted every run: `open_items` as a jsonb array, a rolling `narrative` string, timestamps).
  This is what actually feeds the next meeting's summary.
- **History only applies to recognized recurring series** — reusing `meeting-router.js`'s
  existing title classification (Bond Team, Bond <> Nebula, ERN Exec Standup, ERN Super Team).
  One-off/unrouted meetings get no history tracking; there's no "previous occurrence" for a
  meeting that only happens once.
- **A second, separate Anthropic call** (`history-consolidator.js`) does the consolidation:
  given the prior `open_items`/`narrative` plus this meeting's raw content, it returns updated
  state. Kept separate from `summarizer.js`'s Telegram-facing call rather than merged into one
  prompt, because mixing free text (for Telegram) and structured JSON (for storage) in a single
  model response is fragile to parse reliably — the two have different failure/retry needs.
- **Auto-resolve with an audit trail**: the consolidator decides which open items got addressed
  and marks them closed, but nothing is ever deleted — a closed item keeps its original text,
  first-seen date, and the meeting/reasoning that closed it. A wrong auto-close is a data
  correction (flip one field), not a silent loss.
- **Failure is always non-blocking**: a Supabase read/write failure or consolidator-call failure
  never affects the Telegram send, which already happened by the time consolidation runs — same
  "never drop a summary" principle as the existing summarizer fallback.
- New secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, added to `render.yaml` (`sync: false`,
  same handling as the six secrets already there) and `.env.example`.

## Consequences
- This is real infrastructure this project didn't have before: a signup, two tables, and
  ongoing storage of real team strategy discussions across time — a materially larger privacy
  surface than a single Telegram message that scrolls out of view. The service key is a secret
  like any other here, but unlike a Telegram bot token, a leaked Supabase service key exposes
  the *entire accumulated history*, not just the ability to post one more message. Treat it with
  at least the same care as `TELEGRAM_BOT_TOKEN`.
- Cost/latency: one additional Anthropic call and two additional HTTP round-trips (read + write)
  per processed meeting in a recognized series. Judged acceptable against the same reasoning as
  ADR-0003 — this path was never actually "instant" end-to-end.
- `series_key` classification is reused directly from `routing-table.js`/`meeting-router.js` —
  no new business-rule duplication, but it does mean history is coupled to routing: renaming or
  restructuring a series' routing rule silently starts a "new" series in history unless the
  historical rows are migrated too.
- If Supabase or the consolidation step turns out not to earn its cost/complexity, the fix is to
  stop calling `history-consolidator`/`meeting-history` from `handle-webhook.js` — the rest of
  the pipeline (fetch → summarize → route → notify) is unaffected and keeps working exactly as
  it does today, since this is additive, not a replacement of any existing path.
