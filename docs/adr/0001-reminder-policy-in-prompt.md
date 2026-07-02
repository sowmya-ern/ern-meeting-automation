# ADR-0001: Reminder window/idempotency policy lives in the routine prompt, not in code

## Status
Accepted (2026-07-01)

## Context
The pre-meeting reminder's window (3-6 hours before a meeting) and its idempotency convention
(`[reminder-sent]` marker on the calendar event) are the kind of rule you'd normally extract
into a small, unit-testable module. The architecture review (candidate 5) flagged this as
speculative: there is no module a test could call to check "does a meeting starting in exactly
6.0h get caught."

## Decision
Leave this policy as prose in `routines/pre-meeting-reminder.md`. Claude Code Cloud Routines
execute prompts, not imported modules — there is no code path for the routine to call out to a
shared function, so extracting the window math into a module would create a seam nothing can
use. The prompt is the interface here.

## Consequences
- No unit test can exercise the window boundary directly; correctness relies on the routine's
  own reasoning each hourly run.
- If window-edge bugs show up in practice (e.g. a meeting at exactly 3.0h or 6.0h is missed or
  double-fired), revisit this ADR — that would be evidence the seam is real, not hypothetical.
- Do not re-propose extracting this into a module without new evidence of an actual bug; this
  ADR exists so future architecture reviews don't re-suggest the same thing from first
  principles.
