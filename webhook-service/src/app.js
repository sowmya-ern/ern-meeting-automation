const express = require('express');

const { verifySignature } = require('./verify-signature');
const { handleFirefliesWebhook } = require('./handle-webhook');

function createApp({ secret, firefliesClient, notifier, seenMeetings, onProcessed }) {
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

        const result = await handleFirefliesWebhook(req.body, { firefliesClient, notifier, seenMeetings });
        if (onProcessed) onProcessed(result);
    });

    return app;
}

module.exports = { createApp };
