# Meeting history + cross-meeting consolidation — design spec

Companion to [ADR-0005](adr/0005-meeting-history-and-consolidation.md), which records the
decision and tradeoffs. This doc is the implementation-level design: schema, module contracts,
data flow, prompts, and testing plan.

## Problem

`summarizer.js` condenses each meeting in total isolation. Nothing persists across meetings, so
a recurring action item ("RE7 / Midas API") looks brand new every week, a resolved item never
gets acknowledged as resolved, and the summary can't say "as discussed two weeks ago." Fixing
this requires (a) somewhere to store history, and (b) something that reads/writes it
automatically, in-band with the existing webhook flow, with zero human involvement.

## Storage: Supabase (Postgres)

Two tables, accessed via plain `axios` calls to Supabase's REST API (`SUPABASE_URL` +
`SUPABASE_SERVICE_KEY`, service-role key — no RLS needed, since only `webhook-service` ever
talks to these tables directly).

### `meeting_history` (append-only)

| column               | type      | notes                                      |
|----------------------|-----------|---------------------------------------------|
| id                   | uuid, PK  | default `gen_random_uuid()`                 |
| series_key           | text      | e.g. `BOND_TEAM` — from `routing-table.js`  |
| meeting_id           | text      | Fireflies transcript id, unique             |
| meeting_date         | timestamptz | from Fireflies webhook processing time    |
| title                | text      |                                              |
| attendees            | text[]    |                                              |
| raw_overview         | text      | Fireflies' original, pre-condensation       |
| raw_action_items     | text      |                                              |
| condensed_overview   | text      | what was actually sent to Telegram          |
| condensed_action_items | text    |                                              |
| created_at           | timestamptz | default `now()`                           |

Unique constraint on `meeting_id` — this table is a log, never updated, never deleted.

### `series_state` (upserted)

| column        | type        | notes                                              |
|---------------|-------------|------------------------------------------------------|
| series_key    | text, PK    |                                                        |
| open_items    | jsonb       | array of `{ text, assignee, status, first_seen, closed_reason? }` |
| narrative     | text        | rolling, series-level, a few sentences                |
| last_meeting_id | text      |                                                        |
| updated_at    | timestamptz | default `now()`, bumped on every upsert               |

`open_items[].status` is `"open"` or `"closed"` — closed items stay in the array (audit trail),
never removed. A human can flip `status` back to `"open"` directly in Supabase if the model
closed something incorrectly — no code path needed for that, it's a data edit.

## New modules

### `webhook-service/src/meeting-history.js`

```js
createMeetingHistory({ url, serviceKey, httpPost }) => {
  getSeriesState(seriesKey): Promise<{ open_items, narrative } | null>   // null if no row yet
  appendHistory(row): Promise<void>
  upsertSeriesState(seriesKey, { open_items, narrative, lastMeetingId }): Promise<void>
}
```

Same injectable-`httpPost` convention as `fireflies-client.js`/`notifier.js`/`summarizer.js` —
fakeable in tests, no live network calls needed to test callers.

### `webhook-service/src/history-consolidator.js`

```js
createHistoryConsolidator({ apiKey, httpPost }) => {
  consolidate({ seriesState, meeting }): Promise<{ open_items, narrative }>
}
```

One Anthropic call. Prompt rules (same "never guess" spirit as `summarizer.js`'s RULES):
- Input: prior `open_items` + `narrative` (or empty if this is the series' first tracked
  meeting), plus this meeting's raw overview/action_items and title/date.
- Output format: `OPEN_ITEMS:` (JSON array matching the schema above) then `NARRATIVE:` (plain
  text, ≤3 sentences, same no-semicolon-chaining rule as the main summarizer's overview).
- Rules given to the model: close an item only when this meeting's content clearly indicates it
  was addressed — don't guess; when in doubt, leave it open. Never invent a new open item that
  isn't grounded in this meeting's actual content. Merge a new item into an existing open item
  instead of duplicating it if they're clearly the same task resurfacing.
- Parsing follows the same "find the `text` content block by type, not by index" fix already
  applied to `summarizer.js` (the thinking-block bug found during the live e2e test) — the JSON
  section is parsed with `JSON.parse`, wrapped in try/catch, falling back to "no change" (prior
  state kept as-is) on any malformed response, consistent with never letting a parsing failure
  cascade into a corrupted or lost state.

## Flow change in `handle-webhook.js`

Current flow: fetch → simplify-or-fallback → route → notify.

New flow:
1. Fetch raw Fireflies summary (unchanged).
2. Classify `series_key` via the existing routing rules (reuse `routing-table.js`'s match list —
   add a `seriesKey` field alongside each rule's existing `match`/`chatId`, since the two are
   fundamentally the same classification and shouldn't be computed twice with two separate rule
   tables).
3. If a real series matched: `meetingHistory.getSeriesState(seriesKey)` (failure/empty → treat
   as `{ open_items: [], narrative: '' }`, never block).
4. `summarizer.simplify()` — prompt gains an optional extra input block ("Prior open items /
   narrative for this series") so the Telegram-facing text can naturally reference recurrence;
   return shape (`{ overview, action_items }`) is unchanged.
5. `notifier.notifySummaryTo` (unchanged) — the Telegram send completes here. Everything after
   this point is best-effort and must never affect what already happened above.
6. If a real series matched: `historyConsolidator.consolidate(...)`, then
   `meetingHistory.appendHistory(...)` and `upsertSeriesState(...)`. Wrapped in try/catch;
   failure is logged only (no `notifyOpsFailure` — this mirrors the summarizer's existing
   "a degraded feature is not an ops failure" precedent from ADR-0003).

Unrouted/one-off meetings skip steps 3 and 6 entirely — behavior for them is identical to today.

## Env vars

Add to `render.yaml` (`sync: false`) and `.env.example`:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

Both optional in the same sense `ANTHROPIC_API_KEY` is optional: if either is unset, history
tracking is skipped entirely (steps 3 and 6 no-op) and the pipeline behaves exactly as it does
today — this feature is additive, never a hard dependency.

## Testing plan

- `meeting-history.test.js` — unit tests against a fake `httpPost`, covering: empty/first-time
  series state, a populated state round-trip, and a simulated Supabase failure not throwing out
  of `getSeriesState` (callers must be able to treat failure the same as "no state yet").
- `history-consolidator.test.js` — unit tests: normal consolidation, malformed-JSON response
  falls back to unchanged prior state, thinking-block-before-text-block response (regression
  guard, same shape as the bug already fixed in `summarizer.js`).
- `handle-webhook.test.js` (extend existing) — a recognized-series meeting triggers history
  read/write around the existing summarize/notify calls; an unrouted meeting does not.
- Integration test analogous to `summarizer-notifier-integration.test.js`: a real
  `history-consolidator` output round-tripped through `meeting-history`'s upsert shape, so the
  two modules' shared `open_items` schema can't silently drift apart.

## Setup steps (manual, one-time)

1. Create a new Supabase project (free tier).
2. Run the two `CREATE TABLE` statements above (SQL provided in the implementation PR).
3. Copy the project URL and service-role key into Render's environment (`SUPABASE_URL`,
   `SUPABASE_SERVICE_KEY`) — same "you set it in the dashboard, not pasted into a session"
   handling already established for `ANTHROPIC_API_KEY`.
