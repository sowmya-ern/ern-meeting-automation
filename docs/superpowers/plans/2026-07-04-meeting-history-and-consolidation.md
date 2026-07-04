# Meeting History + Cross-Meeting Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `webhook-service` persistent, automatic memory across meetings in the same recurring series, so a Telegram summary can recognize a recurring action item and a rolling per-series narrative, instead of treating every meeting as isolated.

**Architecture:** Two new Supabase Postgres tables (`meeting_history` append-only log, `series_state` upserted per-series open-items+narrative) accessed via a thin `axios`-based REST client module. A second, separate Anthropic API call (`history-consolidator.js`) derives updated open-items/narrative after each processed meeting. Both are wired into the existing `handle-webhook.js` flow as additive, best-effort steps — failures never block the Telegram send or affect any existing behavior.

**Tech Stack:** Node.js (`node --test`), `axios` (already a dependency, no new packages), Supabase Postgres REST API (PostgREST), Anthropic Messages API.

## Global Constraints

- All 57 existing tests in `webhook-service/` (run via `cd webhook-service && npm test`) must keep passing after every task — this work is additive only.
- Every new module follows the existing injectable-`httpPost`/`httpGet` convention (see `fireflies-client.js`, `notifier.js`, `summarizer.js`) so it's fakeable in tests with zero live network calls.
- History tracking (Supabase reads/writes, consolidation) only applies when a meeting matches a real routing rule (has a `seriesKey`) — unrouted/one-off meetings must behave identically to today, verified by tests.
- Both new env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) are optional — if either is unset, or `ANTHROPIC_API_KEY` is unset, history tracking is skipped entirely and the pipeline behaves exactly as it does today.
- A failure in the history/consolidation path must never call `notifier.notifyOpsFailure` and must never prevent `notifier.notifySummaryTo` from having already been called — mirrors the existing summarizer fallback precedent (ADR-0003).
- Reuse `routing-table.js`'s existing rule table for series classification — do not create a second, independent series-classification table.
- Parse Anthropic responses by finding the content block where `type === 'text'`, never by assuming `content[0]` — a live e2e test this session found that this model prepends an extended-thinking block before the text block (already fixed in `summarizer.js`; the new `history-consolidator.js` must use the same fix from the start).

---

### Task 1: Supabase schema + `meeting-history.js` client module

**Files:**
- Create: `webhook-service/supabase/schema.sql`
- Create: `webhook-service/src/meeting-history.js`
- Test: `webhook-service/test/meeting-history.test.js`

**Interfaces:**
- Produces: `createMeetingHistory({ url, serviceKey, httpGet, httpPost }) => { getSeriesState(seriesKey): Promise<{open_items: Array, narrative: string} | null>, appendHistory(row: object): Promise<void>, upsertSeriesState(seriesKey: string, { open_items: Array, narrative: string, lastMeetingId: string }): Promise<void> }`. `httpGet`/`httpPost` default to real `axios` calls but are injectable for tests, matching `fireflies-client.js`'s `httpPost` convention.

- [ ] **Step 1: Write the schema file**

Create `webhook-service/supabase/schema.sql`:

```sql
-- Run once against a new Supabase project (SQL Editor -> New Query -> paste -> Run).
-- See docs/2026-07-04-meeting-history-design.md and docs/adr/0005-meeting-history-and-consolidation.md.

create table meeting_history (
  id uuid primary key default gen_random_uuid(),
  series_key text not null,
  meeting_id text not null unique,
  meeting_date timestamptz not null default now(),
  title text,
  attendees text[],
  raw_overview text,
  raw_action_items text,
  condensed_overview text,
  condensed_action_items text,
  created_at timestamptz not null default now()
);

create table series_state (
  series_key text primary key,
  open_items jsonb not null default '[]'::jsonb,
  narrative text not null default '',
  last_meeting_id text,
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 2: Write the failing tests**

Create `webhook-service/test/meeting-history.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMeetingHistory } = require('../src/meeting-history');

const URL = 'https://example.supabase.co';
const SERVICE_KEY = 'test-service-key';

test('getSeriesState returns null when Supabase has no row for this series yet', async () => {
  const httpGet = async () => ({ data: [] });
  const history = createMeetingHistory({ url: URL, serviceKey: SERVICE_KEY, httpGet });

  const result = await history.getSeriesState('BOND_TEAM');
  assert.equal(result, null);
});

