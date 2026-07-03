# Meeting Automation: Summary

## What This Does

Two automated workflows handle the full meeting lifecycle:

1. **Pre-Meeting Agenda** — sent to the right Telegram group 3–6 hours before each call.
2. **Post-Meeting Summary** — sent to the right Telegram group automatically after Fireflies
   finishes transcribing.

## How It Works

### Pre-Meeting (Claude Code Cloud Routine)

- Runs every hour on Anthropic's cloud — this is the only piece where Claude Code itself runs
  at send time.
- Reads Google Calendar (via an MCP connector) and finds meetings starting 3–6 hours out.
- Drafts and sends a formatted agenda to the correct Telegram group.
- Marks the calendar event with `[reminder-sent]` so it never double-sends across the hourly
  runs that can both catch the same meeting inside the 3-hour window.

### Post-Meeting (Webhook Relay — no live Claude Code involved)

- Fireflies fires a webhook the moment a transcript is ready.
- A small relay service (`webhook-service/`, plain Node.js/Express, hosted free on Render)
  catches the webhook, verifies its signature is genuine, fetches the AI summary from
  Fireflies, formats it, and sends it to the correct Telegram group — all in that one service.
  Claude Code is not invoked at send time for this half; it was used to build the service, not
  to run it.
- The meeting ID is recorded in an **in-memory list inside the running service** so it isn't
  sent twice. This resets if the service restarts or redeploys — a deliberate tradeoff for a
  free-tier single instance, not a persisted file. If a meeting somehow slipped through twice,
  Fireflies' own meeting ID is still available to cross-check manually.

## Meeting → Telegram Routing

| Meeting               | Telegram Group          |
|------------------------|--------------------------|
| Bond <> Nebula         | Bond<>Nebula chat        |
| Bond Daily Standup     | Bond Team Main           |
| ERN Daily Executive Standup | ERN Team Operations |
| ERN Daily Sync         | ERN Super Team           |
| Anything else          | **Not** a default group — sent to the ops chat flagged "unrouted" so a human adds a routing rule, instead of landing somewhere by default |

Rules are checked most-specific-first (`Bond <> Nebula` before the looser `Bond`) so a
Bond<>Nebula meeting can't accidentally match the general Bond rule.

## Example: Bond Daily Standup Telegram Message

**Pre-Meeting (sent ~3–6 hours before):**

```
Hey guys please find here the meeting agenda for today. Please lmk if I missed any items
@tawehbeysolowii @vinsonleow @hoaha47 @sowmyaraghavan @caitlinsarah
Bond Agenda

@tawehbeysolowii
- RE7 / Turtle Club API — unblock LP redeployment and yield display
- LP Tracker update - to share w GSR & Turtle
- Recreate 0G - Bond meeting w 0G email address

@vinsonleow
- Marketing Applicant questions
- Nebula KOL
- Separate Marketing meeting w Ada, JC

@hoaha47
- Marketing Lead — 55 CVs, shortlist top 5 candidates
- PR — follow up w PR Genius
- Turtle DD Documentation — pinged
- LP Two-Pager — pending sample from GSR
- OKX form - submitted

@sowmyaraghavan
- Asset breakdown
- Points Console Doc — update per Abolaji feedback
- Whitepaper / Stablecoin
- Neobank - schedule dedicated meeting next week, Caitlyn onboarding

@caitlinsarah
- Neobank Onboarding — Caitlyn onboarding
```

**Post-Meeting (sent automatically after the call):**

```
Hey guys please find here the meeting summary for today. Please lmk if anything's missing.
@tawehbeysolowii @vinsonleow @hoaha47 @sowmyaraghavan @caitlinsarah
Bond Daily Standup Summary

Overview:
[AI-generated overview from Fireflies]

Action Items:
[AI-generated action items from Fireflies]
```

Action items are one block of text from Fireflies, not split per person — Fireflies doesn't
return them grouped by attendee, so unlike the agenda this can't be broken out per person.
Attendees not in the handle mapping appear by their plain name instead of an `@mention` rather
than being dropped.

## What You Need to Set Up (One-Time)

| Item | Where |
|---|---|
| Google Calendar MCP connector (OAuth) | `claude mcp add` / Claude Code connector settings |
| Telegram Bot Token | @BotFather on Telegram |
| Telegram Chat IDs (one per group + one ops chat) | Telegram Bot API (`getUpdates`) |
| Deploy the webhook relay | Render (`render.yaml` already in the repo) |
| Register the deployed webhook URL with Fireflies | Fireflies Dashboard → Developer Settings — this step is what generates `FIREFLIES_SECRET`, so it has to happen *after* the Render deploy, not before |
| Create the Cloud Routine | `/schedule` skill or claude.ai/code/routines — **one** routine (pre-meeting only; post-meeting runs as the deployed webhook service, not a second routine) |

## Key Design Decisions

- **No duplicate messages.** The pre-meeting routine writes `[reminder-sent]` directly onto
  the calendar event. The post-meeting service checks an in-memory set of meeting IDs before
  sending. Both checks happen before any message goes out.
- **No missed meetings.** The 3-hour-wide reminder window (not 1 hour) ensures every meeting
  is caught by at least one hourly run, even if a run fires a few minutes late.
- **No silent drops.** If a meeting title doesn't match any routing rule, it goes to the ops
  chat flagged `unrouted` for a human to fix, rather than being discarded or guessed at.
- **No lost summaries.** If the Fireflies AI summary isn't ready immediately after
  transcription, the service retries up to 10 times with a 30-second delay between attempts
  (up to ~4.5 minutes) before alerting the ops chat with the meeting ID and failure reason so a
  human can follow up.
