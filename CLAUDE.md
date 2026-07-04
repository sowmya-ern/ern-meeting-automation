# ERN Meeting Automation

**Scope note (2026-07-02):** despite the name, this project now covers ERN's company-wide
shift onto Claude Code — not just meetings. Meeting automation (below) was the first module;
the company-wide staff onboarding deck and the wider Ops/Marketing/Partnerships backlog
migration (see [CONTEXT.md](CONTEXT.md)) live here too. Name kept as-is to avoid rename churn.

Hybrid meeting-workflow automation: Claude Code Cloud Routines for pre-meeting Telegram
reminders (Google Calendar), plus a small webhook service for post-meeting Fireflies AI
summaries (Telegram).

Full plan: [docs/2026-07-01-hybrid-implementation-plan.md](docs/2026-07-01-hybrid-implementation-plan.md)
Domain vocabulary: [CONTEXT.md](CONTEXT.md) · Module spec: [docs/2026-07-01-SPEC.md](docs/2026-07-01-SPEC.md) · Decisions: [docs/adr/](docs/adr/)

## Status (2026-07-01)

- Plan drafted and grilled — see revision note at the top of the plan doc for the 7 fixes
  folded in versus the original draft.
- Architecture reviewed via `/improve-codebase-architecture` and fully implemented per
  [docs/2026-07-01-SPEC.md](docs/2026-07-01-SPEC.md): `webhook-service/` is now
  `verify-signature`, `fireflies-client`, `notifier`, `seen-meetings`, `handle-webhook`
  (the transport-agnostic core), and `app.js` (Express wiring, not listening) — `index.js`
  is just the entrypoint. The pre-meeting reminder's window/idempotency policy stays
  prose-only in the routine prompt — recorded as
  [ADR-0001](docs/adr/0001-reminder-policy-in-prompt.md).
- **19/19 tests pass** (`npm test` in `webhook-service/`, Node's built-in `node --test`, zero
  new dependencies): 16 unit tests across the five modules, plus 3 end-to-end smoke tests in
  `test/app.test.js` that drive the real Express app over real HTTP with a fake secret and
  fake Fireflies/Telegram adapters — this is the "one test version": a fully runnable
  rehearsal of the whole webhook path with **no real credentials required**. Run it any time
  with `cd webhook-service && npm install && npm test`.
- `webhook-service/` is code-complete but **not yet deployed**.
- **Real credentials received (2026-07-02)** for Telegram + Fireflies API key, written to
  `webhook-service/.env` (gitignored, never committed): bot token, ops-chat personal DM
  (`495772777`, looked up via `getUpdates` — confirmed as `@sraghavan`), and 4 named
  meeting-routing chat IDs (Bond Team, Bond<>Nebula, ERN Super Team, ERN Daily Executive
  Standup — the last shares a chat with what was originally called "ERN Operations Main",
  confirmed intentional). `FIREFLIES_SECRET` still blank — it's generated when the webhook
  URL is registered on Fireflies' dashboard, which needs a deployed URL first (chicken/egg,
  expected to arrive after the Render step).
- **Routing extension (2026-07-02)**: the original single-`TELEGRAM_CHAT_ID` design didn't
  anticipate per-meeting-series routing. Added `meeting-router.js` (matches Fireflies'
  transcript `title` against an ordered, most-specific-first rule list) and reshaped
  `notifier.js`/`handle-webhook.js` accordingly — see the 2026-07-02 revision in
  [docs/2026-07-01-SPEC.md](docs/2026-07-01-SPEC.md). Unmatched meeting titles fall back to
  the ops chat (`status: 'unrouted'`) instead of being silently dropped.
