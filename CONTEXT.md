# Context

Domain vocabulary for ERN Meeting Automation. Terms here are used exactly (in code, docs, and
architecture reviews) — no synonyms.

## Company-wide adoption (added 2026-07-02)

**The Shift**
Replacing the staff time spent building, maintaining, and babysitting the current Make.com +
point-tool stack (Fireflies, Apify, HubSpot, Buffer, Docparser, Phantombuster) with Claude
Code doing the orchestration. Source tools may still be called (directly or via MCP) — what's
being eliminated is human time spent stitching Make scenarios together, not the tools
themselves.

**Onboarding Deck**
The all-staff training deliverable (PPTX) that teaches the operating team + founders/leadership
to use Claude Code day-to-day. Distinct from a leadership buy-in pitch — the decision to adopt
is assumed already made; this deck is about how to actually use it. Owner: Som. Deadline: 1
month from 2026-07-02.

**Access Model**
Two supported ways staff touch Claude Code, chosen because Anthropic publishes no official
non-technical onboarding guide — see [ADR-0002](docs/adr/0002-desktop-app-plus-routines-access-model.md):
- **Claude Desktop app** — no terminal, chat UI, drag-drop files, one-click plugin install.
  The interface for hands-on/ad-hoc work (content drafting, one-off research).
- **Cloud Routines / Scheduled Tasks** — headless, server-side or locally-scheduled execution,
  no user presence required. The interface for recurring backlog items that today run through
  Make.com (daily standups, invoice parsing, competitor digest).
Staff are taught to prompt in plain English; CLI/terminal concepts are deliberately not taught.

**Nebula**
A person (contractor/team member) who owns Marketing content-creation tasks in the Ops
backlog — not an AI agent or bot. Needs onboarding to Claude Code like any other staffer.

## Modules (post architecture-review, 2026-07-01; routing added 2026-07-02; summarizer + 2026-07-03 architecture review)

**FirefliesClient**
The module that knows how to ask Fireflies for a transcript summary: the GraphQL query, the
auth header, and the retry/backoff policy for "summary not ready yet." Interface:
`fetchSummary(meetingId) -> { title, attendees, overview, action_items } | null` — the retry
count/delay are constructor-time config on `createFirefliesClient`, not a per-call argument.
The GraphQL query fetches `title` alongside the summary specifically so MeetingRouter has
something to match against, and `meeting_attendees` so Notifier can build the `@mention` line.

**MeetingRouter**
Owns "which chat does this meeting series go to." Interface: `resolveChatId(meetingTitle) ->
chatId | null`, backed by an ordered list of `{ match, chatId }` rules checked
most-specific-first (e.g. `'Bond <> Nebula'` before the looser `'Bond'`). Returns `null` when
no rule matches — the caller (handleFirefliesWebhook) treats that as "unrouted," not silent
drop.

**Notifier**
The module that owns "who gets told what" once a destination is known. Three operations:
`notifySummaryTo(chatId, summary)` (a routed team chat), `notifyOpsFailure(meetingId, reason)`
(the ops chat, real processing failures), and `notifyUnrouted(meetingId, meetingTitle,
summary)` (the ops chat, safety net for a summary that fetched fine but matched no
MeetingRouter rule — surfaced to a human instead of dropped). The message body (opening line,
`@mention` line, `<title> Summary` heading) is shared by all three via an internal
`formatSummaryBody` helper, matching the per-person agenda format used by the pre-meeting
routine — see "Reminder window" below and
[routines/pre-meeting-reminder.md](routines/pre-meeting-reminder.md).

**AttendeeHandles**
The lookup from a Fireflies attendee's display name to their Telegram `@handle`, used by
Notifier to build the `@mention` line. A small hardcoded table (`webhook-service/src/
attendee-handles.js`) — unlike the reminder window, this needs a real value at runtime, not
just prose, so it lives in code. Unmapped names fall back to the plain display name instead of
being dropped.

