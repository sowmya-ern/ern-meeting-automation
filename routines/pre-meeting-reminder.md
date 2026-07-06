# Cloud Routine: Pre-Meeting Reminder

Use this with the `/schedule` skill (or claude.ai/code/routines) to create the hourly routine.

- **Cadence**: hourly (`0 * * * *`)
- **Required env vars**: `WEBHOOK_RELAY_URL` (the deployed `webhook-service` base URL, e.g.
  `https://ern-fireflies-webhook.onrender.com`), `RELAY_SECRET`.
  See [ADR-0004](../docs/adr/0004-pre-meeting-relay-instead-of-routine-secrets.md) for why this
  routine holds neither `TELEGRAM_BOT_TOKEN` nor a real chat_id — Anthropic's own Cloud Routine
  docs warn against putting real secrets/credentials in a routine's environment, so this routine
  only ever holds `RELAY_SECRET` (a narrow-purpose relay token, easy to rotate) and calls
  `webhook-service`'s `/relay/telegram-agenda-generate` endpoint, which holds the real bot token,
  chat IDs, and Supabase connection correctly in Render's env vars.
- **Required connector**: `google-calendar`

## Prompt

```
You are an automated operations assistant. Your task is to trigger pre-meeting reminders.

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
   - No match -> chatKey "ERN_SUPER_TEAM"
5. For each remaining matching event, send the event details to the webhook service to generate
   and send the per-person reminder based on meeting history: POST
   `{WEBHOOK_RELAY_URL}/relay/telegram-agenda-generate` with header `Authorization: Bearer {RELAY_SECRET}`
   and JSON body:
   {
     "chatKey": "<key resolved in step 4>",
     "title": "<event title>",
     "description": "<event description>",
     "attendees": ["<list of attendee names/emails from the event>"]
   }
6. After a successful send (200 OK from the relay), update the event's description to append
   "[reminder-sent]" via the Calendar MCP tool, so this event is not re-sent on the next run.
7. If there are no matching events, do nothing and exit successfully.
```

## Why the window is 11-13h, not 12h exactly

A 1-hour-wide window matched to an hourly cadence has zero tolerance for a routine firing a
few minutes late — a meeting can slip through uncaught. An 11-13h-wide window guarantees any
given meeting is caught in at least one run even with some drift, while still landing close to
the "at least 12 hours before" target, at the cost of needing the idempotency marker in step 3/6
to avoid duplicate sends across the runs where it's caught twice.
