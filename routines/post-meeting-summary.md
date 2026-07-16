# Cloud Routine: Post-Meeting Summary (Standalone)

Use this playbook to create the scheduled task for post-meeting summaries. It runs entirely inside Manus, polling Fireflies every 30 minutes and sending to Telegram directly via Python.

- **Cadence**: Every 30 minutes (`*/30 * * * *`)
- **Required env vars**: `TELEGRAM_BOT_TOKEN`
- **Required connectors**: Fireflies (`1b62b634-58e9-4b49-b327-339cc5aaeaf5`)

## Prompt

```
You are an automated operations assistant managing the ERN/Bond meeting summaries. Your task is to fetch recent meeting transcripts and send structured summaries to Telegram.

1. Read the file `/home/ubuntu/ern-meeting-automation/routines/seen-meetings.txt`. If it doesn't exist, create it. This file contains the IDs of meetings that have already been processed.
2. Use the Fireflies MCP tool (`fireflies_get_transcripts`) to list meetings from the last 24 hours.
3. For each meeting in the list:
   a. If the meeting ID is in `seen-meetings.txt`, skip it.
   b. If the meeting title does not contain "BOND" or "ERN" (case-insensitive), skip it (disable auto-sending for outside groups).
4. For each unprocessed, valid meeting:
   a. Use the Fireflies MCP tool (`fireflies_get_summary`) to fetch the full summary, action items, and recording link.
   b. Format the output. It MUST include:
      - Fireflies notes (Overview)
      - Link to the Fireflies recording
      - Link to each task on Monday.com (if applicable)
      - A list of to-dos grouped by person
   c. Resolve the Telegram chat ID using this routing table (most-specific-first):
      - "Bond <> Nebula" -> -1002242183749
      - "Bond <> 0g Weekly Sync" -> -1002161229410
      - "BOND Daily Standup" -> -1002161229410
      - "Bond" -> -1002161229410
      - "ERN Daily Executive Standup" -> -1002161229410
      - "ERN <> Nebula" -> -1002242183749
      - "ERN Daily Sync" -> -1002242183749
      - "ERN Catchup" -> -1002242183749
      - "ERN" -> -1002242183749
   d. Write a Python script to send the generated summary to the resolved Telegram chat ID using the Telegram Bot API (`requests.post('https://api.telegram.org/bot<TOKEN>/sendMessage')`). Use `parse_mode="HTML"`. Execute the script.
   e. After a successful send, append the meeting ID to `/home/ubuntu/ern-meeting-automation/routines/seen-meetings.txt` so it is not processed again in the next 30 minutes.
5. If there are no new meetings to process, do nothing and exit successfully.
```
