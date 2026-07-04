const test = require('node:test');
const assert = require('node:assert/strict');
const { createSummarizer } = require('../src/summarizer');
const { createNotifier } = require('../src/notifier');

// Drives a real summarizer.simplify() output through the real notifier.notifySummaryTo()
// formatting — the one seam Candidate 1 of the 2026-07-03 architecture review found untested:
// summarizer.js and notifier.js independently "know" the **bold** marker convention, and
// nothing previously proved they actually agree end-to-end.
test('a real summarizer output renders correctly through the real notifier, bold markers included', async () => {
  const fakeAnthropicPost = async () => ({
    data: {
      content: [{
        type: 'text',
        text: 'OVERVIEW:\nOne sentence.\n\nSECTIONS:\nEMOJI: 🛠\nHEADER: Engineering\nBULLETS:\n- Shipped the API\n\nACTION_ITEMS:\n**Vinson Leow**\nReview the **July 15** deadline.\n\nNEXT_STEPS:\n- None noted this cycle.',
      }],
    },
  });
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost: fakeAnthropicPost });

  const telegramCalls = [];
  const fakeTelegramPost = async (url, body) => { telegramCalls.push(body); };
  const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost: fakeTelegramPost });

  const raw = { title: 'Meet', attendees: ['Vinson Leow'], overview: 'long overview...', action_items: 'long items...' };
  const { overview, action_items } = await summarizer.simplify(raw);
  await notifier.notifySummaryTo('chat-1', { ...raw, overview, action_items });

  const { text } = telegramCalls[0];
  assert.match(text, /Review the <b>July 15<\/b> deadline\./);
  assert.doesNotMatch(text, /\*\*/, 'no literal ** markers should ever reach Telegram');
});
