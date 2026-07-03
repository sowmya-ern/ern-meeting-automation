# Cloud Routine: Pre-Meeting Reminder

Use this with the `/schedule` skill (or claude.ai/code/routines) to create the hourly routine.

- **Cadence**: hourly (`0 * * * *`)
- **Required env vars**: `WEBHOOK_RELAY_URL` (the deployed `webhook-service` base URL, e.g.
  `https://ern-fireflies-webhook.onrender.com`), `RELAY_SECRET`.
  See [ADR-0004](../docs/adr/0004-pre-meeting-relay-instead-of-routine-secrets.md) for why this
  routine holds neither `TELEGRAM_BOT_TOKEN` nor a real chat_id — Anthropic's own Cloud Routine
  docs warn against putting real secrets/credentials in a routine's environment, so this routine
  only ever holds `RELAY_SECRET` (a narrow-purpose relay token, easy to rotate) and calls
  `webhook-service`'s `/relay/telegram-agenda` endpoint, which holds the real bot token and chat
  IDs correctly in Render's env vars.
- **Required connector**: `google-calendar`

## Prompt

```
You are an automated operations assistant. Your task is to send pre-meeting reminders to Telegram.

1. Use the Google Calendar MCP tool to list all events for today and tomorrow.
2. Filter to events starting between 3 and 6 hours from right now.
3. For each matching event, check its description for the marker "[reminder-sent]".
   - If present, skip it — a reminder already went out for this event.
4. For each remaining matching event, resolve which symbolic chat key it goes to by checking
   the event title against this table, most-specific-first (checked in this order so a "Bond <>
   Nebula" meeting doesn't match the looser "Bond" rule first) — these are symbolic keys, not
   real chat IDs; `webhook-service` resolves the actual chat_id server-side (see
   `relay-chat-keys.js`), kept in sync with this table by hand:
   - Title contains "Bond <> Nebula" -> chatKey "BOND_NEBULA"
   - Title contains "Bond" -> chatKey "BOND_TEAM"
   - Title contains "ERN Daily Executive Standup" -> chatKey "ERN_EXEC_STANDUP"
   - Title contains "ERN Daily Sync" -> chatKey "ERN_SUPER_TEAM"
   - No match -> chatKey "OPS" (send there instead of dropping it; prefix the message
     with `No routing match for meeting "<title>" — sending agenda here instead.` so a human
     notices and can add a rule)
5. For each remaining matching event, draft a "Pre-Meeting Agenda" message in this exact
   structure:
   a. Opening line: "Hey guys please find here the meeting agenda for today. Please lmk if I
      missed any items"
   b. A line listing every attendee's Telegram handle, using the mapping below (attendees not
      in the mapping are listed by their plain name instead of a handle).
   c. A title line: "<meeting series name> Agenda" (e.g. "Bond Agenda").
   d. One section per attendee: their handle (or name) on its own line, then a bullet list of
      their open items pulled from the event description — the description is expected to
      contain notes/items already grouped or attributable per attendee; if an item's owner
      can't be determined, list it under a final "Other" section rather than guessing.
   Attendee handle mapping (kept in sync with `webhook-service/src/attendee-handles.js` — a
   Cloud Routine prompt has no code path to require() that file, so update both by hand):
   - Taweh Bey Solowii -> @tawehbeysolowii
   - Vinson Leow -> @vinsonleow
   - Hoa Ha -> @hoaha47
   - Sowmya Raghavan -> @sowmyaraghavan
   - Caitlin Sarah -> @caitlinsarah
6. Send the message via the relay, not directly to Telegram: POST
   `{WEBHOOK_RELAY_URL}/relay/telegram-agenda` with header `Authorization: Bearer {RELAY_SECRET}`
   and JSON body `{ "chatKey": "<key resolved in step 4>", "text": "<the drafted message>" }`.
   This routine never calls the Telegram API directly and never sees a real chat_id.
7. After a successful send, update the event's description to append "[reminder-sent]" via the
   Calendar MCP tool, so this event is not re-sent on the next hourly run.
8. If there are no matching events, do nothing and exit successfully.
```

### Example output (Bond Daily Standup)

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

## Why the window is 3-6h, not 3-4h

A 1-hour-wide window matched to an hourly cadence has zero tolerance for a routine firing a
few minutes late — a meeting can slip through uncaught. A 3-hour-wide window guarantees any
given meeting is caught in at least one run even with some drift, at the cost of needing the
idempotency marker in step 3/6 to avoid duplicate sends across the runs where it's caught twice.
