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

## Modules (post architecture-review, 2026-07-01; routing added 2026-07-02)

**FirefliesClient**
The module that knows how to ask Fireflies for a transcript summary: the GraphQL query, the
auth header, and the retry/backoff policy for "summary not ready yet." Interface:
`fetchSummary(meetingId, retryPolicy) -> { title, overview, action_items } | null`. The GraphQL
query fetches `title` alongside the summary specifically so MeetingRouter has something to
match against.

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
MeetingRouter rule — surfaced to a human instead of dropped).

**SeenMeetings**
The dedupe guard. Interface: `has(meetingId)`, `markSeen(meetingId)`. In-process (`Set`-backed)
today; the interface exists so a persistent adapter (e.g. Redis) can replace it later without
touching the handler.

**handleFirefliesWebhook**
The transport-agnostic core: `handleFirefliesWebhook(rawEvent, { firefliesClient, notifier,
seenMeetings, meetingRouter }) -> Result`. Takes injected adapters, returns a result describing
what happened (processed / ignored / duplicate / unrouted / failed). The Express route is a
thin adapter translating req/res to and from this function — it is not where policy lives.

**Reminder window**
The pre-meeting reminder policy (3-6 hours before a meeting starts, hourly cadence, marked
`[reminder-sent]` on the calendar event to prevent duplicates). Lives entirely as prose in
`routines/pre-meeting-reminder.md` — see [ADR-0001](docs/adr/0001-reminder-policy-in-prompt.md)
for why this isn't code.

## Related

- [docs/2026-07-01-hybrid-implementation-plan.md](docs/2026-07-01-hybrid-implementation-plan.md) — architecture narrative and revision history.
- [docs/2026-07-01-SPEC.md](docs/2026-07-01-SPEC.md) — module interfaces and test plan.
- [docs/adr/](docs/adr/) — recorded decisions.