- **Shared message format (2026-07-02)**: the pre-meeting routine's agenda prompt was given a
  concrete per-person structure (opening line, `@mention` line, `<series> Agenda` title, one
  section per attendee — see `routines/pre-meeting-reminder.md`), and the webhook service's
  post-meeting summary was brought to the same visual style. Added `attendee-handles.js`
  (Fireflies display name → Telegram `@handle`, unmapped names fall back to plain name) and
  extended `fireflies-client.js` to fetch `meeting_attendees`. Action items themselves stay one
  unstructured string per meeting (Fireflies doesn't group them per attendee) — only the
  header/mentions match between the two paths. **31/31 tests pass.**
- CI (`.github/workflows/test.yml`, runs `npm test` on push/PR) and deploy config
  (`render.yaml`, declares the Render web service with 5 env vars marked `sync: false` so
  Render prompts for real values instead of reading them from the repo) are in place —
  neither needs secrets to exist. `webhook-service/README.md` documents run/test/deploy.
- Cloud Routine for pre-meeting reminders is **not yet created** — prompt is ready in
  `routines/pre-meeting-reminder.md`, needs to be registered via the `/schedule` skill or
  claude.ai/code/routines.
- **Pushed to GitHub**: [sowmya-ern/ern-meeting-automation](https://github.com/sowmya-ern/ern-meeting-automation).
  CI ran on push and passed (19/19 tests green in GitHub Actions). **Made public 2026-07-03**
  (was private) to unblock Render's Blueprint repo picker — verified first that `.env` was
  never committed at any point in git history and no secret-pattern matches exist anywhere in
  history before flipping visibility. Repo docs (CLAUDE.md, CONTEXT.md, routine prose) contain
  real team member names/handles and internal strategy notes, now world-readable — no
  credentials.

## Open items before go-live

1. ~~Deploy `webhook-service/` to Render~~ **Done (2026-07-03).** Repo made public
   (`github.com/sowmya-ern/ern-meeting-automation`) to unblock Render's repo fetch (no GitHub
   App install-access grant needed once public — see repo-visibility note below). Created via
   Render's REST API directly (`POST /v1/services`, service id `srv-d93o9icvikkc73ankr10`),
   not the dashboard: `type: web_service`, `rootDir: webhook-service`, `runtime: node`,
   `buildCommand: npm install`, `startCommand: npm start`, `plan: free`, `region: oregon`, all
   9 required env vars set (`RELAY_SECRET` freshly generated via `openssl rand -hex 32`, synced
   to local `.env` too; `FIREFLIES_SECRET` and `ANTHROPIC_API_KEY` intentionally left unset —
   both optional/fallback-safe). Live URL: `https://ern-fireflies-webhook.onrender.com`.
2. ~~Register the deployed URL on Fireflies' dashboard~~ **Done (2026-07-03).** Webhooks V2
   (`app.fireflies.ai/integrations/api/webhook`), URL
   `https://ern-fireflies-webhook.onrender.com/webhook/fireflies`, subscribed to "Meeting
   Summarized" only, signing secret matches Render's `FIREFLIES_SECRET`. First real delivery
   confirmed successful after fixing the V1-vs-V2 payload mismatch (see below) and the URL
   missing its path.
3. Register the Cloud Routine (`routines/pre-meeting-reminder.md`) via `/schedule` or
   claude.ai/code/routines, toggling on the "Google Calendar" connector — `WEBHOOK_RELAY_URL`
   is now known (`https://ern-fireflies-webhook.onrender.com`) and `RELAY_SECRET` exists; ready
   to register.
4. Run the staging checklist in the plan doc (section 5) before treating the routed chats as
   fully live — the routing table is untested against a real Fireflies transcript title.

Fireflies signature verification (`x-hub-signature`, HMAC-SHA256) is confirmed correct against
their webhook docs — no longer an open item.

**Pre-meeting routing parity fix (2026-07-02):** the pre-meeting routine still sent every
agenda to one `TELEGRAM_CHAT_ID`, while `webhook-service`'s post-meeting side already routed
per meeting series. Brought the routine's prose in line with `meeting-router.js`'s table
(same 5 env vars, same most-specific-first title matching, same unrouted-goes-to-ops
fallback) so a meeting series lands in the same chat for both its agenda and its summary.

**Google Calendar connector (2026-07-02): confirmed already live, no OAuth setup needed.**
A separate Google Workspace "Calendar MCP server" (`calendarmcp.googleapis.com`, real but
currently Developer Preview, would need a self-managed Google Cloud OAuth client) looked like
a prerequisite, but it isn't — Cloud Routines pull from Anthropic's own claude.ai connectors,
not from custom self-hosted MCP servers. Verified directly: `list_calendars` via the
claude.ai Google Calendar connector already returns real data
(`sowmya@rivr.net` + Singapore holidays) in this environment, so the routine just needs that
same connector toggled on when created — no Google Cloud project or OAuth client required.

**Cloud Routine secret handling (2026-07-03): resolved via a relay endpoint, see
[ADR-0004](docs/adr/0004-pre-meeting-relay-instead-of-routine-secrets.md).** Confirmed via
Anthropic's own docs that Cloud Routines have no real secrets store (the Environment's env-var
panel explicitly warns against putting credentials there), so the routine never gets
`TELEGRAM_BOT_TOKEN` or a real chat_id. Added `webhook-service`'s
`POST /relay/telegram-agenda` (`verify-relay-token.js`, `relay-chat-keys.js`, `notifier.js`'s
new `sendPlainText`) — the routine holds only `RELAY_SECRET` (narrow-purpose, easy to rotate)
and a symbolic chat key (`BOND_TEAM`, `BOND_NEBULA`, `ERN_EXEC_STANDUP`, `ERN_SUPER_TEAM`,
`OPS`); `webhook-service` resolves the real chat_id and sends server-side. `routines/
pre-meeting-reminder.md` updated to call the relay instead of the Telegram API directly.
**55/55 tests pass.**

