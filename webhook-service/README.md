# ern-fireflies-webhook

Receives Fireflies AI "Transcription completed" webhooks, fetches the summary, and posts it to
Telegram. See [../docs/2026-07-01-SPEC.md](../docs/2026-07-01-SPEC.md) for the module design.

## Run the tests (no credentials needed)

```
npm install
npm test
```

19 tests: 16 unit tests across `src/*.js`, plus 3 end-to-end smoke tests in `test/app.test.js`
that drive the real Express app over real HTTP with a fake secret and fake Fireflies/Telegram
adapters. This is the "one test version" — proves the whole webhook path works with zero real
credentials.

## Run it for real

1. Copy `.env.example` to `.env` and fill in real values:
   - `FIREFLIES_SECRET`, `FIREFLIES_API_KEY` — from Fireflies' Developer Settings.
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — from @BotFather + the target chat.
   - `TELEGRAM_OPS_CHAT_ID` — optional, defaults to `TELEGRAM_CHAT_ID` if unset.
2. `npm start`
3. Point Fireflies' webhook URL at `<your-host>/webhook/fireflies`.

## Deploy

`render.yaml` at the project root declares this as a Render web service (free tier) with the
five env vars marked `sync: false` — Render will prompt for their real values in its dashboard
rather than reading them from this repo. Push to GitHub, connect the repo in Render, and it
picks up `render.yaml` automatically.
