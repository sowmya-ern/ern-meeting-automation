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
2. Filter to events starting between 11 and 13 hours from right now (approximates "at least 12
   hours before" with enough width that an hourly cadence can't miss it on drift).
3. For each matching event, check its description for the marker "[reminder-sent]".
   - If present, skip it — a reminder already went out for this event.
4. For each remaining matching event, resolve which symbolic chat key it goes to by checking
   the event title against this table, most-specific-first:
   - Title contains "Bond <> Nebula" -> chatKey "BOND_NEBULA"
   - Title contains "Bond <> 0g Weekly Sync" -> chatKey "BOND_TEAM"
   - Title contains "BOND Daily Standup" -> chatKey "BOND_TEAM"
   - Title contains "Bond" -> chatKey "BOND_TEAM"
   - Title contains "ERN Daily Executive Standup" -> chatKey "ERN_EXEC_STANDUP"
   - Title contains "ERN <> Nebula" -> chatKey "ERN_SUPER_TEAM"
   - Title contains "ERN Daily Sync" -> chatKey "ERN_SUPER_TEAM"
   - No match -> chatKey "ERN_SUPER_TEAM" (send there instead of dropping it, so it stays
     visible to the team rather than in a private ops DM; prefix the message with
     `No routing match for meeting "<title>" — sending agenda here instead.` so someone
     notices and can add a rule)
5. For each remaining matching event, draft a "Pre-Meeting Reminder" message in this exact
   structure — note this groups by TOPIC, not by attendee (a deliberate change from the old
   per-attendee format, per the 2026-07-04 briefing):

   ⏰ *<meeting series name> — Pre-Meeting Reminder*
   _Sending ahead of today's call. Please come prepared on the following:_

   ---

   📌 *On the Agenda*
   • <high-level topic 1, pulled from the event description>
   • <high-level topic 2>

   ---

   📎 *Please review before joining*
   • <a specific document, metric, or pending item mentioned in the event description that
     attendees should look at beforehand — omit this whole section if the description has
     nothing review-worthy, don't invent one>

   ---

   🕐 _See you on the call. Reply here if you can't make it._

   Tag every attendee (using the mapping below) on the line right after the title, same as
   today. Group the event description's per-attendee notes UP into shared topics for "On the
   Agenda" — do not simply relabel each attendee's bullets as a "topic"; a well-formed topic
   like "RE7 / Midas API" may summarize what was previously one attendee's item, and that's
   fine. Keep bullets terse, matching the source material's own terseness — don't pad.
   Attendee handle mapping (kept in sync with `webhook-service/src/attendee-handles.js` — a
   Cloud Routine prompt has no code path to require() that file, so update both by hand):
   - Taweh Bey Solowii -> @tawehbeysolowii
   - Vinson Leow -> @vinsonleow
   - Hoa Ha -> @hoaha47
   - Sowmya Raghavan -> @sraghavan
   - Caitlin Sarah -> @caitlinsarah
   - Red -> @redbeem
   - Dr. Jonathan -> @jonscott
   - Keli Whitlock -> @keliwhitlock
   - Jerad Finck -> @JeradFinck
   - Rob Christensen has no Telegram handle -- list by plain name, same as any unmapped attendee.
6. Send the message via the relay, not directly to Telegram: POST
   `{WEBHOOK_RELAY_URL}/relay/telegram-agenda` with header `Authorization: Bearer {RELAY_SECRET}`
   and JSON body `{ "chatKey": "<key resolved in step 4>", "text": "<the drafted message>" }`.
   This routine never calls the Telegram API directly and never sees a real chat_id.
7. After a successful send, update the event's description to append "[reminder-sent]" via the
   Calendar MCP tool, so this event is not re-sent on the next hourly run.
8. If there are no matching events, do nothing and exit successfully.
```

### Example output (Bond Daily Standup)

Real example pending — the format above changed 2026-07-04 from per-attendee to topic-level;
refresh this example from the next real send.

Real usage note: attendees often reply inline underneath this message in the same Telegram
thread (confirming an item, asking a follow-up) — the routine only ever posts the reminder
itself once per matching event; it doesn't need to handle replies.

## Why the window is 11-13h, not 12h exactly

A 1-hour-wide window matched to an hourly cadence has zero tolerance for a routine firing a
few minutes late — a meeting can slip through uncaught. An 11-13h-wide window guarantees any
given meeting is caught in at least one run even with some drift, while still landing close to
the "at least 12 hours before" target, at the cost of needing the idempotency marker in step 3/6
to avoid duplicate sends across the runs where it's caught twice.