**Live summarization added (2026-07-03), see [ADR-0003](docs/adr/0003-live-summarization-in-webhook-service.md).**
`webhook-service` now optionally condenses the raw Fireflies summary via a direct Anthropic API
call (`summarizer.js`) before Telegram send — collapses the overview to ≤3 sentences, rewrites
action items with imperative verbs grouped by assignee, merges cross-assignee overlaps, bolds
deadlines. Synchronous, with mandatory fallback to the raw summary on any failure (including
when `ANTHROPIC_API_KEY` is simply unset) — never drops a summary. Also switched
`notifier.js` from no-`parse_mode` to `parse_mode: 'HTML'` with a 3-character `escapeHtml()`
applied to everything interpolated, so `**word**` markers (the only source of bold text) can be
converted to `<b>` tags without trusting raw HTML from Fireflies or the model. Also fixed:
`render.yaml` still listed the old single `TELEGRAM_CHAT_ID` instead of the 4 per-series chat
vars from the 2026-07-02 routing revision — never updated at the time, now corrected, plus the
new `ANTHROPIC_API_KEY` added.

**Summarizer tightened + activated (2026-07-03).** `ANTHROPIC_API_KEY` was live-but-unset on
Render since deploy, so every meeting was silently going out as the raw, uncondensed Fireflies
summary (7+ overview bullets, full per-item timestamps) — the summarizer path existed in code
but never actually ran. Key is now set on Render (real value, not committed anywhere). Also
tightened `summarizer.js`'s `RULES` per a `/grill-me` session: overview sentences may no longer
chain multiple facts with semicolons (one fact/decision per sentence, cut to the single most
decision-relevant sub-fact per topic); action items must open with a deliverable verb naming a
concrete outcome (Get/Send/Confirm/Update/Schedule), banning bare process verbs
(discuss/follow up/coordinate/review) with nothing attached; vague deadlines get `(TBC)` rather
than a guessed date, and vague deliverables get `(outcome: TBC)` rather than invented
specificity — same "never guess, mark unclear as unclear" principle already used in the
pre-meeting agenda's unmapped-owner "Other" bucket. Bold-marker hint narrowed to
calendar-anchored dates only, not vague urgency words. **56/56 tests pass.**

