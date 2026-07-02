const { createApp } = require('./src/app');
const { createFirefliesClient } = require('./src/fireflies-client');
const { createNotifier } = require('./src/notifier');
const { createSeenMeetings } = require('./src/seen-meetings');

const app = createApp({
    secret: process.env.FIREFLIES_SECRET,
    firefliesClient: createFirefliesClient({ apiKey: process.env.FIREFLIES_API_KEY }),
    notifier: createNotifier({
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
        opsChatId: process.env.TELEGRAM_OPS_CHAT_ID || process.env.TELEGRAM_CHAT_ID,
    }),
    seenMeetings: createSeenMeetings(),
    onProcessed: (result) => {
        if (result.status === 'failed') console.error('Fireflies webhook processing failed:', result);
    },
});

app.listen(process.env.PORT || 3000, () => console.log('Webhook service running'));
