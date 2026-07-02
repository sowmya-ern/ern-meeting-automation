const { createApp } = require('./src/app');
const { createFirefliesClient } = require('./src/fireflies-client');
const { createNotifier } = require('./src/notifier');
const { createSeenMeetings } = require('./src/seen-meetings');
const { createMeetingRouter } = require('./src/meeting-router');

// Ordered most-specific-first — 'Bond <> Nebula' must precede 'Bond'.
const meetingRouter = createMeetingRouter([
    { match: 'Bond <> Nebula', chatId: process.env.TELEGRAM_CHAT_BOND_NEBULA },
    { match: 'Bond', chatId: process.env.TELEGRAM_CHAT_BOND_TEAM },
    { match: 'ERN Daily Executive Standup', chatId: process.env.TELEGRAM_CHAT_ERN_EXEC_STANDUP },
    { match: 'ERN Daily Sync', chatId: process.env.TELEGRAM_CHAT_ERN_SUPER_TEAM },
]);

const app = createApp({
    secret: process.env.FIREFLIES_SECRET,
    firefliesClient: createFirefliesClient({ apiKey: process.env.FIREFLIES_API_KEY }),
    notifier: createNotifier({
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        opsChatId: process.env.TELEGRAM_OPS_CHAT_ID,
    }),
    seenMeetings: createSeenMeetings(),
    meetingRouter,
    onProcessed: (result) => {
        if (result.status === 'failed' || result.status === 'unrouted') {
            console.error('Fireflies webhook processing needs attention:', result);
        }
    },
});

app.listen(process.env.PORT || 3000, () => console.log('Webhook service running'));
