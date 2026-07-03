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
   - No match -> chatKey "ERN_SUPER_TEAM" (send there instead of dropping it, so it stays
     visible to the team rather than in a private ops DM; prefix the message with
     `No routing match for meeting "<title>" — sending agenda here instead.` so someone
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
   Style rules for the bullets, matched to how this team actually writes these by hand (see the
   real example below) — deviating from these makes the output read as obviously AI-generated:
   - Terse. Either a short label alone ("Dev SOP", "Nebula KOL"), or a short label + " — " +
     a brief elaboration ("RE7 / Midas API — confirm resolved => rehash w Turtle"). Never a full
     sentence, never explanatory prose.
   - Don't embellish or elaborate beyond what's actually in the source event description. If a
     note is terse in the source, keep it terse — don't pad it into a fuller sentence.
   - Variable bullet count per attendee is normal and expected (2 for one person, 5 for
     another) — this reflects real differences in workload, not an error to correct or a gap to
     fill with invented items.
   - No bold, no markdown decoration, no emoji. Plain text only, exactly like a person typing
     quickly into Telegram — this is a deliberate contrast with the post-meeting *summary*
     message (which does use bold for deadlines, since that one is LLM-condensed rather than
     copied near-verbatim from source notes).
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

Refreshed 2026-07-03 from a real Bond Telegram thread — this is the actual human-posted format
this routine is automating; note it's already scannable (short bullets, no prose), which is the
bar the agenda format should stay at (contrast with the post-meeting *summary* path, which has
had length problems — see ADR-0003's summarizer and the "reduce to a 2 minute read" note there).

```
Hey guys please find here the meeting agenda for today. Please lmk if I missed any items
@tawehbeysolowii @vinsonleow @hoaha47 @sowmyaraghavan @caitlinsarah
Bond Agenda

@tawehbeysolowii
- RE7 / Midas API — confirm resolved => rehash w Turtle
- 15 July Live timeline
- GSR Suggestions

@vinsonleow
- Dev SOP
- Nebula KOL

@hoaha47
- Turtle Documents — confirm outdated TWAP language and soft lock details removed; coordinate with Turtle on DocSend link updates and version control
- SEO update - pending Red
- Marketing Lead Applicant: 95 CVs, reviewing, follow up with questions
- PR - Follow up w PR Genius

@sowmyaraghavan
- Whitepaper/Vault Strategy — Amber protocol research and multi-chain vault competitive analysis + whitepaper outline
- Neobank
```

Real usage note: attendees often reply inline underneath this message in the same Telegram
thread (confirming an item, asking a follow-up) — the routine only ever posts the agenda itself
once per matching event; it doesn't need to handle replies.

## Why the window is 3-6h, not 3-4h

A 1-hour-wide window matched to an hourly cadence has zero tolerance for a routine firing a
few minutes late — a meeting can slip through uncaught. A 3-hour-wide window guarantees any
given meeting is caught in at least one run even with some drift, at the cost of needing the
idempotency marker in step 3/6 to avoid duplicate sends across the runs where it's caught twice.