**Architecture review applied (2026-07-03)** via `/improve-codebase-architecture` (report:
`architecture-review-1783037862.html` in the OS temp dir). 3 candidates found, all applied or
otherwise addressed:
1. **Strong** — the `**bold**` marker convention was independently duplicated in
   `summarizer.js` (producer) and `notifier.js` (consumer) with no shared seam and no
   integration test; a format drift would have silently shipped literal `**text**` to Telegram
   instead of triggering the fallback. Fixed: extracted `bold-marker.js` as the one shared
   contract, both modules now depend on it, added `summarizer-notifier-integration.test.js`
   driving a real summarizer output through the real notifier.
2. **Strong** — `index.js`'s inline 4-rule routing table was untested business policy (CLAUDE.md
   itself flagged this as an open item). Fixed: extracted `routing-table.js` with an
   `assertOrderingIsSafe` invariant check, called at startup so a misordered rule fails fast
   instead of silently misrouting.
3. **ADR-blocked, process-only** — the routing table and attendee-handle table are duplicated
   between code and `routines/pre-meeting-reminder.md` prose; ADR-0001/0002 already establish
   why this can't be unified (a Cloud Routine prompt has no code path to `require()` either
   file). Added two-way "kept in sync" comments in both directions instead.
Also fixed in passing: CONTEXT.md's `FirefliesClient` interface line was stale (wrong
`fetchSummary` signature, missing `attendees`). **44/44 tests pass.**

**Meeting history + cross-meeting consolidation added (2026-07-04), see [ADR-0005](docs/adr/0005-meeting-history-and-consolidation.md).**
`webhook-service` now persists full meeting history in Supabase (`meeting_history`, append-only)
and derives per-series open-item tracking + a rolling narrative (`series_state`) via a second,
separate Anthropic call (`history-consolidator.js`), fed back into `summarizer.js`'s prompt as
read-only context for the next meeting in that series. Only applies to meetings matching a real
routing rule — unrouted/one-off meetings are unaffected. Both new env vars
(`SUPABASE_URL`/`SUPABASE_SERVICE_KEY`) are optional; unset either and the pipeline behaves
exactly as it did before this change. Manual one-time setup still needed: create the Supabase
project and run `webhook-service/supabase/schema.sql`, then set the two env vars on Render.
**79/79 tests pass.**

**Fireflies-Telegram notetaker merge (2026-07-04), see
[design spec](docs/superpowers/specs/2026-07-04-fireflies-telegram-notetaker-design.md) and
[plan](docs/superpowers/plans/2026-07-04-fireflies-telegram-notetaker.md).** Merged the
2026-07-04 "Agent Briefing" into the deployed pipeline, on top of the meeting-history work
above: `company-profiles.js`/`company-classifier.js` add content-based Bond/ERN classification
as a fallback when `routing-table.js`'s title match misses (title match stays authoritative for
both routing and company, alongside the existing `seriesKey`). `summarizer.js`'s second
parameter changed from a positional `seriesState` to a `{ seriesState, company }` context
object, and its response now includes `SECTIONS`/`NEXT_STEPS` alongside `OVERVIEW`/
`ACTION_ITEMS`, flags blockers with `⚠️`, reassigns handed-off tasks to their new owner, and
takes a per-company tone hint. `notifier.js` sends the post-meeting update as two independent
Telegram messages (Agenda/Overview, then To-Dos with a Fireflies recording link) instead of
one — a failure in either is reported to ops without blocking the other or the history-write
step that follows. `fireflies-client.js` now fetches `transcript_url`. Fixed Sowmya's handle
(`@sraghavan`, was `@sowmyaraghavan`) and added missing Bond (`@redbeem`) and ERN (`@jonscott`,
`@keliwhitlock`, `@JeradFinck`) handles. `routing-table.js` gained 3 new title patterns (`BOND
Daily Standup`, `Bond <> 0g Weekly Sync`, `ERN <> Nebula`), each with a `seriesKey` for history
tracking too. The pre-meeting routine's prompt changed from a 3-6h window with per-attendee
bullets to an 11-13h window with topic-level "On the Agenda"/"Please review before joining"
sections (prose-only change, no code). Out of scope, explicitly deferred: 30-min Fireflies
polling (the existing webhook is already real-time), Monday.com task links (no integration
exists). **113/113 tests pass.**

