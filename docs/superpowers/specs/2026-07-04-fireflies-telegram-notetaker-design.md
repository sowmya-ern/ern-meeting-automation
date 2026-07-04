# Fireflies → Telegram Meeting Notetaker: merged design

Companion to the "Agent Briefing: Fireflies to Telegram Meeting Summaries" doc supplied
2026-07-04, reconciled against the already-deployed pre-meeting/post-meeting pipeline
(`webhook-service/`, `routines/pre-meeting-reminder.md`). This is separate from
[2026-07-04-meeting-history-design.md](../../2026-07-04-meeting-history-design.md) (ADR-0005),
which covers Supabase-backed cross-meeting continuity — not touched by this design.

## Scope: merge

Keep proven infrastructure: the Fireflies webhook (push, not poll — the briefing's 30-min
check is already exceeded by real-time push, so no polling is added), `routing-table.js`'s
title-based routing, `seen-meetings.js`'s permanent per-meeting-id dedupe (already stronger
than "don't recreate within 30 min"), and the relay-based pre-meeting Cloud Routine.

Adopt the briefing's message formats, company classification, and blocker/handoff detection
on top of that base. Dropped from scope: 30-min polling (webhook already covers it),
Monday.com task links (no integration exists anywhere in this project).

## Company classification

Title match first (`meeting-router.js`/`routing-table.js`, unchanged mechanism) — the reliable,
already-tested path. A new `company-classifier.js` runs **only** when title matching returns no
rule: it scans the transcript overview/action-items/attendees against `company-profiles.js`'s
keyword/attendee lists (from Section 2 of the briefing) and returns `'BOND' | 'ERN' | null`.
This does not change the destination chat (no chat exists for a title we don't recognize —
still goes to the ops/unrouted chat) — it changes which message template/tone is used, and the
unrouted notice names the guessed company instead of being generic.

`routing-table.js` gains the missing title patterns: `'BOND Daily Standup'`,
`'Bond <> 0g Weekly Sync'` (Bond); `'ERN <> Nebula'` (ERN) — ordering re-verified via the
existing `assertOrderingIsSafe` invariant (e.g. `'Bond <> 0g Weekly Sync'` before the bare
`'Bond'` rule).

## Message formats

Adopt the briefing's three templates (Pre-Meeting Reminder, Meeting Agenda/Overview,
Post-Meeting To-Dos) as specified, rendered through the existing HTML `parse_mode` +
`escapeHtml()` path rather than literal Telegram legacy Markdown — `*bold*`→`<b>`, `_italic_`→
`<i>`, `•`/`---`/emoji stay literal (no escaping needed). Same visual result, keeps the
already-tested XSS-safe escaping.

**Pre-Meeting Reminder** — the briefing's template is topic-level ("On the Agenda" / "Please
review before joining"), a real change from today's per-attendee bullet listing. Since the
Cloud Routine already has an LLM read the calendar event description and draft the message
(not a mechanical copy), this is a **prompt change only** in `routines/pre-meeting-reminder.md`
— group by topic instead of by attendee, no new code. Trigger window shifts from 3-6h to 11-13h
before the meeting (still hourly cadence, still the `[reminder-sent]` calendar-description
marker for idempotency) to approximate "sent at least 12 hours before." Tagging stays
all-attendees (confirmed), using the corrected/expanded handle table below.

**Meeting Agenda/Overview** (post-meeting, message 2 of 2) — overview paragraph plus
department/topic sections, blockers flagged `⚠️`.

**Post-Meeting To-Dos** (post-meeting, message 3 → sent as the *second* Telegram message) —
action items grouped by `@handle`, blockers flagged `⚠️`, a recording link (new `transcript_url`
field added to the Fireflies GraphQL query in `fireflies-client.js`), and a "Next Steps"
section. No Monday.com link (dropped from scope).

`handle-webhook.js`'s post-meeting flow sends these two messages as independent `notifier`
calls — a failure sending one must not block the other from being attempted.

**Blocker/handoff detection** — `summarizer.js`'s `RULES` gain: flag "waiting on"/"blocked
by"/"pending" phrasing with `⚠️`; when a task's ownership visibly shifts between people in the
transcript, assign it to the new owner instead of the original. `RULES`/`buildPrompt` also
accept a per-company tone hint (Bond: semi-formal, execution-focused; ERN: casual-executive,
decision-focused) sourced from `company-profiles.js`.

## Data fixes

- `attendee-handles.js`: correct Sowmya `@sowmyaraghavan` → `@sraghavan`; add `@redbeem` (Red)
  for Bond; add ERN's `@jonscott`, `@keliwhitlock`, `@JeradFinck`. Rob Christensen gets no
  entry — falls back to plain-name display, the table's existing behavior for unmapped names.
- Mirror the same corrections in `routines/pre-meeting-reminder.md`'s prose handle table (kept
  in sync by hand, per ADR-0001/0002 — no code path from a Cloud Routine prompt to
  `require()` the real file).

## Out of scope (explicitly deferred, not part of this design)

- 30-min Fireflies polling — superseded by the already-live webhook.
- Monday.com task links — no integration exists; revisit only if/when one is built.
- Meeting-history/Supabase consolidation (ADR-0005) — a separate, already-planned initiative
  with its own task-by-task implementation plan; not touched here.

## Testing

Extend existing suites: `attendee-handles.test.js`, `routing-table.test.js` (new patterns +
ordering safety), `meeting-router.test.js`, `summarizer.test.js` (blocker/handoff/tone),
`notifier.test.js` (new formatting functions for the Agenda/Overview and To-Dos messages),
`fireflies-client.test.js` (`transcript_url`), `handle-webhook.test.js` (two independent
post-meeting sends, one send's failure doesn't block the other). New: `company-profiles.test.js`,
`company-classifier.test.js`. All existing tests must keep passing (additive-only discipline,
same convention as the meeting-history plan).

## Rollout

Same deploy path as today: push to `main`, Render auto-deploys `webhook-service/`. The
pre-meeting routine's prompt change takes effect on its next scheduled run, no redeploy needed.