test('getSeriesState returns open_items and narrative when a row exists', async () => {
  const calls = [];
  const httpGet = async (url, config) => {
    calls.push({ url, config });
    return { data: [{ open_items: [{ text: 'Ship X', assignee: 'A', status: 'open' }], narrative: 'ongoing work on X' }] };
  };
  const history = createMeetingHistory({ url: URL, serviceKey: SERVICE_KEY, httpGet });

  const result = await history.getSeriesState('BOND_TEAM');

  assert.deepEqual(result, { open_items: [{ text: 'Ship X', assignee: 'A', status: 'open' }], narrative: 'ongoing work on X' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /series_state\?series_key=eq\.BOND_TEAM/);
  assert.equal(calls[0].config.headers.apikey, SERVICE_KEY);
  assert.equal(calls[0].config.headers.Authorization, `Bearer ${SERVICE_KEY}`);
});

test('getSeriesState defaults open_items/narrative when the row has null columns', async () => {
  const httpGet = async () => ({ data: [{ open_items: null, narrative: null }] });
  const history = createMeetingHistory({ url: URL, serviceKey: SERVICE_KEY, httpGet });

  const result = await history.getSeriesState('BOND_TEAM');
  assert.deepEqual(result, { open_items: [], narrative: '' });
});

test('appendHistory posts the row to meeting_history with auth headers', async () => {
  const calls = [];
  const httpPost = async (url, body, config) => { calls.push({ url, body, config }); };
  const history = createMeetingHistory({ url: URL, serviceKey: SERVICE_KEY, httpPost });

  const row = { series_key: 'BOND_TEAM', meeting_id: 'm1', title: 'Bond Daily' };
  await history.appendHistory(row);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${URL}/rest/v1/meeting_history`);
  assert.deepEqual(calls[0].body, row);
  assert.equal(calls[0].config.headers.apikey, SERVICE_KEY);
});

test('upsertSeriesState posts to series_state with the merge-duplicates Prefer header', async () => {
  const calls = [];
  const httpPost = async (url, body, config) => { calls.push({ url, body, config }); };
  const history = createMeetingHistory({ url: URL, serviceKey: SERVICE_KEY, httpPost });

  await history.upsertSeriesState('BOND_TEAM', { open_items: [{ text: 'x', status: 'open' }], narrative: 'n', lastMeetingId: 'm2' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${URL}/rest/v1/series_state`);
  assert.deepEqual(calls[0].body, {
    series_key: 'BOND_TEAM',
    open_items: [{ text: 'x', status: 'open' }],
    narrative: 'n',
    last_meeting_id: 'm2',
  });
  assert.equal(calls[0].config.headers.Prefer, 'resolution=merge-duplicates');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd webhook-service && node --test test/meeting-history.test.js`
Expected: FAIL with `Cannot find module '../src/meeting-history'`

- [ ] **Step 4: Write the implementation**

Create `webhook-service/src/meeting-history.js`:

```js
const axios = require('axios');

function defaultHttpGet(url, config) {
  return axios.get(url, config);
}

function defaultHttpPost(url, body, config) {
  return axios.post(url, body, config);
}

function createMeetingHistory({ url, serviceKey, httpGet = defaultHttpGet, httpPost = defaultHttpPost }) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  async function getSeriesState(seriesKey) {
    const response = await httpGet(
      `${url}/rest/v1/series_state?series_key=eq.${encodeURIComponent(seriesKey)}&select=open_items,narrative`,
      { headers }
    );
    const row = response?.data?.[0];
    if (!row) return null;
    return { open_items: row.open_items ?? [], narrative: row.narrative ?? '' };
  }

  async function appendHistory(row) {
    await httpPost(`${url}/rest/v1/meeting_history`, row, { headers });
  }

  async function upsertSeriesState(seriesKey, { open_items, narrative, lastMeetingId }) {
    await httpPost(
      `${url}/rest/v1/series_state`,
      { series_key: seriesKey, open_items, narrative, last_meeting_id: lastMeetingId },
      { headers: { ...headers, Prefer: 'resolution=merge-duplicates' } }
    );
  }

  return { getSeriesState, appendHistory, upsertSeriesState };
}

module.exports = { createMeetingHistory };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webhook-service && node --test test/meeting-history.test.js`
Expected: PASS, 5 tests

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `cd webhook-service && npm test`
Expected: PASS, 62 tests (57 existing + 5 new)

- [ ] **Step 7: Commit**

```bash
cd "/Users/sraghavan/Documents/Claude/Projects/ERN Meeting Automation"
git add webhook-service/supabase/schema.sql webhook-service/src/meeting-history.js webhook-service/test/meeting-history.test.js
git commit -m "Add Supabase schema + meeting-history.js REST client module"
```

---

### Task 2: `history-consolidator.js` module

**Files:**
- Create: `webhook-service/src/history-consolidator.js`
- Test: `webhook-service/test/history-consolidator.test.js`

**Interfaces:**
- Consumes: nothing from other new tasks — this module is independent of Task 1 and Task 3.
- Produces: `createHistoryConsolidator({ apiKey, model, maxTokens, httpPost }) => { consolidate({ seriesState: {open_items, narrative} | null, meeting: {title, attendees, overview, action_items} }): Promise<{open_items: Array, narrative: string}> }`. Task 4 depends on this exact `consolidate({ seriesState, meeting })` signature and return shape.

- [ ] **Step 1: Write the failing tests**

Create `webhook-service/test/history-consolidator.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistoryConsolidator } = require('../src/history-consolidator');

function textResponse(text) {
  return { data: { content: [{ type: 'text', text }] } };
}

test('consolidate() sends prior state + this meeting to the Anthropic API and parses updated state back out', async () => {
  const calls = [];
  const httpPost = async (url, body, config) => {
    calls.push({ url, body, config });
    return textResponse('OPEN_ITEMS:\n[{"text":"Ship X","assignee":"A","status":"open","first_seen":"2026-06-20"}]\n\nNARRATIVE:\nX is still in progress.');
  };
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost });

  const seriesState = { open_items: [], narrative: '' };
  const meeting = { title: 'Bond Daily', attendees: ['A'], overview: 'raw overview', action_items: 'raw items' };
  const result = await consolidator.consolidate({ seriesState, meeting });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].config.headers['x-api-key'], 'test-key');
  assert.match(calls[0].body.messages[0].content, /raw overview/);
  assert.match(calls[0].body.messages[0].content, /raw items/);

  assert.deepEqual(result.open_items, [{ text: 'Ship X', assignee: 'A', status: 'open', first_seen: '2026-06-20' }]);
  assert.equal(result.narrative, 'X is still in progress.');
});

test('consolidate() includes prior open items and narrative in the prompt when seriesState is populated', async () => {
  const calls = [];
  const httpPost = async (url, body) => {
    calls.push({ body });
    return textResponse('OPEN_ITEMS:\n[]\n\nNARRATIVE:\nUpdated.');
  };
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost });

  const seriesState = { open_items: [{ text: 'Old item', assignee: 'B', status: 'open' }], narrative: 'Prior narrative text.' };
  const meeting = { title: 'Bond Daily', attendees: ['B'], overview: 'ov', action_items: 'ai' };
  await consolidator.consolidate({ seriesState, meeting });

  assert.match(calls[0].body.messages[0].content, /Old item/);
  assert.match(calls[0].body.messages[0].content, /Prior narrative text\./);
});

test('consolidate() handles a null seriesState (first tracked meeting for a series) without throwing', async () => {
  const httpPost = async () => textResponse('OPEN_ITEMS:\n[]\n\nNARRATIVE:\nFirst meeting tracked.');
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost });

  const result = await consolidator.consolidate({ seriesState: null, meeting: { title: 'Bond Daily', overview: 'ov', action_items: 'ai' } });
  assert.deepEqual(result.open_items, []);
  assert.equal(result.narrative, 'First meeting tracked.');
});

