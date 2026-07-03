# ADR-0003: Add a live Anthropic API call to webhook-service for summary condensation

## Status
Accepted (2026-07-03)

## Context
CLAUDE.md documents a deliberate architectural principle for the post-meeting half of this
project: "Claude Code is not invoked at send time for this half" — `webhook-service` is a
plain, deterministic Node.js pipeline (Fireflies fetch → format → Telegram send), specifically
*because* Cloud Routines cannot listen for webhooks, so this half has to be a normal HTTP
service rather than an agent.

A request came in for the post-meeting summary to be condensed before sending: overview
collapsed to ≤3 thematic sentences, action items rewritten with imperative verbs and grouped
by assignee, overlapping cross-assignee tasks merged with joint ownership noted, hard deadlines
bolded, timestamps stripped. This is a genuine NLU/rewriting task — not something a deterministic
string-formatting function can do — so it requires a live model call somewhere in the pipeline.

## Decision
Add `webhook-service/src/summarizer.js`, calling the Anthropic Messages API directly via the
already-installed `axios` (no new SDK dependency), following the same injectable-`httpPost`
convention as `fireflies-client.js`/`notifier.js` so it stays testable with fakes and no live
API key in tests. `handle-webhook.js` calls it synchronously, inline, between fetching the raw
summary and routing/notifying — wrapped so that **any** error (timeout, API failure, malformed
response) falls back to sending the raw, unsimplified Fireflies summary rather than dropping
the meeting entirely. The summarizer is optional: if `ANTHROPIC_API_KEY` is unset, it's skipped
entirely and the raw summary always goes out — the same code path as any other summarizer
failure.

This is a direct HTTPS call to the Anthropic API, not an invocation of the Claude Code agent/CLI
— it does not reintroduce the "Claude Code can't listen for webhooks" problem this architecture
was built to avoid, since nothing here needs to receive an inbound webhook. But a reasonable
reader of CLAUDE.md's "no live Claude Code at send time" line would still see this as eroding
the "plain deterministic pipeline" property the docs lean on, so it's recorded here as a
deliberate, considered reversal rather than a silent drift.

## Consequences
- New secret: `ANTHROPIC_API_KEY`, added to `.env.example` and `render.yaml` (`sync: false`,
  same handling as the other five secrets already there).
- Added latency: a few seconds per meeting. Judged negligible against the existing
  `fireflies-client.js` retry budget (up to 10 attempts × 30s = ~4.5 min) — this path was never
  actually "instant" end-to-end; only the Fireflies webhook *ack* is immediate (`app.js`
  responds 200 before `handleFirefliesWebhook` runs at all).
- Added cost: one Anthropic API call per processed meeting.
- Preserves "no lost summaries": a summarizer failure is swallowed by `simplifyOrFallback` in
  `handle-webhook.js` and never surfaces as a `notifyOpsFailure`/`failed` status — the meeting
  still gets a (raw) summary.
- If bugs or cost/latency turn out worse than judged here, the fix is to unset
  `ANTHROPIC_API_KEY` in Render, which disables the feature with zero code changes — the
  fallback path *is* the disable switch.
