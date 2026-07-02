# ERN Meeting Automation

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
- `webhook-service/` is code-complete but **not yet deployed** — no real secrets exist yet.
- CI (`.github/workflows/test.yml`, runs `npm test` on push/PR) and deploy config
  (`render.yaml`, declares the Render web service with 5 env vars marked `sync: false` so
  Render prompts for real values instead of reading them from the repo) are in place —
  neither needs secrets to exist. `webhook-service/README.md` documents run/test/deploy.
- Cloud Routine for pre-meeting reminders is **not yet created** — prompt is ready in
  `routines/pre-meeting-reminder.md`, needs to be registered via the `/schedule` skill or
  claude.ai/code/routines.
- **Pushed to GitHub**: [sowmya-ern/ern-meeting-automation](https://github.com/sowmya-ern/ern-meeting-automation)
  (private). CI ran on push and passed (19/19 tests green in GitHub Actions).

## Open items before go-live

1. Get real credentials: Telegram bot token + two chat IDs (team, ops), Fireflies API key +
   webhook secret, Google Calendar MCP connector. **Deliberately deferred to last** — the
   smoke test above proves the code works without them.
2. Push `webhook-service/` to GitHub, deploy to Render, point Fireflies' webhook settings at
   it, register the Cloud Routine.
3. Run the staging checklist in the plan doc (section 5) with a test Telegram chat before
   switching to the real team chat.

Fireflies signature verification (`x-hub-signature`, HMAC-SHA256) is confirmed correct against
their webhook docs — no longer an open item.

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
