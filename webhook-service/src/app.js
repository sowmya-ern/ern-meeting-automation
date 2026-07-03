const express = require('express');

const { verifySignature } = require('./verify-signature');
const { verifyRelayToken } = require('./verify-relay-token');
const { resolveRelayChatId } = require('./relay-chat-keys');
const { handleFirefliesWebhook } = require('./handle-webhook');

function createApp({ secret, relaySecret, firefliesClient, notifier, seenMeetings, meetingRouter, summarizer, relayChatMap, onProcessed }) {
    const app = express();
    app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

    app.post('/webhook/fireflies', async (req, res) => {
        const authentic = verifySignature({
            secret,
            signatureHeader: req.headers['x-hub-signature'],
            rawBody: req.rawBody,
        });
        if (!authentic) return res.status(401).send('Unauthorized');

        res.status(200).send('Processing'); // Acknowledge webhook immediately

        // Fireflies Webhooks V2 sends { event, meeting_id, timestamp } — translate to our
        // internal { eventType, meetingId } vocabulary here, at the transport boundary, so
        // handle-webhook.js stays agnostic to Fireflies' wire format.
        const { event, meeting_id: meetingId } = req.body ?? {};
        const result = await handleFirefliesWebhook({ eventType: event, meetingId }, { firefliesClient, notifier, seenMeetings, meetingRouter, summarizer });
        if (onProcessed) onProcessed(result);
    });

    // Relay for the pre-meeting Cloud Routine (ADR-0004): the routine holds only relaySecret
    // and a symbolic chatKey, never the real Telegram bot token or a real chat_id.
    app.post('/relay/telegram-agenda', async (req, res) => {
        const authentic = verifyRelayToken({ secret: relaySecret, authHeader: req.headers['authorization'] });
        if (!authentic) return res.status(401).send('Unauthorized');

        const { chatKey, text } = req.body ?? {};
        const chatId = resolveRelayChatId(relayChatMap, chatKey);
        if (!chatId || !text) return res.status(400).send('chatKey must be a known key and text must be present');

        await notifier.sendPlainText(chatId, text);
        res.status(200).send('OK');
    });

    return app;
}

module.exports = { createApp };
