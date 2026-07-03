const { createApp } = require('./src/app');
const { createFirefliesClient } = require('./src/fireflies-client');
const { createNotifier } = require('./src/notifier');
const { createSeenMeetings } = require('./src/seen-meetings');
const { createMeetingRouter } = require('./src/meeting-router');
const { createSummarizer } = require('./src/summarizer');
const { buildRoutingRules, assertOrderingIsSafe } = require('./src/routing-table');
const { buildRelayChatMap } = require('./src/relay-chat-keys');

const routingRules = buildRoutingRules(process.env);
assertOrderingIsSafe(routingRules); // fail fast at startup rather than silently misroute
const meetingRouter = createMeetingRouter(routingRules);
const relayChatMap = buildRelayChatMap(process.env);

// Optional: if unset, handle-webhook.js's fallback logic sends the raw Fireflies summary
// unchanged — the same "no lost summaries" path as any other summarizer failure.
const summarizer = process.env.ANTHROPIC_API_KEY
    ? createSummarizer({ apiKey: process.env.ANTHROPIC_API_KEY })
    : undefined;

const app = createApp({
    secret: process.env.FIREFLIES_SECRET,
    relaySecret: process.env.RELAY_SECRET,
    firefliesClient: createFirefliesClient({ apiKey: process.env.FIREFLIES_API_KEY }),
    notifier: createNotifier({
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        opsChatId: process.env.TELEGRAM_OPS_CHAT_ID,
        // Meetings with no routing match go to ERN Super Team (visible to the whole team),
        // not the private ops DM — opsChatId stays reserved for genuine processing failures.
        unroutedChatId: process.env.TELEGRAM_CHAT_ERN_SUPER_TEAM,
    }),
    seenMeetings: createSeenMeetings(),
    meetingRouter,
    relayChatMap,
    summarizer,
    onProcessed: (result) => {
        if (result.status === 'failed' || result.status === 'unrouted') {
            console.error('Fireflies webhook processing needs attention:', result);
        }
    },
});

app.listen(process.env.PORT || 3000, () => console.log('Webhook service running'));