test('consolidate() finds the text block even when a "thinking" block precedes it in content[]', async () => {
  const httpPost = async () => ({
    data: {
      content: [
        { type: 'thinking', thinking: '', signature: 'abc' },
        { type: 'text', text: 'OPEN_ITEMS:\n[]\n\nNARRATIVE:\nOk.' },
      ],
    },
  });
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost });

  const result = await consolidator.consolidate({ seriesState: null, meeting: { title: 'T', overview: 'ov', action_items: 'ai' } });
  assert.equal(result.narrative, 'Ok.');
});

test('consolidate() rejects when the response is missing the expected OPEN_ITEMS/NARRATIVE markers', async () => {
  const httpPost = async () => textResponse('not the expected format');
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost });

  await assert.rejects(() => consolidator.consolidate({ seriesState: null, meeting: { title: 'T', overview: 'ov', action_items: 'ai' } }));
});

test('consolidate() rejects when OPEN_ITEMS is not valid JSON', async () => {
  const httpPost = async () => textResponse('OPEN_ITEMS:\nnot json\n\nNARRATIVE:\nOk.');
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost });

  await assert.rejects(() => consolidator.consolidate({ seriesState: null, meeting: { title: 'T', overview: 'ov', action_items: 'ai' } }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webhook-service && node --test test/history-consolidator.test.js`
Expected: FAIL with `Cannot find module '../src/history-consolidator'`

- [ ] **Step 3: Write the implementation**

Create `webhook-service/src/history-consolidator.js`:

```js
const axios = require('axios');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const RULES = `You maintain a running tracker of open action items and a short narrative for a recurring meeting series. Respond with EXACTLY this format and nothing else:

OPEN_ITEMS:
<a JSON array of objects, each { "text": string, "assignee": string, "status": "open" or "closed", "first_seen": string, "closed_reason": string (only when status is "closed") }. Carry forward every item from Prior Open Items unchanged unless this meeting's content clearly shows it was addressed -- only then set status to "closed" and add closed_reason describing what happened. Never guess a closure -- if unsure whether an item was resolved, leave it "open". Add a new item only when this meeting's raw content clearly introduces a new, distinct task -- merge a new mention into an existing open item instead of duplicating it when they're clearly the same task resurfacing.>

NARRATIVE:
<no more than 3 sentences describing the series' ongoing themes/decisions across meetings so far; each sentence states exactly one fact/decision/status, never chained with semicolons; update it to reflect this meeting, don't just repeat the prior narrative unchanged>`;

function buildPrompt({ seriesState, meeting }) {
  const priorItems = JSON.stringify(seriesState?.open_items ?? [], null, 2);
  const priorNarrative = seriesState?.narrative || '(none yet -- this is the first tracked meeting for this series)';

  return `${RULES}

Prior Open Items:
${priorItems}

Prior Narrative:
${priorNarrative}

This Meeting: ${meeting.title}
Attendees: ${(meeting.attendees ?? []).join(', ')}

Overview:
${meeting.overview}

Action Items:
${meeting.action_items}`;
}

function parseResponse(text) {
  const match = text.match(/OPEN_ITEMS:\s*([\s\S]*?)\s*NARRATIVE:\s*([\s\S]*)/);
  if (!match) {
    throw new Error('history-consolidator response did not contain the expected OPEN_ITEMS:/NARRATIVE: sections');
  }
  const open_items = JSON.parse(match[1].trim());
  const narrative = match[2].trim();
  return { open_items, narrative };
}

function defaultHttpPost(url, body, config) {
  return axios.post(url, body, config);
}

function createHistoryConsolidator({ apiKey, model = 'claude-sonnet-5', maxTokens = 1024, httpPost = defaultHttpPost }) {
  async function consolidate({ seriesState, meeting }) {
    const response = await httpPost(
      ANTHROPIC_URL,
      { model, max_tokens: maxTokens, messages: [{ role: 'user', content: buildPrompt({ seriesState, meeting }) }] },
      { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
    );

    // Don't assume content[0] is the text block -- extended-thinking-capable models prepend a
    // "thinking" block before the actual "text" block (found via a live e2e test in summarizer.js).
    const text = response?.data?.content?.find((block) => block.type === 'text')?.text;
    if (!text) {
      throw new Error('history-consolidator response had no text content');
    }
    return parseResponse(text);
  }

  return { consolidate };
}

module.exports = { createHistoryConsolidator };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webhook-service && node --test test/history-consolidator.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `cd webhook-service && npm test`
Expected: PASS, 68 tests (62 from Task 1 + 6 new)

- [ ] **Step 6: Commit**

```bash
cd "/Users/sraghavan/Documents/Claude/Projects/ERN Meeting Automation"
git add webhook-service/src/history-consolidator.js webhook-service/test/history-consolidator.test.js
git commit -m "Add history-consolidator.js: derives open items + narrative via a second Anthropic call"
```

---

### Task 3: `routing-table.js` seriesKey + `meeting-router.js` resolveSeriesKey + `summarizer.js` prompt context

**Files:**
- Modify: `webhook-service/src/routing-table.js`
- Modify: `webhook-service/test/routing-table.test.js`
- Modify: `webhook-service/src/meeting-router.js`
- Modify: `webhook-service/test/meeting-router.test.js`
- Modify: `webhook-service/src/summarizer.js`
- Modify: `webhook-service/test/summarizer.test.js`

**Interfaces:**
- Consumes: nothing from Task 1 or Task 2 — independent.
- Produces: `buildRoutingRules(env)` rows now include a `seriesKey` field (`{ match, chatId, seriesKey }`). `createMeetingRouter(rules).resolveSeriesKey(title): string | null` (mirrors existing `resolveChatId`). `createSummarizer(...).simplify(summary, seriesState)` — `seriesState` is a new **optional** second parameter (`{open_items, narrative} | null | undefined`); omitting it behaves exactly as before. Task 4 depends on `resolveSeriesKey` and `simplify`'s new optional second parameter.

- [ ] **Step 1: Update `routing-table.js`'s test first (TDD — write the new expectation before the code)**

Replace the full contents of `webhook-service/test/routing-table.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRoutingRules, assertOrderingIsSafe } = require('../src/routing-table');

test('buildRoutingRules reads each chat ID from the given env object, most-specific-first, each tagged with a seriesKey', () => {
  const env = {
    TELEGRAM_CHAT_BOND_NEBULA: 'nebula-chat',
    TELEGRAM_CHAT_BOND_TEAM: 'bond-chat',
    TELEGRAM_CHAT_ERN_EXEC_STANDUP: 'exec-chat',
    TELEGRAM_CHAT_ERN_SUPER_TEAM: 'super-chat',
  };
  const rules = buildRoutingRules(env);
  assert.deepEqual(rules, [
    { match: 'Bond <> Nebula', chatId: 'nebula-chat', seriesKey: 'BOND_NEBULA' },
    { match: 'Bond', chatId: 'bond-chat', seriesKey: 'BOND_TEAM' },
    { match: 'ERN Daily Executive Standup', chatId: 'exec-chat', seriesKey: 'ERN_EXEC_STANDUP' },
    { match: 'ERN Daily Sync', chatId: 'super-chat', seriesKey: 'ERN_SUPER_TEAM' },
  ]);
});

test('assertOrderingIsSafe does not throw for the real production rule table', () => {
  const rules = buildRoutingRules({
    TELEGRAM_CHAT_BOND_NEBULA: 'a', TELEGRAM_CHAT_BOND_TEAM: 'b',
    TELEGRAM_CHAT_ERN_EXEC_STANDUP: 'c', TELEGRAM_CHAT_ERN_SUPER_TEAM: 'd',
  });
  assert.doesNotThrow(() => assertOrderingIsSafe(rules));
});

test('assertOrderingIsSafe throws when a looser rule is checked before the more specific rule it would swallow', () => {
  const broken = [
    { match: 'Bond', chatId: 'bond-chat', seriesKey: 'BOND_TEAM' },
    { match: 'Bond <> Nebula', chatId: 'nebula-chat', seriesKey: 'BOND_NEBULA' },
  ];
  assert.throws(() => assertOrderingIsSafe(broken), /"Bond".*"Bond <> Nebula"/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd webhook-service && node --test test/routing-table.test.js`
Expected: FAIL — first test's `assert.deepEqual` fails because current rules have no `seriesKey` field

- [ ] **Step 3: Update `routing-table.js`**

Replace the `buildRoutingRules` function in `webhook-service/src/routing-table.js` (keep the file's existing top comment and `assertOrderingIsSafe` function unchanged):

```js
function buildRoutingRules(env) {
  return [
    { match: 'Bond <> Nebula', chatId: env.TELEGRAM_CHAT_BOND_NEBULA, seriesKey: 'BOND_NEBULA' },
    { match: 'Bond', chatId: env.TELEGRAM_CHAT_BOND_TEAM, seriesKey: 'BOND_TEAM' },
    { match: 'ERN Daily Executive Standup', chatId: env.TELEGRAM_CHAT_ERN_EXEC_STANDUP, seriesKey: 'ERN_EXEC_STANDUP' },
    { match: 'ERN Daily Sync', chatId: env.TELEGRAM_CHAT_ERN_SUPER_TEAM, seriesKey: 'ERN_SUPER_TEAM' },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd webhook-service && node --test test/routing-table.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Add a failing test for `meeting-router.js`'s new `resolveSeriesKey`**

Append to `webhook-service/test/meeting-router.test.js` (keep the existing `RULES` constant and tests; add a second rules constant and these new tests at the end of the file):

```js
const RULES_WITH_SERIES = [
    { match: 'Bond <> Nebula', chatId: 'bond-nebula-chat', seriesKey: 'BOND_NEBULA' },
    { match: 'Bond', chatId: 'bond-team-chat', seriesKey: 'BOND_TEAM' },
];

test('resolveSeriesKey resolves the most specific rule first, same ordering as resolveChatId', () => {
    const router = createMeetingRouter(RULES_WITH_SERIES);
    assert.equal(router.resolveSeriesKey('Bond <> Nebula weekly sync'), 'BOND_NEBULA');
    assert.equal(router.resolveSeriesKey('Bond daily standup'), 'BOND_TEAM');
});

test('resolveSeriesKey returns null when no rule matches', () => {
    const router = createMeetingRouter(RULES_WITH_SERIES);
    assert.equal(router.resolveSeriesKey('Random 1:1'), null);
});

test('resolveSeriesKey returns null when rules have no seriesKey field (backward compatible)', () => {
    const router = createMeetingRouter(RULES);
    assert.equal(router.resolveSeriesKey('Bond daily standup'), null);
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd webhook-service && node --test test/meeting-router.test.js`
Expected: FAIL with `router.resolveSeriesKey is not a function`

- [ ] **Step 7: Update `meeting-router.js`**

Replace the full contents of `webhook-service/src/meeting-router.js`:

```js
// rules is an ORDERED array of { match, chatId, seriesKey }, checked most-specific-first.
// e.g. 'Bond <> Nebula' must precede 'Bond' so a Bond<>Nebula meeting doesn't
// fall into the looser Bond Team rule.
function createMeetingRouter(rules) {
    function findRule(meetingTitle) {
        const title = meetingTitle || '';
        return rules.find((rule) => title.includes(rule.match)) || null;
    }

    function resolveChatId(meetingTitle) {
        const rule = findRule(meetingTitle);
        return rule ? rule.chatId : null;
    }

    // Returns null both when no rule matches and when the matched rule has no seriesKey
    // (e.g. tests constructing rules without one) -- callers already treat "no series" as
    // "skip history tracking for this meeting", so both cases collapse to the same null.
    function resolveSeriesKey(meetingTitle) {
        const rule = findRule(meetingTitle);
        return (rule && rule.seriesKey) || null;
    }

    return { resolveChatId, resolveSeriesKey };
}

module.exports = { createMeetingRouter };
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd webhook-service && node --test test/meeting-router.test.js`
Expected: PASS, 8 tests (5 existing + 3 new)

- [ ] **Step 9: Add a failing test for `summarizer.js`'s new optional `seriesState` parameter**

Append to `webhook-service/test/summarizer.test.js` (keep all existing tests; add this at the end of the file):

```js
test('simplify() includes prior open items and narrative in the prompt when a seriesState is passed', async () => {
  const calls = [];
  const httpPost = async (url, body) => {
    calls.push({ body });
    return { data: { content: [{ type: 'text', text: 'OVERVIEW:\nOne.\n\nACTION_ITEMS:\n**Name**\nGet the doc.' }] } };
  };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  const seriesState = { open_items: [{ text: 'Old item', assignee: 'B', status: 'open' }], narrative: 'Prior narrative text.' };
  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' }, seriesState);

  const prompt = calls[0].body.messages[0].content;
  assert.match(prompt, /Old item/);
  assert.match(prompt, /Prior narrative text\./);
});

test('simplify() omits the series-context block entirely when seriesState is not passed (backward compatible)', async () => {
  const calls = [];
  const httpPost = async (url, body) => {
    calls.push({ body });
    return { data: { content: [{ type: 'text', text: 'OVERVIEW:\nOne.\n\nACTION_ITEMS:\n**Name**\nGet the doc.' }] } };
  };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' });

  const prompt = calls[0].body.messages[0].content;
  assert.doesNotMatch(prompt, /Prior open items/);
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd webhook-service && node --test test/summarizer.test.js`
Expected: FAIL — first new test fails because the prompt doesn't yet include "Old item" or "Prior narrative text."

- [ ] **Step 11: Update `summarizer.js`'s `buildPrompt` and `simplify`**

In `webhook-service/src/summarizer.js`, replace the `buildPrompt` function:

```js
function buildPrompt({ title, attendees, overview, action_items }, seriesState) {
  const hasContext = seriesState && ((seriesState.open_items && seriesState.open_items.length) || seriesState.narrative);
  const contextBlock = hasContext
    ? `\nPrior open items and narrative for this meeting series (for reference only -- you may note an item is recurring, but do not invent detail beyond what's here):\nOpen items:\n${JSON.stringify(seriesState.open_items ?? [], null, 2)}\nNarrative so far:\n${seriesState.narrative ?? ''}\n`
    : '';

  return `${RULES}
${contextBlock}
Meeting: ${title}
Attendees: ${(attendees ?? []).join(', ')}

Overview:
${overview}

Action Items:
${action_items}`;
}
```

Then replace the `simplify` function inside `createSummarizer`:

```js
  async function simplify(summary, seriesState) {
    const response = await httpPost(
      ANTHROPIC_URL,
      { model, max_tokens: maxTokens, messages: [{ role: 'user', content: buildPrompt(summary, seriesState) }] },
      { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
    );

    const text = response?.data?.content?.find((block) => block.type === 'text')?.text;
    if (!text) {
      throw new Error('summarizer response had no text content');
    }
    return parseResponse(text);
  }
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `cd webhook-service && node --test test/summarizer.test.js`
Expected: PASS, 8 tests (6 existing + 2 new)

- [ ] **Step 13: Run the full suite to confirm no regressions**

Run: `cd webhook-service && npm test`
Expected: PASS, 73 tests (68 from Task 2, + 0 net from routing-table.test.js since it was replaced not extended (still 3 tests), + 3 new meeting-router tests, + 2 new summarizer tests = 68 + 3 + 2 = 73)

- [ ] **Step 14: Commit**

```bash
cd "/Users/sraghavan/Documents/Claude/Projects/ERN Meeting Automation"
git add webhook-service/src/routing-table.js webhook-service/test/routing-table.test.js webhook-service/src/meeting-router.js webhook-service/test/meeting-router.test.js webhook-service/src/summarizer.js webhook-service/test/summarizer.test.js
git commit -m "Add seriesKey to routing table + resolveSeriesKey + optional series context in summarizer prompt"
```

---

### Task 4: Wire history + consolidation into `handle-webhook.js` and `app.js`

**Files:**
- Modify: `webhook-service/src/handle-webhook.js`
- Modify: `webhook-service/test/handle-webhook.test.js`
- Create: `webhook-service/test/history-integration.test.js`
- Modify: `webhook-service/src/app.js`

**Interfaces:**
- Consumes: `meetingRouter.resolveSeriesKey(title)` (Task 3), `summarizer.simplify(summary, seriesState)` (Task 3), `meetingHistory.getSeriesState/appendHistory/upsertSeriesState` (Task 1), `historyConsolidator.consolidate({seriesState, meeting})` (Task 2).
- Produces: `handleFirefliesWebhook(event, deps)` gains two new **optional** deps: `meetingHistory`, `historyConsolidator`. Task 5 depends on `createApp` accepting and forwarding these same two new optional params.

- [ ] **Step 1: Write the failing tests**

Append to `webhook-service/test/handle-webhook.test.js`. First, update the `fakeDeps` helper at the top of the file to accept overrides for the router (needed to test seriesKey behavior) — replace the existing `fakeDeps` function with:

```js
function fakeDeps({ summary = { title: 'ERN Daily Sync', overview: 'ov', action_items: 'ai' }, fetchSummaryImpl, meetingRouter } = {}) {
    const calls = { fetchSummary: 0, notifySummaryTo: 0, notifyOpsFailure: 0, notifyUnrouted: 0 };
    const firefliesClient = {
        fetchSummary: async (meetingId) => {
            calls.fetchSummary += 1;
            if (fetchSummaryImpl) return fetchSummaryImpl(meetingId);
            return summary;
        },
    };
    const notifier = {
        notifySummaryTo: async () => { calls.notifySummaryTo += 1; },
        notifyOpsFailure: async () => { calls.notifyOpsFailure += 1; },
        notifyUnrouted: async () => { calls.notifyUnrouted += 1; },
    };
    const seenMeetings = createSeenMeetings();
    const router = meetingRouter || createMeetingRouter([{ match: 'ERN Daily Sync', chatId: 'super-team-chat' }]);
    return { firefliesClient, notifier, seenMeetings, meetingRouter: router, calls };
}
```

Then add these new tests at the end of the file:

```js
test('does not call meetingHistory or historyConsolidator when the meeting has no seriesKey', async () => {
    const deps = fakeDeps();
    const meetingHistory = { getSeriesState: async () => { throw new Error('should not be called'); } };
    const historyConsolidator = { consolidate: async () => { throw new Error('should not be called'); } };

    const result = await handleFirefliesWebhook(
        { eventType: 'meeting.summarized', meetingId: 'm8' },
        { ...deps, meetingHistory, historyConsolidator }
    );

    assert.equal(result.status, 'processed');
});

test('fetches series state, passes it to the summarizer, and writes updated history when the meeting has a seriesKey', async () => {
    const router = createMeetingRouter([{ match: 'Bond Daily', chatId: 'bond-chat', seriesKey: 'BOND_TEAM' }]);
    const deps = fakeDeps({ summary: { title: 'Bond Daily', attendees: ['A'], overview: 'raw ov', action_items: 'raw ai' }, meetingRouter: router });

    const historyCalls = { getSeriesState: [], appendHistory: [], upsertSeriesState: [] };
    const meetingHistory = {
        getSeriesState: async (seriesKey) => { historyCalls.getSeriesState.push(seriesKey); return { open_items: [{ text: 'Old', status: 'open' }], narrative: 'Prior narrative.' }; },
        appendHistory: async (row) => { historyCalls.appendHistory.push(row); },
        upsertSeriesState: async (seriesKey, state) => { historyCalls.upsertSeriesState.push({ seriesKey, state }); },
    };

    let summarizerCalledWith;
    const summarizer = { simplify: async (summary, seriesState) => { summarizerCalledWith = { summary, seriesState }; return { overview: 'condensed ov', action_items: 'condensed ai' }; } };

    const historyConsolidator = { consolidate: async ({ seriesState, meeting }) => ({ open_items: [{ text: 'Old', status: 'closed', closed_reason: 'done' }], narrative: 'Updated narrative.' }) };

    const result = await handleFirefliesWebhook(
        { eventType: 'meeting.summarized', meetingId: 'm9' },
        { ...deps, summarizer, meetingHistory, historyConsolidator }
    );

    assert.equal(result.status, 'processed');
    assert.deepEqual(historyCalls.getSeriesState, ['BOND_TEAM']);
    assert.deepEqual(summarizerCalledWith.seriesState, { open_items: [{ text: 'Old', status: 'open' }], narrative: 'Prior narrative.' });

    assert.equal(historyCalls.appendHistory.length, 1);
    assert.equal(historyCalls.appendHistory[0].series_key, 'BOND_TEAM');
    assert.equal(historyCalls.appendHistory[0].meeting_id, 'm9');
    assert.equal(historyCalls.appendHistory[0].raw_overview, 'raw ov');
    assert.equal(historyCalls.appendHistory[0].condensed_overview, 'condensed ov');

    assert.equal(historyCalls.upsertSeriesState.length, 1);
    assert.equal(historyCalls.upsertSeriesState[0].seriesKey, 'BOND_TEAM');
    assert.deepEqual(historyCalls.upsertSeriesState[0].state.open_items, [{ text: 'Old', status: 'closed', closed_reason: 'done' }]);
    assert.equal(historyCalls.upsertSeriesState[0].state.narrative, 'Updated narrative.');
});

test('a getSeriesState failure is treated as no history yet, and does not block the summary or call notifyOpsFailure', async () => {
    const router = createMeetingRouter([{ match: 'Bond Daily', chatId: 'bond-chat', seriesKey: 'BOND_TEAM' }]);
    const deps = fakeDeps({ summary: { title: 'Bond Daily', overview: 'ov', action_items: 'ai' }, meetingRouter: router });

    const meetingHistory = { getSeriesState: async () => { throw new Error('supabase down'); }, appendHistory: async () => {}, upsertSeriesState: async () => {} };
    let summarizerCalledWith;
    const summarizer = { simplify: async (summary, seriesState) => { summarizerCalledWith = seriesState; return { overview: 'ov', action_items: 'ai' }; } };

    const result = await handleFirefliesWebhook(
        { eventType: 'meeting.summarized', meetingId: 'm10' },
        { ...deps, summarizer, meetingHistory, historyConsolidator: { consolidate: async () => ({ open_items: [], narrative: '' }) } }
    );

    assert.equal(result.status, 'processed');
    assert.equal(deps.calls.notifyOpsFailure, 0);
    assert.equal(summarizerCalledWith, null);
});

test('a historyConsolidator failure does not block the summary, does not call notifyOpsFailure, and skips the history write', async () => {
    const router = createMeetingRouter([{ match: 'Bond Daily', chatId: 'bond-chat', seriesKey: 'BOND_TEAM' }]);
    const deps = fakeDeps({ summary: { title: 'Bond Daily', overview: 'ov', action_items: 'ai' }, meetingRouter: router });

    const historyCalls = { appendHistory: 0, upsertSeriesState: 0 };
    const meetingHistory = {
        getSeriesState: async () => null,
        appendHistory: async () => { historyCalls.appendHistory += 1; },
        upsertSeriesState: async () => { historyCalls.upsertSeriesState += 1; },
    };
    const historyConsolidator = { consolidate: async () => { throw new Error('anthropic down'); } };

    const result = await handleFirefliesWebhook(
        { eventType: 'meeting.summarized', meetingId: 'm11' },
        { ...deps, meetingHistory, historyConsolidator }
    );

    assert.equal(result.status, 'processed');
    assert.equal(deps.calls.notifySummaryTo, 1);
    assert.equal(deps.calls.notifyOpsFailure, 0);
    assert.equal(historyCalls.appendHistory, 0);
    assert.equal(historyCalls.upsertSeriesState, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd webhook-service && node --test test/handle-webhook.test.js`
Expected: FAIL — new tests fail because `handleFirefliesWebhook` doesn't yet call `meetingRouter.resolveSeriesKey`, `meetingHistory`, or `historyConsolidator`

- [ ] **Step 3: Update `handle-webhook.js`**

Replace the full contents of `webhook-service/src/handle-webhook.js`:

```js
// Fireflies Webhooks V2 event name (the V1 name, 'Transcription completed', is legacy —
// see app.js for the V2 payload-field translation: `event`/`meeting_id` -> `eventType`/`meetingId`).
const MEETING_SUMMARIZED = 'meeting.summarized';

async function simplifyOrFallback(summarizer, summary, seriesState) {
    if (!summarizer) {
        return summary;
    }
    try {
        const { overview, action_items } = await summarizer.simplify(summary, seriesState);
        return { ...summary, overview, action_items };
    } catch (error) {
        return summary;
    }
}

// Returns null (treated as "no history yet") on any failure -- a degraded/unreachable history
// store must never block the pipeline, same precedent as the summarizer's own fallback.
async function fetchSeriesStateOrNull(meetingHistory, seriesKey) {
    if (!meetingHistory || !seriesKey) return null;
    try {
        return await meetingHistory.getSeriesState(seriesKey);
    } catch (error) {
        return null;
    }
}

// Best-effort: runs only after notifySummaryTo has already succeeded, so a failure here must
// never surface as notifyOpsFailure or affect what was already sent (ADR-0003's "a degraded
// feature is not an ops failure" precedent, extended to this second automatic model call).
async function consolidateHistoryBestEffort({ meetingHistory, historyConsolidator, seriesKey, seriesState, meetingId, rawSummary, condensedSummary }) {
    if (!meetingHistory || !historyConsolidator) return;
    try {
        const updated = await historyConsolidator.consolidate({ seriesState, meeting: rawSummary });
        await meetingHistory.appendHistory({
            series_key: seriesKey,
            meeting_id: meetingId,
            title: rawSummary.title,
            attendees: rawSummary.attendees ?? [],
            raw_overview: rawSummary.overview,
            raw_action_items: rawSummary.action_items,
            condensed_overview: condensedSummary.overview,
            condensed_action_items: condensedSummary.action_items,
        });
        await meetingHistory.upsertSeriesState(seriesKey, { open_items: updated.open_items, narrative: updated.narrative, lastMeetingId: meetingId });
    } catch (error) {
        // swallow -- best-effort, see comment above
    }
}

async function handleFirefliesWebhook({ eventType, meetingId }, { firefliesClient, notifier, seenMeetings, meetingRouter, summarizer, meetingHistory, historyConsolidator }) {
    if (eventType !== MEETING_SUMMARIZED) {
        return { status: 'ignored', meetingId };
    }

    if (seenMeetings.has(meetingId)) {
        return { status: 'duplicate', meetingId };
    }
    seenMeetings.markSeen(meetingId);

    try {
        const rawSummary = await firefliesClient.fetchSummary(meetingId);

        if (!rawSummary) {
            await notifier.notifyOpsFailure(meetingId, 'summary was not ready after retrying');
            return { status: 'failed', meetingId };
        }

        const seriesKey = meetingRouter.resolveSeriesKey(rawSummary.title);
        const seriesState = await fetchSeriesStateOrNull(meetingHistory, seriesKey);

        const summary = await simplifyOrFallback(summarizer, rawSummary, seriesState);

        const chatId = meetingRouter.resolveChatId(summary.title);
        if (!chatId) {
            await notifier.notifyUnrouted(meetingId, summary.title, summary);
            return { status: 'unrouted', meetingId };
        }

        await notifier.notifySummaryTo(chatId, summary);

        if (seriesKey) {
            await consolidateHistoryBestEffort({ meetingHistory, historyConsolidator, seriesKey, seriesState, meetingId, rawSummary, condensedSummary: summary });
        }

        return { status: 'processed', meetingId };
    } catch (error) {
        await notifier.notifyOpsFailure(meetingId, error.message).catch(() => {});
        return { status: 'failed', meetingId };
    }
}

module.exports = { handleFirefliesWebhook };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd webhook-service && node --test test/handle-webhook.test.js`
Expected: PASS, 13 tests (9 existing + 4 new)

- [ ] **Step 5: Write a schema-drift integration test between `history-consolidator.js` and `meeting-history.js`**

These two modules independently assume a shared shape for `open_items`/`narrative` — `history-consolidator.consolidate()` produces it, `meeting-history.upsertSeriesState()`/`getSeriesState()` store and return it. Nothing today proves they actually agree, the same gap Candidate 1 of the 2026-07-03 architecture review found between `summarizer.js` and `notifier.js` (fixed via `summarizer-notifier-integration.test.js`). Create `webhook-service/test/history-integration.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistoryConsolidator } = require('../src/history-consolidator');
const { createMeetingHistory } = require('../src/meeting-history');

test('a real history-consolidator output is accepted as-is by meeting-history.upsertSeriesState, no field mismatch', async () => {
  const fakeAnthropicPost = async () => ({
    data: { content: [{ type: 'text', text: 'OPEN_ITEMS:\n[{"text":"Ship X","assignee":"A","status":"open","first_seen":"2026-07-01"}]\n\nNARRATIVE:\nX is progressing.' }] },
  });
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost: fakeAnthropicPost });

  const upsertCalls = [];
  const fakeSupabasePost = async (url, body, config) => { upsertCalls.push({ url, body, config }); };
  const meetingHistory = createMeetingHistory({ url: 'https://example.supabase.co', serviceKey: 'test-key', httpPost: fakeSupabasePost });

  const { open_items, narrative } = await consolidator.consolidate({
    seriesState: null,
    meeting: { title: 'Bond Daily', attendees: ['A'], overview: 'ov', action_items: 'ai' },
  });
  await meetingHistory.upsertSeriesState('BOND_TEAM', { open_items, narrative, lastMeetingId: 'm1' });

  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0].body.open_items, [{ text: 'Ship X', assignee: 'A', status: 'open', first_seen: '2026-07-01' }]);
  assert.equal(upsertCalls[0].body.narrative, 'X is progressing.');
});

test('a real meeting-history.getSeriesState output is accepted as-is by history-consolidator.consolidate as seriesState input', async () => {
  const fakeSupabaseGet = async () => ({
    data: [{ open_items: [{ text: 'Old item', assignee: 'B', status: 'open', first_seen: '2026-06-20' }], narrative: 'Prior narrative.' }],
  });
  const meetingHistory = createMeetingHistory({ url: 'https://example.supabase.co', serviceKey: 'test-key', httpGet: fakeSupabaseGet });

  const anthropicCalls = [];
  const fakeAnthropicPost = async (url, body) => {
    anthropicCalls.push({ body });
    return { data: { content: [{ type: 'text', text: 'OPEN_ITEMS:\n[]\n\nNARRATIVE:\nUpdated.' }] } };
  };
  const consolidator = createHistoryConsolidator({ apiKey: 'test-key', httpPost: fakeAnthropicPost });

  const seriesState = await meetingHistory.getSeriesState('BOND_TEAM');
  await consolidator.consolidate({ seriesState, meeting: { title: 'Bond Daily', overview: 'ov', action_items: 'ai' } });

  assert.match(anthropicCalls[0].body.messages[0].content, /Old item/);
  assert.match(anthropicCalls[0].body.messages[0].content, /Prior narrative\./);
});
```

- [ ] **Step 6: Run the new integration test to verify it passes**

Run: `cd webhook-service && node --test test/history-integration.test.js`
Expected: PASS, 2 tests (no new production code needed — this test verifies the two modules already built in Task 1 and Task 2 agree on shape)

- [ ] **Step 7: Update `app.js` to accept and forward the two new optional deps**

In `webhook-service/src/app.js`, update the `createApp` function signature and the webhook handler's call to `handleFirefliesWebhook`:

```js
function createApp({ secret, relaySecret, firefliesClient, notifier, seenMeetings, meetingRouter, summarizer, meetingHistory, historyConsolidator, relayChatMap, onProcessed }) {
```

And update the call inside the `/webhook/fireflies` handler:

```js
        const result = await handleFirefliesWebhook(
            { eventType: event, meetingId },
            { firefliesClient, notifier, seenMeetings, meetingRouter, summarizer, meetingHistory, historyConsolidator }
        );
```

(Everything else in `app.js` stays unchanged.)

- [ ] **Step 8: Run the full suite to confirm no regressions**

Run: `cd webhook-service && npm test`
Expected: PASS, 79 tests (73 from Task 3 + 4 new handle-webhook tests + 2 new integration tests = 79; `app.test.js`'s existing tests still pass since they don't pass `meetingHistory`/`historyConsolidator`, which default to `undefined`)

- [ ] **Step 9: Commit**

```bash
cd "/Users/sraghavan/Documents/Claude/Projects/ERN Meeting Automation"
git add webhook-service/src/handle-webhook.js webhook-service/test/handle-webhook.test.js webhook-service/src/app.js webhook-service/test/history-integration.test.js
git commit -m "Wire meeting history + consolidation into handle-webhook.js, additive and best-effort"
```

---

### Task 5: `index.js` wiring, `render.yaml`/`.env.example`, docs

**Files:**
- Modify: `webhook-service/index.js`
- Modify: `render.yaml`
- Modify: `webhook-service/.env.example`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `createMeetingHistory` (Task 1), `createHistoryConsolidator` (Task 2), `createApp`'s new `meetingHistory`/`historyConsolidator` params (Task 4).
- Produces: nothing further downstream — this is the final wiring task.

- [ ] **Step 1: Update `webhook-service/index.js`**

Add two new requires near the top (after the existing `createSummarizer` require):

```js
const { createSummarizer } = require('./src/summarizer');
const { createMeetingHistory } = require('./src/meeting-history');
const { createHistoryConsolidator } = require('./src/history-consolidator');
```

Add the construction logic right after the existing `summarizer` block (which reads `if (unset) undefined`):

```js
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
```

Update the `createApp({...})` call to include the two new values:

```js
const app = createApp({
    secret: process.env.FIREFLIES_SECRET,
    relaySecret: process.env.RELAY_SECRET,
    firefliesClient: createFirefliesClient({ apiKey: process.env.FIREFLIES_API_KEY }),
    notifier: createNotifier({
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        opsChatId: process.env.TELEGRAM_OPS_CHAT_ID,
        unroutedChatId: process.env.TELEGRAM_CHAT_ERN_SUPER_TEAM,
    }),
    seenMeetings: createSeenMeetings(),
    meetingRouter,
    relayChatMap,
    summarizer,
    meetingHistory,
    historyConsolidator,
    onProcessed: (result) => {
        if (result.status === 'failed' || result.status === 'unrouted') {
            console.error('Fireflies webhook processing needs attention:', result);
        }
    },
});
```

- [ ] **Step 2: Update `render.yaml`**

Add two new entries to the `envVars` list (after the existing `ANTHROPIC_API_KEY` entry):

```yaml
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_KEY
        sync: false
      - key: RELAY_SECRET
        sync: false
```

- [ ] **Step 3: Update `webhook-service/.env.example`**

Add after the existing `ANTHROPIC_API_KEY=` line and its comment:

```
# Used by meeting-history.js + history-consolidator.js to track open action items and a
# rolling narrative per recurring meeting series (ADR-0005). If either is unset, history
# tracking is skipped entirely and the pipeline behaves exactly as it does without it.
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
```

- [ ] **Step 4: Run the full suite one final time**

Run: `cd webhook-service && npm test`
Expected: PASS, 79 tests, 0 failures (unchanged from Task 4's final count — this task only touches wiring/config/docs, no new tests)

- [ ] **Step 5: Update `CLAUDE.md`'s status log**

Add a new dated entry at the end of the running status log in `CLAUDE.md` (after the most recent "Architecture review applied" entry), following the file's existing style:

```markdown
**Meeting history + cross-meeting consolidation added (2026-07-04), see [ADR-0005](docs/adr/0005-meeting-history-and-consolidation.md).**
`webhook-service` now persists full meeting history in Supabase (`meeting_history`, append-only)
and derives per-series open-item tracking + a rolling narrative (`series_state`) via a second,
separate Anthropic call (`history-consolidator.js`), fed back into `summarizer.js`'s prompt as
read-only context for the next meeting in that series. Only applies to meetings matching a real
routing rule — unrouted/one-off meetings are unaffected. Both new env vars
(`SUPABASE_URL`/`SUPABASE_SERVICE_KEY`) are optional; unset either and the pipeline behaves
exactly as it did before this change. Manual one-time setup still needed: create the Supabase
project and run `webhook-service/supabase/schema.sql`, then set the two env vars on Render.
**79/79 tests pass.**
```

- [ ] **Step 6: Commit and push**

```bash
cd "/Users/sraghavan/Documents/Claude/Projects/ERN Meeting Automation"
git add webhook-service/index.js render.yaml webhook-service/.env.example CLAUDE.md
git commit -m "Wire history/consolidation into index.js, add SUPABASE_URL/SUPABASE_SERVICE_KEY config"
git push origin main
```

---

## After implementation: manual setup still required (not code, cannot be scripted by an agent)

1. Create a new Supabase project (free tier) at supabase.com.
2. Open its SQL Editor and run `webhook-service/supabase/schema.sql`.
3. Copy the project URL and service-role key into Render's dashboard for the
   `ern-fireflies-webhook` service's Environment tab: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
   (same "you paste it directly into Render, not into a chat session" handling already used for
   `ANTHROPIC_API_KEY`).
4. Once set, Render will redeploy automatically and history tracking goes live for the next
   processed meeting in a recognized series.
