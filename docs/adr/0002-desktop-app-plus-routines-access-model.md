# ADR-0002: Staff use Claude Desktop app for hands-on work; Cloud Routines/Scheduled Tasks for recurring automation

## Status
Accepted (2026-07-02)

## Context
The company-wide onboarding deck needs to tell non-technical staff (CMO-level, zero git/CLI
experience) exactly where and how they touch Claude Code day-to-day. Anthropic publishes no
official guide for onboarding non-engineers — the VS Code extension and the CLI both assume
terminal comfort, which this team doesn't have. The Ops/Marketing/Partnerships backlog also
splits cleanly into two shapes of work: ad-hoc/creative tasks a person drives (content
drafting, one-off research) and recurring tasks currently wired through Make.com scenarios
with no human judgment in the loop (daily standups, invoice parsing, competitor digest).

## Decision
Two supported access points, matched to those two shapes of work:
- **Claude Desktop app** for anything hands-on — no terminal, chat UI, drag-drop files,
  one-click plugin install. This is what staff open when they need to think alongside Claude.
- **Cloud Routines / Scheduled Tasks** for recurring automation — headless, server-side or
  locally-scheduled, no user presence required. This replaces the Make.com layer for backlog
  rows that just need to fire on a schedule and post a result somewhere (Telegram, Monday.com).

Staff are taught to prompt in plain English; CLI/terminal concepts are deliberately left out
of the onboarding deck.

## Consequences
- Backlog rows need to be triaged into "Desktop" vs. "Routine" before the deck's walkthrough
  section can be finished — some rows (e.g. content creation) may want both, depending on
  whether a human reviews output before it ships.
- Routines/Scheduled Tasks configuration itself is not a no-CLI experience yet (Routines are
  API-configured) — Som (or another technical owner) builds and maintains these on staff's
  behalf; staff only ever see the outputs.
- If Anthropic ships an official non-technical onboarding path later, revisit this ADR —
  it exists to fill a documented gap, not because this is the only viable model.