**Summarizer**
The optional module that condenses a raw Fireflies summary via a live Anthropic API call
before it reaches Notifier — see [ADR-0003](docs/adr/0003-live-summarization-in-webhook-service.md)
for why this exists at all. Interface: `simplify(summary) -> Promise<{ overview, action_items }>`.
Throws on any failure (API error, malformed response) rather than silently degrading — the
caller (`handleFirefliesWebhook`'s `simplifyOrFallback`) decides that a thrown error means
"send the raw summary instead," never "drop the meeting."

**RoutingTable**
The actual business data behind MeetingRouter's generic matcher: which chat each meeting series
maps to, and the most-specific-first ordering that keeps `'Bond <> Nebula'` from being swallowed
by the looser `'Bond'` rule. Interface: `buildRoutingRules(env) -> Rule[]`,
`assertOrderingIsSafe(rules)` (throws if an earlier rule's `match` is a substring of a later
rule's `match, i.e. would incorrectly win first). Extracted 2026-07-03 architecture review from
`index.js`, which previously held this data inline and untested — kept in sync manually with
the identical table in `routines/pre-meeting-reminder.md` (no code path from a Cloud Routine
prompt to this module, per ADR-0001/0002).

**Bold-marker convention**
The `**word**` syntax Summarizer instructs the model to emit for hard deadlines, and Notifier
converts to Telegram `<b>` tags. Lives in `webhook-service/src/bold-marker.js` as the one shared
seam between the two — extracted in the 2026-07-03 architecture review after finding both
modules independently "knew" this syntax with nothing keeping them in agreement.

**RelayChatKeys**
The symbolic-key lookup (`BOND_TEAM`, `BOND_NEBULA`, `ERN_EXEC_STANDUP`, `ERN_SUPER_TEAM`,
`OPS`) the pre-meeting Cloud Routine uses instead of a real chat_id — see
[ADR-0004](docs/adr/0004-pre-meeting-relay-instead-of-routine-secrets.md). Interface:
`buildRelayChatMap(env) -> Record<key, chatId>`, `resolveRelayChatId(map, chatKey) -> chatId |
null`. Kept in sync manually with the routine's prose table in
`routines/pre-meeting-reminder.md` (same ADR-0001/0002 constraint as RoutingTable).

**SeenMeetings**
The dedupe guard. Interface: `has(meetingId)`, `markSeen(meetingId)`. In-process (`Set`-backed)
today; the interface exists so a persistent adapter (e.g. Redis) can replace it later without
touching the handler.

**handleFirefliesWebhook**
The transport-agnostic core: `handleFirefliesWebhook({ eventType, meetingId }, { firefliesClient,
notifier, seenMeetings, meetingRouter, summarizer }) -> Result`. Takes injected adapters, returns
a result describing what happened (processed / ignored / duplicate / unrouted / failed). Only
processes `eventType === 'meeting.summarized'` (Fireflies **Webhooks V2**'s event name — see
below); anything else returns `{ status: 'ignored' }`.

**Fireflies Webhooks V1 vs V2 (2026-07-03)**
Fireflies has two webhook systems with genuinely different payload shapes — this project uses
**V2** (`app.fireflies.ai/integrations/api/webhook`), which sends `{ event, meeting_id,
timestamp }` (event names: `meeting.transcribed`, `meeting.summarized`, `meeting.bot_joined`).
V1 (`app.fireflies.ai/settings` Developer Settings) sends `{ eventType: 'Transcription
completed', meetingId }` instead — the shape this project's internal vocabulary is still named
after (`handleFirefliesWebhook`'s parameters), for historical reasons. `app.js` is the one place
that knows about the V2 wire format — it translates `event`/`meeting_id` into
`eventType`/`meetingId` before calling `handleFirefliesWebhook`, so the transport-agnostic core
never has to know which webhook version is configured. If Fireflies' account is ever
reconfigured to V1, only `app.js`'s translation needs to change. Subscribe to
**`meeting.summarized`** specifically, not `meeting.transcribed` — the latter fires before the
AI summary exists, which `fetchSummary`'s retry loop is built to tolerate but doesn't need to.

**Reminder window**
The pre-meeting reminder policy (3-6 hours before a meeting starts, hourly cadence, marked
`[reminder-sent]` on the calendar event to prevent duplicates). Lives entirely as prose in
`routines/pre-meeting-reminder.md` — see [ADR-0001](docs/adr/0001-reminder-policy-in-prompt.md)
for why this isn't code.

## Related

- [docs/2026-07-01-hybrid-implementation-plan.md](docs/2026-07-01-hybrid-implementation-plan.md) — architecture narrative and revision history.
- [docs/2026-07-01-SPEC.md](docs/2026-07-01-SPEC.md) — module interfaces and test plan.
- [docs/2026-07-02-meeting-automation-summary.md](docs/2026-07-02-meeting-automation-summary.md) — plain-English summary for non-technical readers (routing table, message examples, one-time setup checklist).
- [docs/adr/](docs/adr/) — recorded decisions.
