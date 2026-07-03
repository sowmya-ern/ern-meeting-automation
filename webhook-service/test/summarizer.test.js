const test = require('node:test');
const assert = require('node:assert/strict');
const { createSummarizer } = require('../src/summarizer');

test('simplify() sends the raw summary to the Anthropic Messages API and parses the condensed sections back out', async () => {
  const calls = [];
  const httpPost = async (url, body, config) => {
    calls.push({ url, body, config });
    return {
      data: {
        content: [{
          type: 'text',
          text: 'OVERVIEW:\nOne condensed sentence.\n\nACTION_ITEMS:\n**Vinson Leow**\nReview the **July 15** deadline.',
        }],
      },
    };
  };

  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });
  const raw = { title: 'Meet', attendees: ['Vinson Leow'], overview: 'long overview...', action_items: 'long action items...' };

  const result = await summarizer.simplify(raw);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].config.headers['x-api-key'], 'test-key');
  assert.equal(calls[0].config.headers['anthropic-version'], '2023-06-01');
  assert.match(calls[0].body.messages[0].content, /long overview\.\.\./);
  assert.match(calls[0].body.messages[0].content, /long action items\.\.\./);

  assert.equal(result.overview, 'One condensed sentence.');
  assert.equal(result.action_items, '**Vinson Leow**\nReview the **July 15** deadline.');
});

test('simplify() rejects when the API call fails, so the caller can fall back to the raw summary', async () => {
  const httpPost = async () => { throw new Error('network down'); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await assert.rejects(
    () => summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' }),
    /network down/
  );
});

test('simplify() rejects when the response text is missing the expected OVERVIEW/ACTION_ITEMS markers', async () => {
  const httpPost = async () => ({ data: { content: [{ type: 'text', text: 'not the expected format' }] } });
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await assert.rejects(() => summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' }));
});

test('simplify() sends a prompt banning semicolon-chained overview sentences, bare process verbs, and requiring TBC over guessed specificity', async () => {
  const calls = [];
  const httpPost = async (url, body) => {
    calls.push({ url, body });
    return { data: { content: [{ type: 'text', text: 'OVERVIEW:\nOne.\n\nACTION_ITEMS:\n**Name**\nGet the doc.' }] } };
  };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' });

  const prompt = calls[0].body.messages[0].content;
  assert.match(prompt, /never chain multiple facts into one sentence with semicolons/);
  assert.match(prompt, /never a bare process verb alone \(discuss\/follow up\/coordinate\/review\)/);
  assert.match(prompt, /append "\(TBC\)"/);
  assert.match(prompt, /append "\(outcome: TBC\)"/);
});
