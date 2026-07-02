# Context

Domain vocabulary for ERN Meeting Automation. Terms here are used exactly (in code, docs, and
architecture reviews) — no synonyms.

## Modules (post architecture-review, 2026-07-01)

**FirefliesClient**
The module that knows how to ask Fireflies for a transcript summary: the GraphQL query, the
auth header, and the retry/backoff policy for "summary not ready yet." Interface:
`fetchSummary(meetingId, retryPolicy) -> Summary | null`.

**Notifier**
The module that owns "who gets told what." Two operations: `notifySummary(summary)` (the
user-facing team chat) and `notifyOpsFailure(meetingId, reason)` (the ops chat). Callers name
an event; the Notifier decides chat + message shape.

**SeenMeetings**
The dedupe guard. Interface: `has(meetingId)`, `markSeen(meetingId)`. In-process (`Set`-backed)
today; the interface exists so a persistent adapter (e.g. Redis) can replace it later without
touching the handler.

**handleFirefliesWebhook**
The transport-agnostic core: `handleFirefliesWebhook(rawEvent, { firefliesClient, notifier,
seenMeetings }) -> Result`. Takes injected adapters, returns a result describing what happened
(processed / ignored / duplicate / failed). The Express route is a thin adapter translating
req/res to and from this function — it is not where policy lives.

**Reminder window**
The pre-meeting reminder policy (3-6 hours before a meeting starts, hourly cadence, marked
`[reminder-sent]` on the calendar event to prevent duplicates). Lives entirely as prose in
`routines/pre-meeting-reminder.md` — see [ADR-0001](docs/adr/0001-reminder-policy-in-prompt.md)
for why this isn't code.

## Related

- [docs/2026-07-01-hybrid-implementation-plan.md](docs/2026-07-01-hybrid-implementation-plan.md) — architecture narrative and revision history.
- [docs/2026-07-01-SPEC.md](docs/2026-07-01-SPEC.md) — module interfaces and test plan.
- [docs/adr/](docs/adr/) — recorded decisions.
