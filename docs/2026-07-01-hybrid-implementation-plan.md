# Hybrid Implementation Plan: Claude Code + Webhook Service

This document outlines a production-ready, hybrid architecture to automate meeting workflows. The solution is designed for operations and marketing teams looking to automate internal processes like meeting prep and note distribution. It leverages Claude Code Cloud Routines for intelligent, scheduled pre-meeting reminders and a lightweight webhook service for real-time post-meeting Fireflies AI summaries.

By separating the scheduled AI tasks from the real-time event triggers, this architecture provides the best of both worlds: Anthropic's powerful AI reasoning for meeting prep, and instant event-driven delivery for post-meeting notes.

## Revision note (2026-07-01)

This version folds in fixes from a design review of the original draft. Each fix below maps to a specific section further down:

1. Pre-meeting window standardized to **3-6 hours out**, hourly cadence (was an inconsistent "3-6h" vs "exactly 3-4h" in the original draft).
2. **Idempotency marker** added so the same meeting can't fire two reminders across consecutive hourly runs.
3. Post-meeting sends are **deduped by `meetingId`** to survive webhook retries / cold-start delays.
4. Summary fetch uses a **bounded retry with backoff**, and **alerts to an ops chat on final failure** instead of silently logging.
5. Telegram messages use **plain text**, not legacy `parse_mode: 'Markdown'`, which breaks on unescaped `_`/`*`/backticks in AI-generated summaries.
6. Fireflies' webhook **signature scheme is confirmed**: V2 webhooks send an HMAC-SHA256 signature in the `x-hub-signature` header as `sha256=<hex>` (per [Fireflies' webhook docs](https://docs.fireflies.ai/graphql-api/webhooks)) — the original draft's implementation was already correct.
7. A **staging step** (test Telegram chat, test calendar event, test Fireflies call) precedes pointing either component at the real team chat.

## 1. Why a Hybrid Approach?

To fully automate the meeting lifecycle, the system must handle two fundamentally different types of work:

- **Scheduled Polling (Pre-Meeting)**: The system needs to check Google Calendar regularly and intelligently draft an agenda for upcoming meetings. Claude Code's Cloud Routines are perfectly suited for this, as they run autonomously on Anthropic's infrastructure [1].
- **Event-Driven Webhooks (Post-Meeting)**: The system needs to react instantly when Fireflies AI finishes transcribing a call. Because Claude Code cannot act as a persistent HTTP listener to receive webhooks [2], a small, free web service is required to catch the Fireflies event and push it to Telegram.

This environment has no pre-connected MCP tools (fresh setup, no Fireflies/Calendar connectors live), so both halves of this plan require explicit setup — there is no shortcut via an already-wired connector.

## 2. Architecture Overview

**Component A: Pre-Meeting Reminders (Claude Code)**
- Host: Anthropic Cloud (Claude Code Cloud Routines) [1].
- Trigger: Scheduled to run every hour.
- Data Source: Google Calendar (via MCP connector).
- Delivery: Telegram (via direct API call).
- Logic: Claude queries the calendar, identifies meetings starting 3-6 hours from now, drafts a contextual agenda, and sends it to the relevant Telegram chat — marking the event so it isn't re-sent on the next hourly run.

**Component B: Post-Meeting Summaries (Webhook Service)**
- Host: Render (free tier) running a lightweight Node.js service.
- Trigger: Fireflies AI Webhook (`Transcription completed` event).
- Data Source: Fireflies GraphQL API.
- Delivery: Telegram Bot API.
- Logic: The service receives the webhook, verifies its security signature, dedupes by `meetingId`, polls Fireflies for the AI-generated summary with bounded retry, formats it, and sends it to Telegram — alerting an ops chat if it can't get a summary within the retry window.

## 3. Implementation Guide: Pre-Meeting Reminders

### Step 1: Configure MCP Connectors

Before creating the routine, ensure Claude Code has access to Google Calendar:

```
claude mcp add --transport stdio google-calendar -- npx -y @modelcontextprotocol/server-google-calendar
```

### Step 2: Create the Cloud Routine

Create the routine via the Claude web interface (claude.ai/code/routines) or the `/schedule` skill from the CLI [1].

- **Trigger**: Hourly.
- **Environment**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- **Connectors**: `google-calendar` enabled for this routine.
- **Prompt**: see [routines/pre-meeting-reminder.md](../routines/pre-meeting-reminder.md) for the exact, corrected prompt (window fixed to 3-6h, idempotency step added).

### Step 3: Idempotency

Cloud Routines are stateless between runs. With a 3-hour-wide window and hourly cadence, the same meeting can appear in more than one run. The routine prompt handles this by appending a marker (e.g. `[reminder-sent]`) to the calendar event's description via the Calendar MCP's update capability, and skipping any event that already carries the marker. This needs no external storage.

## 4. Implementation Guide: Post-Meeting Summaries

Because Claude Code cannot listen for incoming webhooks, a small, free web service handles the Fireflies integration. See [webhook-service/index.js](../webhook-service/index.js) for the working skeleton; key differences from a naive implementation:

- **Dedupe by `meetingId`** (in-memory `Set` is enough for a single-instance free-tier deployment; note this resets on redeploy/restart — acceptable given Fireflies also includes a `meetingId` you can cross-check against Telegram message history if stronger guarantees are ever needed).
- **Bounded retry with backoff** when fetching the summary (Fireflies may not have finished generating it the instant the webhook fires).
- **Alert on failure**: if the summary still isn't ready after the retry window, send a Telegram message to an ops channel identifying the meeting so a human can follow up manually, instead of only `console.error`.
- **Plain-text Telegram delivery** — no `parse_mode`, since AI-generated summary text will contain unescaped Markdown special characters unpredictably.
- **Signature verification: confirmed correct.** Fireflies' V2 webhooks send an HMAC-SHA256 signature in `x-hub-signature` as `sha256=<hex>`, matching the skeleton's implementation.

### Deployment

1. Push `webhook-service/` to a GitHub repository (requires explicit go-ahead — not done as part of this scaffolding).
2. Connect the repository to Render (Web Service).
3. Add environment variables (`FIREFLIES_SECRET`, `FIREFLIES_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_OPS_CHAT_ID`) in Render's dashboard.
4. Copy the deployed URL (e.g. `https://my-service.onrender.com/webhook/fireflies`) into Fireflies AI's Developer Settings as the webhook endpoint.

## 5. Staging Before Go-Live

Before pointing either component at the real team chat:

1. Point `TELEGRAM_CHAT_ID` (routine) and `TELEGRAM_CHAT_ID` (webhook service) at a private test chat.
2. Create a real calendar event 3-6 hours out and manually trigger the routine once to confirm the reminder fires and the idempotency marker is written (re-run and confirm no duplicate).
3. Trigger a real Fireflies test call and confirm the webhook fires, dedupes correctly on a simulated retry, and the summary lands correctly formatted.
4. Only then switch both `TELEGRAM_CHAT_ID` values to the real team chat.

## 6. Summary for Operations Teams

This setup drastically reduces manual operational overhead. By combining Claude Code's scheduled intelligence with a simple, hardened webhook receiver, your team ensures that:

- Everyone is prepared for calls hours in advance, with no duplicate reminders.
- Action items and summaries are distributed to the team chat moments after a call ends, with a human alerted if that pipeline ever fails silently.
- The infrastructure runs entirely on free or included tiers (Anthropic subscription required for Claude Code Routines).

## References

[1] Anthropic. "Automate work with routines." Claude Code Documentation. Available at: https://code.claude.com/docs/en/routines
[2] Anthropic. "Connect Claude Code to tools via MCP." Claude Code Documentation. Available at: https://code.claude.com/docs/en/mcp
