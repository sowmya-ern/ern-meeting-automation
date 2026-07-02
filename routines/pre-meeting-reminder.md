# Cloud Routine: Pre-Meeting Reminder

Use this with the `/schedule` skill (or claude.ai/code/routines) to create the hourly routine.

- **Cadence**: hourly (`0 * * * *`)
- **Required env vars**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- **Required connector**: `google-calendar`

## Prompt

```
You are an automated operations assistant. Your task is to send pre-meeting reminders to Telegram.

1. Use the Google Calendar MCP tool to list all events for today and tomorrow.
2. Filter to events starting between 3 and 6 hours from right now.
3. For each matching event, check its description for the marker "[reminder-sent]".
   - If present, skip it — a reminder already went out for this event.
4. For each remaining matching event, draft a concise "Pre-Meeting Agenda" message including
   the title, start time, attendees, and any notes from the description.
5. Send the message to TELEGRAM_CHAT_ID using TELEGRAM_BOT_TOKEN via the Telegram Bot API
   (POST https://api.telegram.org/bot<TOKEN>/sendMessage, plain text, no parse_mode).
6. After a successful send, update the event's description to append "[reminder-sent]" via the
   Calendar MCP tool, so this event is not re-sent on the next hourly run.
7. If there are no matching events, do nothing and exit successfully.
```

## Why the window is 3-6h, not 3-4h

A 1-hour-wide window matched to an hourly cadence has zero tolerance for a routine firing a
few minutes late — a meeting can slip through uncaught. A 3-hour-wide window guarantees any
given meeting is caught in at least one run even with some drift, at the cost of needing the
idempotency marker in step 3/6 to avoid duplicate sends across the runs where it's caught twice.
