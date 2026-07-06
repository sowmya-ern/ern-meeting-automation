const { createApp } = require('./src/app');
const { createFirefliesClient } = require('./src/fireflies-client');
const { createNotifier } = require('./src/notifier');
const { createSeenMeetings } = require('./src/seen-meetings');
const { createMeetingRouter } = require('./src/meeting-router');
const { createSummarizer } = require('./src/summarizer');
const { createMeetingHistory } = require('./src/meeting-history');
const { createHistoryConsolidator } = require('./src/history-consolidator');
const { createCompanyClassifier } = require('./src/company-classifier');
const { buildRoutingRules, assertOrderingIsSafe } = require('./src/routing-table');
const { buildRelayChatMap } = require('./src/relay-chat-keys');

const routingRules = buildRoutingRules(process.env);
assertOrderingIsSafe(routingRules); // fail fast at startup rather than silently misroute
const meetingRouter = createMeetingRouter(routingRules);
const relayChatMap = buildRelayChatMap(process.env);

// Validate that every chat ID referenced by the routing table and relay map is actually set.
// Any missing value is logged as a clear warning at startup so operators know exactly which
// Render env var to add — instead of getting a cryptic 400 "chat not found" at send time.
const REQUIRED_CHAT_ENV_VARS = [
    'TELEGRAM_CHAT_BOND_NEBULA',
    'TELEGRAM_CHAT_BOND_TEAM',
    'TELEGRAM_CHAT_ERN_EXEC_STANDUP',
    'TELEGRAM_CHAT_ERN_NEBULA',
    'TELEGRAM_CHAT_ERN_SUPER_TEAM',
    'TELEGRAM_OPS_CHAT_ID',
];
const missingChatVars = REQUIRED_CHAT_ENV_VARS.filter(v => !process.env[v]);
if (missingChatVars.length > 0) {
    console.warn(
        `[STARTUP WARNING] The following Telegram chat ID env vars are NOT set.\n` +
        `Meetings routed to these chats will fail with "chat not found" until they are added in Render:\n` +
        missingChatVars.map(v => `  - ${v}`).join('\n')
    );
}

// Optional: if unset, handle-webhook.js's fallback logic sends the raw Fireflies summary
// unchanged — the same "no lost summaries" path as any other summarizer failure.
const summarizer = process.env.ANTHROPIC_API_KEY
    ? createSummarizer({ apiKey: process.env.ANTHROPIC_API_KEY })
    : undefined;

// Optional: if either Supabase var is unset, history tracking is skipped entirely and the
// pipeline behaves exactly as it does today -- same optionality pattern as ANTHROPIC_API_KEY.
const meetingHistory = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
    ? createMeetingHistory({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_KEY })
    : undefined;

// Consolidation needs both a history store to write to and the same Anthropic key the
// summarizer already uses -- no separate key required.
const historyConsolidator = (meetingHistory && process.env.ANTHROPIC_API_KEY)
    ? createHistoryConsolidator({ apiKey: process.env.ANTHROPIC_API_KEY })
    : undefined;

// Pure content-based fallback, no config needed -- always available, only ever consulted when
// meetingRouter.resolveCompany(title) returns null (see handle-webhook.js's resolveCompany).
const companyClassifier = createCompanyClassifier();

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
    companyClassifier,
    meetingHistory,
    historyConsolidator,
    onProcessed: (result) => {
        if (result.status === 'failed' || result.status === 'unrouted') {
            console.error('Fireflies webhook processing needs attention:', result);
        }
    },
});

app.listen(process.env.PORT || 3000, () => console.log('Webhook service running'));
