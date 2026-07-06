const express = require('express');

const { verifySignature } = require('./verify-signature');
const { verifyRelayToken } = require('./verify-relay-token');
const { resolveRelayChatId } = require('./relay-chat-keys');
const { handleFirefliesWebhook } = require('./handle-webhook');

function createApp({ secret, relaySecret, firefliesClient, notifier, seenMeetings, meetingRouter, summarizer, companyClassifier, meetingHistory, historyConsolidator, relayChatMap, onProcessed, voiceMemoHandler }) {
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
        const result = await handleFirefliesWebhook(
            { eventType: event, meetingId },
            { firefliesClient, notifier, seenMeetings, meetingRouter, summarizer, companyClassifier, meetingHistory, historyConsolidator }
        );
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

    // New relay endpoint that generates the per-person reminder from meeting history
    app.post('/relay/telegram-agenda-generate', async (req, res) => {
        const authentic = verifyRelayToken({ secret: relaySecret, authHeader: req.headers['authorization'] });
        if (!authentic) return res.status(401).send('Unauthorized');

        const { chatKey, title, description, attendees } = req.body ?? {};
        const chatId = resolveRelayChatId(relayChatMap, chatKey);
        if (!chatId || !title) return res.status(400).send('chatKey and title must be present');

        try {
            // 1. Resolve seriesKey from title
            const route = meetingRouter.routeMeeting(title);
            const seriesKey = route ? route.seriesKey : title;

            // 2. Fetch history
            let seriesState = null;
            try {
                seriesState = await meetingHistory.getSeriesState(seriesKey);
            } catch (err) {
                console.error(`Failed to fetch history for pre-meeting reminder (${seriesKey}):`, err.message);
            }

            // 3. Generate reminder text using summarizer
            const text = await summarizer.generatePreMeetingReminder({
                title,
                description: description || '',
                attendees: attendees || [],
                seriesState
            });

            // 4. Send
            await notifier.sendPlainText(chatId, text);
            res.status(200).send('OK');
        } catch (err) {
            console.error('Failed to generate/send pre-meeting reminder:', err);
            res.status(500).send('Internal Server Error');
        }
    });

    // Feature 12: Telegram bot webhook — receives all updates sent to the bot.
    // Currently handles voice memos only; other update types are silently ignored.
    // Set the webhook URL in Telegram via:
    //   POST https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://{host}/telegram-bot
    app.post('/telegram-bot', async (req, res) => {
        res.status(200).send('OK'); // Always 200 immediately — Telegram retries on non-200
        if (!voiceMemoHandler) return;
        const update = req.body ?? {};
        // Resolve seriesKey from the chat title or description if available
        const chatTitle = update?.message?.chat?.title ?? '';
        const route = meetingRouter.routeMeeting(chatTitle);
        const seriesKey = route ? route.seriesKey : null;
        await voiceMemoHandler.handleUpdate(update, { meetingHistory, seriesKey }).catch(() => {});
    });

    return app;
}

module.exports = { createApp };