**Post-meeting message polish (2026-07-04), post-review of the notetaker merge above.** Two
fixes from a deep critique of the actual Telegram output:
1. **Reversed the `(TBC)`/`(outcome: TBC)` placeholders from the 2026-07-03 tightening entry
   above** — user decision: a list of action items where most entries end in `(TBC)` reads as
   uncertain/unfinished rather than as a clean task list. `summarizer.js`'s `RULES` now says to
   omit an unclear deadline/outcome entirely rather than flagging it with a placeholder; the
   "never guess" principle itself is unchanged, only the visible marker is gone.
2. **`notifier.js`'s To-Dos message no longer trusts the model to blank-line-separate each
   assignee's block** — `formatTodosBody` now deterministically splits `action_items` on each
   bare `**Name**` heading line (distinct from an inline deadline bold like `**July 15**`) and
   joins the sections with the same `---` divider used elsewhere in the message, so multiple
   assignees always render as visually distinct blocks regardless of the model's own spacing.
**114/114 tests pass.**

## Skills that speed this up

Local (already available in this Claude Code install):
- `/schedule` — creates the pre-meeting Cloud Routine directly (name, prompt, connectors,
  cron) instead of doing it by hand at claude.ai/code/routines.
- `tdd` — use while building out `webhook-service/` further (signature verification and
  dedupe logic are exactly the kind of pure-function behavior worth testing first).
- `run` / `verify` — start the webhook service locally and confirm the Fireflies flow
  actually behaves before deploying.
- `security-review` — run once before this service is exposed to real webhook traffic
  (it handles two secrets and one signature-verified public endpoint).
- `code-review` — before committing/pushing `webhook-service/`.

Third-party — security-reviewed 2026-07-01 (GitHub metadata, star/owner checks, source
inspection of actual SKILL.md/script contents, not just marketplace pages):

- ✅ **Installed**: `telegram-integration` skill (source: `imehr/skills`, MIT-style single-author
  repo) → `.claude/skills/telegram-integration/SKILL.md`. Clean Next.js webhook patterns,
  secret-token verification, env-var use, no auto-approved tool grants, no exfil endpoints.
- ✅ **Recommended, not yet installed**: Railway's official Claude Code plugin
  (`railwayapp/railway-skills`, official vendor org, 285 stars) — installs the `use-railway`
  skill plus a `PreToolUse` hook that auto-approves Railway CLI/API calls. Legitimate and
  transparent, but note it does reduce prompt-level oversight of Railway operations
  specifically. Install via `/plugin` → Discover tab → "Railway" (exact `marketplace add`
  syntax wasn't extractable from Railway's JS-rendered docs page).
- ❌ **Rejected**: "Fireflies Webhooks & Events" (mcpmarket.com → `jeremylongshore/claude-code-
  plugins-plus-skills`) — that repo is 3,642 auto-generated SKILL.md files across 425 plugins
  from a single author (a bulk skill-marketplace product), and this skill self-grants
  `Bash(curl:*)` as an auto-approved tool. No real editorial review at that scale.
- ❌ **Rejected**: "Telegram Bot Builder" (claudemarketplaces.com → `sickn33/antigravity-
  awesome-skills`) — repo is large and genuinely popular (42k GitHub stars) but its own
  frontmatter self-tags every Telegram-related skill in it `risk: critical` or `risk: unknown`.
  None are self-rated safe by the maintainers.

Our own `webhook-service/index.js` already implements Fireflies signature verification
correctly, so rejecting that skill costs nothing — it wasn't needed anyway.

## Conventions

- This project is separate from `ERN Content Creation` (marketing content engine) — do not
  mix content-engine conventions (brand voice, character limits, etc.) into this repo.
- New files get a `YYYY-MM-DD-` prefix per the user's global file-naming rule.
