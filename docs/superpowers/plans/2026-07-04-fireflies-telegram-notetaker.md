# Fireflies → Telegram Notetaker (Merge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the 2026-07-04 "Agent Briefing" spec (company classification, blocker/handoff detection, richer message formats, recording link) into the already-deployed `webhook-service`, without breaking any proven behavior — including the separate `meeting-history-and-consolidation` work (ADR-0005), which was fully implemented and committed (commits `65d80b2`..`4095dec`) while this plan was being written. **This plan builds on top of that work, not instead of it.**

**Architecture:** Title-based routing stays authoritative (`routing-table.js`/`meeting-router.js`), now carrying both a `seriesKey` (existing, for history tracking) and a new `company` tag per rule. A new content-based `company-classifier.js` only runs as a fallback when no title rule matches. `summarizer.js`'s single Anthropic call already accepts a `seriesState` for cross-meeting continuity — this plan changes its second parameter to a `{ seriesState, company }` context object and extends the response format with two new sections (`SECTIONS`, `NEXT_STEPS`), plus blocker (`⚠️`) and handoff detection, plus a per-company tone hint. `notifier.js` gains two new message-formatting functions, and the post-meeting flow sends **two independent Telegram messages** instead of one (history consolidation still runs afterward, unchanged). `fireflies-client.js` additionally fetches the recording URL.

**Tech Stack:** Node.js (`node --test`), `axios` (existing dependency, no new packages), Telegram Bot API (HTML `parse_mode`), Anthropic Messages API.

**Full design context:** [docs/superpowers/specs/2026-07-04-fireflies-telegram-notetaker-design.md](../specs/2026-07-04-fireflies-telegram-notetaker-design.md).

## Global Constraints

- **Baseline: 79 tests currently pass** (`cd webhook-service && npm test`) — this already includes the fully-implemented `meeting-history-and-consolidation` plan (`meeting-history.js`, `history-consolidator.js`, `seriesKey`/`resolveSeriesKey`, and history wiring in `handle-webhook.js`/`app.js`/`index.js`). Tasks 4, 6, 8, and 9 below **modify files that plan already touched** — read the current file before editing, add to it, do not reintroduce the pre-history version. Every task must keep the running total passing; no regressions, and no loss of history-tracking behavior.
- Every new module follows the existing injectable-`httpPost` (or plain pure-function) convention seen in `fireflies-client.js`/`notifier.js`/`summarizer.js` — fakeable in tests, zero live network calls.
- `company` classification never changes **where** a message is routed (that's still `resolveChatId`/the ops-unrouted fallback) — it only selects the summarizer's tone hint and the wording of the unrouted-safety-net notice.
- When `summarizer` is unset or throws, the pipeline must keep behaving exactly as it does today for the fields it already produces (`overview`, `action_items`) — the two new fields (`sections`, `next_steps`) are simply absent in that case, and every downstream renderer must handle their absence without throwing.
- The post-meeting flow sends the Agenda/Overview and To-Dos messages independently — one failing must not prevent the other from being attempted, and must not be silently swallowed (report via `notifyOpsFailure`, but keep the overall result `processed`). History consolidation (existing behavior) still runs after both sends are attempted, gated on `seriesKey` exactly as it is today.
- Bold in Telegram output is always rendered via the existing HTML `parse_mode` + `escapeHtml()` path (`<b>`/`<i>`), never literal `*`/`_` — same visual result as the briefing's templates, no new escaping surface.

---

### Task 1: `company-profiles.js`

**Files:**
- Create: `webhook-service/src/company-profiles.js`
- Test: `webhook-service/test/company-profiles.test.js`

**Interfaces:**
- Produces: `getProfile(company: 'BOND' | 'ERN') => { label: string, tone: string, keywords: string[], attendees: string[] } | null`. Task 2 (classifier) and Task 6 (summarizer tone hint) both consume this.

- [ ] **Step 1: Write the failing tests**

Create `webhook-service/test/company-profiles.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { getProfile } = require('../src/company-profiles');

test('getProfile returns the Bond profile with keywords, attendees, and tone', () => {
  const profile = getProfile('BOND');
  assert.equal(profile.label, 'Bond');
  assert.match(profile.tone, /execution-focused/);
  assert.ok(profile.keywords.includes('TVL'));
  assert.ok(profile.attendees.includes('Taweh Bey Solowii'));
});

test('getProfile returns the ERN profile with keywords, attendees, and tone', () => {
  const profile = getProfile('ERN');
  assert.equal(profile.label, 'ERN');
  assert.match(profile.tone, /decision-focused/);
  assert.ok(profile.keywords.includes('eSIM'));
  assert.ok(profile.attendees.includes('Rob Christensen'));
});

test('getProfile returns null for an unknown company key', () => {
  assert.equal(getProfile('ACME'), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webhook-service && node --test test/company-profiles.test.js`
Expected: FAIL with `Cannot find module '../src/company-profiles'`

- [ ] **Step 3: Write the implementation**

Create `webhook-service/src/company-profiles.js`:

```js
// Company classification data for the Fireflies-Telegram notetaker (2026-07-04 "Agent
// Briefing" doc, Section 2). Consumed by company-classifier.js (content-based fallback, only
// when routing-table.js's title match fails) and summarizer.js (per-company tone hint).
const PROFILES = {
  BOND: {
    label: 'Bond',
    tone: 'semi-formal, highly execution-focused',
    keywords: ['Zero G', 'GSR', 'Turtle Club', 'Wormhole', 'Cicada', 'Midas', 'Flow Trader', 'RE7 API', 'TVL', 'Perp DEX', 'LSTs'],
    attendees: ['Taweh Bey Solowii', 'Vinson Leow', 'Hoa Ha', 'Sowmya Raghavan', 'Caitlin Sarah', 'Red'],
  },
  ERN: {
    label: 'ERN',
    tone: 'casual-executive, decision-focused',
    keywords: ['Live to Earn', 'Apkudo', 'Vodafone', 'Delos', 'CosmicWire', 'Selini Summit', 'FDV', 'eSIM', 'Klaviyo'],
    attendees: ['Dr. Jonathan', 'Vinson Leow', 'Keli Whitlock', 'Sowmya Raghavan', 'Hoa Ha', 'Jerad Finck', 'Rob Christensen'],
  },
};

function getProfile(company) {
  return PROFILES[company] ?? null;
}

module.exports = { PROFILES, getProfile };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webhook-service && node --test test/company-profiles.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `cd webhook-service && npm test`
Expected: PASS, 82 tests (79 baseline + 3 new)

- [ ] **Step 6: Commit**

```bash
cd "/Users/sraghavan/Documents/Claude/Projects/ERN Meeting Automation"
git add webhook-service/src/company-profiles.js webhook-service/test/company-profiles.test.js
git commit -m "Add company-profiles.js: Bond/ERN keywords, attendees, and tone data"
```

---

### Task 2: `company-classifier.js`

**Files:**
- Create: `webhook-service/src/company-classifier.js`
- Test: `webhook-service/test/company-classifier.test.js`

**Interfaces:**
- Consumes: `getProfile`/`PROFILES` from Task 1.
- Produces: `createCompanyClassifier() => { classify({ overview, action_items, attendees }): 'BOND' | 'ERN' | null }`. Task 8 (`handle-webhook.js`) depends on this exact `classify(summary)` signature.

- [ ] **Step 1: Write the failing tests**

Create `webhook-service/test/company-classifier.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCompanyClassifier } = require('../src/company-classifier');

test('classifies as BOND when overview/action_items contain Bond keywords', () => {
  const classifier = createCompanyClassifier();
  const result = classifier.classify({
    overview: 'Discussed RE7 API integration and current TVL growth.',
    action_items: 'Follow up with GSR on Perp DEX liquidity.',
    attendees: [],
  });
  assert.equal(result, 'BOND');
});

test('classifies as ERN when overview/action_items contain ERN keywords', () => {
  const classifier = createCompanyClassifier();
  const result = classifier.classify({
    overview: 'Reviewed the Apkudo eSIM rollout and FDV targets.',
    action_items: 'Confirm Vodafone timeline.',
    attendees: [],
  });
  assert.equal(result, 'ERN');
});

test('returns null when no keywords match either company', () => {
  const classifier = createCompanyClassifier();
  const result = classifier.classify({ overview: 'Just a random 1:1 catch-up.', action_items: 'Nothing specific.', attendees: [] });
  assert.equal(result, null);
});

test('returns null on a tied score rather than guessing', () => {
  const classifier = createCompanyClassifier();
  const result = classifier.classify({
    overview: 'Mentioned TVL and also eSIM in passing.',
    action_items: '',
    attendees: [],
  });
  assert.equal(result, null);
});

test('attendee names count toward the score alongside keywords', () => {
  const classifier = createCompanyClassifier();
  const result = classifier.classify({
    overview: 'General catch-up, no notable jargon.',
    action_items: '',
    attendees: ['Rob Christensen', 'Keli Whitlock'],
  });
  assert.equal(result, 'ERN');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webhook-service && node --test test/company-classifier.test.js`
Expected: FAIL with `Cannot find module '../src/company-classifier'`

- [ ] **Step 3: Write the implementation**

Create `webhook-service/src/company-classifier.js`:

```js
// Content-based company classifier — the fallback path used ONLY when meeting-router.js's
// title match returns null (see routing-table.js). Never changes routing destination, only
// which tone/company label gets used downstream.
const { PROFILES } = require('./company-profiles');

function countHits(haystack, needles) {
  const lower = haystack.toLowerCase();
  return needles.reduce((count, needle) => (lower.includes(needle.toLowerCase()) ? count + 1 : count), 0);
}

function createCompanyClassifier() {
  function classify({ overview, action_items, attendees }) {
    const text = `${overview ?? ''} ${action_items ?? ''}`;
    const attendeeNames = (attendees ?? []).join(' ');

    const scores = Object.entries(PROFILES).map(([company, profile]) => ({
      company,
      score: countHits(text, profile.keywords) + countHits(attendeeNames, profile.attendees),
    }));
    scores.sort((a, b) => b.score - a.score);

    const [top, second] = scores;
    if (!top || top.score === 0) return null;
    if (second && second.score === top.score) return null; // tie -- don't guess
    return top.company;
  }

  return { classify };
}

module.exports = { createCompanyClassifier };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webhook-service && node --test test/company-classifier.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `cd webhook-service && npm test`
Expected: PASS, 87 tests (82 from Task 1 + 5 new)

- [ ] **Step 6: Commit**

```bash
cd "/Users/sraghavan/Documents/Claude/Projects/ERN Meeting Automation"
git add webhook-service/src/company-classifier.js webhook-service/test/company-classifier.test.js
git commit -m "Add company-classifier.js: content-based Bond/ERN fallback classification"
```

---

### Task 3: `attendee-handles.js` fixes + `linkifyBoldNames`

**Files:**
- Modify: `webhook-service/src/attendee-handles.js`
- Modify: `webhook-service/test/attendee-handles.test.js`

**Interfaces:**
- Produces: `handleFor(displayName): string` (existing, corrected data). New: `linkifyBoldNames(text: string): string` — replaces every `**Full Name**` occurrence with `**@handle**` (or leaves it unchanged if the name isn't in the table). Task 7 (`notifier.js`) depends on `linkifyBoldNames`.

- [ ] **Step 1: Update the failing test first**

Replace the full contents of `webhook-service/test/attendee-handles.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleFor, linkifyBoldNames } = require('../src/attendee-handles');

test('returns the mapped Telegram handle for a known attendee', () => {
  assert.equal(handleFor('Taweh Bey Solowii'), '@tawehbeysolowii');
  assert.equal(handleFor('Vinson Leow'), '@vinsonleow');
  assert.equal(handleFor('Hoa Ha'), '@hoaha47');
  assert.equal(handleFor('Sowmya Raghavan'), '@sraghavan');
  assert.equal(handleFor('Caitlin Sarah'), '@caitlinsarah');
  assert.equal(handleFor('Red'), '@redbeem');
  assert.equal(handleFor('Dr. Jonathan'), '@jonscott');
  assert.equal(handleFor('Keli Whitlock'), '@keliwhitlock');
  assert.equal(handleFor('Jerad Finck'), '@JeradFinck');
});

test('falls back to the plain display name for an unmapped attendee', () => {
  assert.equal(handleFor('Random Guest'), 'Random Guest');
  assert.equal(handleFor('Rob Christensen'), 'Rob Christensen');
});

test('linkifyBoldNames replaces a bolded known name with its bolded handle', () => {
  const result = linkifyBoldNames('**Vinson Leow**\nGet the doc.');
  assert.equal(result, '**@vinsonleow**\nGet the doc.');
});

test('linkifyBoldNames leaves a bolded unmapped name unchanged', () => {
  const result = linkifyBoldNames('**Rob Christensen**\nConfirm budget.');
  assert.equal(result, '**Rob Christensen**\nConfirm budget.');
});

test('linkifyBoldNames handles multiple bolded names in one string', () => {
  const result = linkifyBoldNames('**Hoa Ha**\n- Item A\n\n**Red**\n- Item B');
  assert.equal(result, '**@hoaha47**\n- Item A\n\n**@redbeem**\n- Item B');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webhook-service && node --test test/attendee-handles.test.js`
Expected: FAIL — corrected/added handles don't exist yet, `linkifyBoldNames` is not exported

- [ ] **Step 3: Update the implementation**

Replace the full contents of `webhook-service/src/attendee-handles.js`:

```js
// Kept in sync manually with the identical table in routines/pre-meeting-reminder.md — a
// Cloud Routine prompt has no code path to require() this file, so update both when this
// table changes.
const HANDLES = {
  'Taweh Bey Solowii': '@tawehbeysolowii',
  'Vinson Leow': '@vinsonleow',
  'Hoa Ha': '@hoaha47',
  'Sowmya Raghavan': '@sraghavan',
  'Caitlin Sarah': '@caitlinsarah',
  Red: '@redbeem',
  'Dr. Jonathan': '@jonscott',
  'Keli Whitlock': '@keliwhitlock',
  'Jerad Finck': '@JeradFinck',
  // Rob Christensen intentionally absent -- no Telegram handle given, falls back to plain name.
};

function handleFor(displayName) {
  return HANDLES[displayName] ?? displayName;
}

// Swaps a "**Full Name**" bold-marker heading (the shape summarizer.js emits for action-item
// assignees) for "**@handle**" when the name is known, so Telegram output tags the real
// person instead of showing their plain name. Unmapped names pass through unchanged.
function linkifyBoldNames(text) {
  return text.replace(/\*\*([^*]+)\*\*/g, (full, name) => `**${handleFor(name)}**`);
}

module.exports = { handleFor, linkifyBoldNames };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webhook-service && node --test test/attendee-handles.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `cd webhook-service && npm test`
Expected: PASS, 90 tests (87 from Task 2 + 3 new; attendee-handles.test.js grew from 2 to 5 tests, net +3)

- [ ] **Step 6: Commit**

```bash
cd "/Users/sraghavan/Documents/Claude/Projects/ERN Meeting Automation"
git add webhook-service/src/attendee-handles.js webhook-service/test/attendee-handles.test.js
git commit -m "Fix Sowmya's handle, add Red/ERN attendee handles, add linkifyBoldNames"
```

---

### Task 4: `routing-table.js` company field + new patterns, `meeting-router.js` `resolveCompany`

**Files:**
- Modify: `webhook-service/src/routing-table.js`
- Modify: `webhook-service/test/routing-table.test.js`
- Modify: `webhook-service/src/meeting-router.js`
- Modify: `webhook-service/test/meeting-router.test.js`

**Interfaces:**
- Consumes/extends: the `seriesKey`-carrying rule shape and `resolveSeriesKey` already added by the `meeting-history-and-consolidation` plan — **read the current file first**, this task adds a field, it does not revert that work.
- Produces: `buildRoutingRules(env)` rows now carry **both** `seriesKey` (existing) and `company` (new): `{ match, chatId, seriesKey, company }`. `createMeetingRouter(rules).resolveCompany(title): 'BOND' | 'ERN' | null` (mirrors `resolveChatId`/`resolveSeriesKey`, same `findRule` helper). Task 8 depends on `resolveCompany`.

- [ ] **Step 1: Update `routing-table.js`'s test first**

Replace the full contents of `webhook-service/test/routing-table.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRoutingRules, assertOrderingIsSafe } = require('../src/routing-table');

test('buildRoutingRules reads each chat ID from the given env object, most-specific-first, each tagged with a seriesKey and a company', () => {
  const env = {
    TELEGRAM_CHAT_BOND_NEBULA: 'nebula-chat',
    TELEGRAM_CHAT_BOND_TEAM: 'bond-chat',
    TELEGRAM_CHAT_ERN_EXEC_STANDUP: 'exec-chat',
    TELEGRAM_CHAT_ERN_SUPER_TEAM: 'super-chat',
  };
  const rules = buildRoutingRules(env);
  assert.deepEqual(rules, [
    { match: 'Bond <> Nebula', chatId: 'nebula-chat', seriesKey: 'BOND_NEBULA', company: 'BOND' },
    { match: 'Bond <> 0g Weekly Sync', chatId: 'bond-chat', seriesKey: 'BOND_TEAM', company: 'BOND' },
    { match: 'BOND Daily Standup', chatId: 'bond-chat', seriesKey: 'BOND_TEAM', company: 'BOND' },
    { match: 'Bond', chatId: 'bond-chat', seriesKey: 'BOND_TEAM', company: 'BOND' },
    { match: 'ERN Daily Executive Standup', chatId: 'exec-chat', seriesKey: 'ERN_EXEC_STANDUP', company: 'ERN' },
    { match: 'ERN <> Nebula', chatId: 'super-chat', seriesKey: 'ERN_SUPER_TEAM', company: 'ERN' },
    { match: 'ERN Daily Sync', chatId: 'super-chat', seriesKey: 'ERN_SUPER_TEAM', company: 'ERN' },
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
    { match: 'Bond', chatId: 'bond-chat', seriesKey: 'BOND_TEAM', company: 'BOND' },
    { match: 'Bond <> Nebula', chatId: 'nebula-chat', seriesKey: 'BOND_NEBULA', company: 'BOND' },
  ];
  assert.throws(() => assertOrderingIsSafe(broken), /"Bond".*"Bond <> Nebula"/);
});

test('new Bond/ERN sub-series patterns route to the expected chat via meeting-router', () => {
  const { createMeetingRouter } = require('../src/meeting-router');
  const rules = buildRoutingRules({
    TELEGRAM_CHAT_BOND_NEBULA: 'nebula-chat', TELEGRAM_CHAT_BOND_TEAM: 'bond-chat',
    TELEGRAM_CHAT_ERN_EXEC_STANDUP: 'exec-chat', TELEGRAM_CHAT_ERN_SUPER_TEAM: 'super-chat',
  });
  const router = createMeetingRouter(rules);
  assert.equal(router.resolveChatId('BOND Daily Standup - 2026-07-04'), 'bond-chat');
  assert.equal(router.resolveChatId('Bond <> 0g Weekly Sync'), 'bond-chat');
  assert.equal(router.resolveChatId('ERN <> Nebula catch-up'), 'super-chat');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd webhook-service && node --test test/routing-table.test.js`
Expected: FAIL — current rules have no `company` field and no new patterns

- [ ] **Step 3: Update `routing-table.js`**

Replace the `buildRoutingRules` function in `webhook-service/src/routing-table.js` (keep the file's existing top comment and `assertOrderingIsSafe` function — both already correct and unchanged from the history plan):

```js
function buildRoutingRules(env) {
  return [
    { match: 'Bond <> Nebula', chatId: env.TELEGRAM_CHAT_BOND_NEBULA, seriesKey: 'BOND_NEBULA', company: 'BOND' },
    { match: 'Bond <> 0g Weekly Sync', chatId: env.TELEGRAM_CHAT_BOND_TEAM, seriesKey: 'BOND_TEAM', company: 'BOND' },
    { match: 'BOND Daily Standup', chatId: env.TELEGRAM_CHAT_BOND_TEAM, seriesKey: 'BOND_TEAM', company: 'BOND' },
    { match: 'Bond', chatId: env.TELEGRAM_CHAT_BOND_TEAM, seriesKey: 'BOND_TEAM', company: 'BOND' },
    { match: 'ERN Daily Executive Standup', chatId: env.TELEGRAM_CHAT_ERN_EXEC_STANDUP, seriesKey: 'ERN_EXEC_STANDUP', company: 'ERN' },
    { match: 'ERN <> Nebula', chatId: env.TELEGRAM_CHAT_ERN_SUPER_TEAM, seriesKey: 'ERN_SUPER_TEAM', company: 'ERN' },
    { match: 'ERN Daily Sync', chatId: env.TELEGRAM_CHAT_ERN_SUPER_TEAM, seriesKey: 'ERN_SUPER_TEAM', company: 'ERN' },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd webhook-service && node --test test/routing-table.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Add failing tests for `meeting-router.js`'s new `resolveCompany`**

Append to `webhook-service/test/meeting-router.test.js` (keep every existing test — including the `RULES_WITH_SERIES`/`resolveSeriesKey` tests already there from the history plan — add these at the end of the file):

```js
const RULES_WITH_COMPANY = [
    { match: 'Bond <> Nebula', chatId: 'bond-nebula-chat', seriesKey: 'BOND_NEBULA', company: 'BOND' },
    { match: 'Bond', chatId: 'bond-team-chat', seriesKey: 'BOND_TEAM', company: 'BOND' },
    { match: 'ERN Daily Sync', chatId: 'super-team-chat', seriesKey: 'ERN_SUPER_TEAM', company: 'ERN' },
];

test('resolveCompany resolves the most specific rule first, same ordering as resolveChatId/resolveSeriesKey', () => {
    const router = createMeetingRouter(RULES_WITH_COMPANY);
    assert.equal(router.resolveCompany('Bond <> Nebula weekly sync'), 'BOND');
    assert.equal(router.resolveCompany('Bond daily standup'), 'BOND');
    assert.equal(router.resolveCompany('ERN Daily Sync - 2026-07-04'), 'ERN');
});

test('resolveCompany returns null when no rule matches', () => {
    const router = createMeetingRouter(RULES_WITH_COMPANY);
    assert.equal(router.resolveCompany('Random 1:1'), null);
});

test('resolveCompany returns null when the matched rule has no company field (backward compatible)', () => {
    const router = createMeetingRouter(RULES);
    assert.equal(router.resolveCompany('Bond daily standup'), null);
});

test('resolveCompany and resolveSeriesKey coexist on the same rule without interfering', () => {
    const router = createMeetingRouter(RULES_WITH_COMPANY);
    assert.equal(router.resolveSeriesKey('Bond daily standup'), 'BOND_TEAM');
    assert.equal(router.resolveCompany('Bond daily standup'), 'BOND');
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd webhook-service && node --test test/meeting-router.test.js`
Expected: FAIL with `router.resolveCompany is not a function`

- [ ] **Step 7: Update `meeting-router.js`**

Replace the full contents of `webhook-service/src/meeting-router.js` (this adds `resolveCompany` alongside the existing `resolveSeriesKey` — do not remove it):

```js
// rules is an ORDERED array of { match, chatId, seriesKey, company }, checked
// most-specific-first. e.g. 'Bond <> Nebula' must precede 'Bond' so a Bond<>Nebula meeting
// doesn't fall into the looser Bond Team rule.
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

    // Same null-collapsing convention as resolveSeriesKey, but for company classification --
    // callers treat "no company from title" as "fall back to the content classifier."
    function resolveCompany(meetingTitle) {
        const rule = findRule(meetingTitle);
        return (rule && rule.company) || null;
    }

    return { resolveChatId, resolveSeriesKey, resolveCompany };
}

module.exports = { createMeetingRouter };
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd webhook-service && node --test test/meeting-router.test.js`
Expected: PASS, 12 tests (8 existing + 4 new)

- [ ] **Step 9: Run the full suite to confirm no regressions**

Run: `cd webhook-service && npm test`
Expected: PASS, 94 tests (90 from Task 3 + 1 new routing-table test + 4 new meeting-router tests, minus 1 since the first routing-table test was replaced not added = 90 + 1 + 4 - 1 + 1... run the suite and use the printed total as ground truth — the important check is 0 failures, including all pre-existing `resolveSeriesKey`/history-related tests).

- [ ] **Step 10: Commit**

```bash
cd "/Users/sraghavan/Documents/Claude/Projects/ERN Meeting Automation"
git add webhook-service/src/routing-table.js webhook-service/test/routing-table.test.js webhook-service/src/meeting-router.js webhook-service/test/meeting-router.test.js
git commit -m "Add company field + new Bond/ERN title patterns to routing table, add resolveCompany"
```

---

### Task 5: `fireflies-client.js` recording URL

**Files:**
- Modify: `webhook-service/src/fireflies-client.js`
- Modify: `webhook-service/test/fireflies-client.test.js`

**Interfaces:**
- Produces: `fetchSummary(meetingId)` result gains a `recordingUrl` field (`transcript.transcript_url`, `null` if absent). Task 7/8 pass this through to the To-Dos message.

- [ ] **Step 1: Add a failing test**

Append to `webhook-service/test/fireflies-client.test.js` (keep all existing tests, add at the end):

```js
test('includes recordingUrl from transcript_url when present', async () => {
  const summary = { overview: 'ov', action_items: 'ai' };
  const httpPost = async () => ({
    data: { data: { transcript: { title: 'Bond Daily Standup', summary, transcript_url: 'https://app.fireflies.ai/view/abc123' } } },
  });

  const client = createFirefliesClient({ apiKey: 'test-key', retries: 3, delayMs: 1, sleep: fakeSleep, httpPost });
  const result = await client.fetchSummary('meeting-recording');

  assert.equal(result.recordingUrl, 'https://app.fireflies.ai/view/abc123');
});

test('recordingUrl is null when transcript_url is absent', async () => {
  const summary = { overview: 'ov', action_items: 'ai' };
  const httpPost = async () => ({ data: { data: { transcript: { title: 'ERN Daily Sync', summary } } } });

  const client = createFirefliesClient({ apiKey: 'test-key', retries: 3, delayMs: 1, sleep: fakeSleep, httpPost });
  const result = await client.fetchSummary('meeting-no-recording');

  assert.equal(result.recordingUrl, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webhook-service && node --test test/fireflies-client.test.js`
Expected: FAIL — `result.recordingUrl` is `undefined`, not the expected value

- [ ] **Step 3: Update `fireflies-client.js`**

In `webhook-service/src/fireflies-client.js`, update `buildQuery` and the success branch inside `fetchSummary`:

```js
function buildQuery(meetingId) {
  return `query { transcript(id: "${meetingId}") { title transcript_url meeting_attendees { displayName } summary { action_items overview } } }`;
}
```

```js
      if (summary?.overview) {
        const attendees = (transcript.meeting_attendees ?? []).map((a) => a.displayName);
        return {
          title: transcript.title,
          attendees,
          overview: summary.overview,
          action_items: summary.action_items,
          recordingUrl: transcript.transcript_url ?? null,
        };
      }
```

- [ ] **Step 4: Update two existing tests' `assert.deepEqual` calls**

In the test `'returns the summary on the first successful call'`, change:
```js
  assert.deepEqual(result, { title: 'ERN Daily Sync', attendees: [], ...summary });
```
to:
```js
  assert.deepEqual(result, { title: 'ERN Daily Sync', attendees: [], recordingUrl: null, ...summary });
```

In the test `'does not call sleep after a successful attempt'`, change the same line the same way.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webhook-service && node --test test/fireflies-client.test.js`
Expected: PASS, 6 tests (4 existing + 2 new)

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `cd webhook-service && npm test`
Expected: PASS, 96 tests (94 from Task 4 + 2 new)

- [ ] **Step 7: Commit**

```bash
cd "/Users/sraghavan/Documents/Claude/Projects/ERN Meeting Automation"
git add webhook-service/src/fireflies-client.js webhook-service/test/fireflies-client.test.js
git commit -m "Fetch transcript_url from Fireflies as recordingUrl"
```

---

### Task 6: `summarizer.js` — merge company tone hint into the existing `seriesState` context, add SECTIONS/NEXT_STEPS, blockers, handoffs

**Files:**
- Modify: `webhook-service/src/summarizer.js`
- Modify: `webhook-service/test/summarizer.test.js`
- Modify: `webhook-service/test/summarizer-notifier-integration.test.js` (check first; update only what breaks)
- Modify: `webhook-service/src/handle-webhook.js` is NOT touched in this task — Task 8 updates its call site to match the new signature below. Do not update it here.

**Interfaces:**
- Consumes: `getProfile(company)` from Task 1.
- **Breaking change to the existing (already-committed) `simplify` signature:** the history plan added `simplify(summary, seriesState)`. This task changes the second parameter to an options object: `simplify(summary, context)` where `context = { seriesState, company }` (both optional keys, `context` itself optional). This resolves the collision between the history plan's `seriesState` argument and this plan's new `company` argument — there is only one second parameter now, carrying both. Task 8 depends on this exact shape and must pass `{ seriesState, company }`.
- Produces: return shape changes from `{ overview, action_items }` to `{ overview, sections, action_items, next_steps }`, where `sections` is `Array<{ emoji: string, header: string, bullets: string[] }>`.

- [ ] **Step 1: Check the integration test for coupling to the old format**

Run: `cat webhook-service/test/summarizer-notifier-integration.test.js`. If it hardcodes a fake Anthropic response using only `OVERVIEW:`/`ACTION_ITEMS:` markers, or calls `simplify(summary, seriesState)` positionally, note it — both will need updating in Step 9 below.

- [ ] **Step 2: Replace `summarizer.test.js`'s existing tests with the new format and context-object signature**

Replace the full contents of `webhook-service/test/summarizer.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSummarizer } = require('../src/summarizer');

function fakeResponse(text) {
  return { data: { content: [{ type: 'text', text }] } };
}

const FULL_RESPONSE = [
  'OVERVIEW:',
  'One condensed sentence.',
  '',
  'SECTIONS:',
  'EMOJI: 🛠',
  'HEADER: Engineering',
  'BULLETS:',
  '- Shipped the new API',
  '- ⚠️ Waiting on RE7 to confirm the schema',
  '',
  'ACTION_ITEMS:',
  '**Vinson Leow**',
  'Review the **July 15** deadline.',
  '',
  'NEXT_STEPS:',
  '- Prep for the board update next week',
].join('\n');

test('simplify() sends the raw summary to the Anthropic Messages API and parses all four condensed sections back out', async () => {
  const calls = [];
  const httpPost = async (url, body, config) => {
    calls.push({ url, body, config });
    return fakeResponse(FULL_RESPONSE);
  };

  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });
  const raw = { title: 'Meet', attendees: ['Vinson Leow'], overview: 'long overview...', action_items: 'long action items...' };

  const result = await summarizer.simplify(raw);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].config.headers['x-api-key'], 'test-key');
  assert.match(calls[0].body.messages[0].content, /long overview\.\.\./);
  assert.match(calls[0].body.messages[0].content, /long action items\.\.\./);

  assert.equal(result.overview, 'One condensed sentence.');
  assert.deepEqual(result.sections, [
    { emoji: '🛠', header: 'Engineering', bullets: ['Shipped the new API', '⚠️ Waiting on RE7 to confirm the schema'] },
  ]);
  assert.equal(result.action_items, '**Vinson Leow**\nReview the **July 15** deadline.');
  assert.equal(result.next_steps, 'Prep for the board update next week');
});

test('simplify() rejects when the API call fails, so the caller can fall back to the raw summary', async () => {
  const httpPost = async () => { throw new Error('network down'); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await assert.rejects(
    () => summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' }),
    /network down/
  );
});

test('simplify() finds the text block even when a "thinking" block precedes it in content[]', async () => {
  const httpPost = async () => ({
    data: { content: [{ type: 'thinking', thinking: '', signature: 'abc' }, { type: 'text', text: FULL_RESPONSE }] },
  });
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  const result = await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' });

  assert.equal(result.overview, 'One condensed sentence.');
});

test('simplify() rejects when the response text is missing the expected section markers', async () => {
  const httpPost = async () => fakeResponse('not the expected format');
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await assert.rejects(() => summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' }));
});

test('simplify() handles a SECTIONS block with multiple sections and an empty NEXT_STEPS', async () => {
  const text = [
    'OVERVIEW:', 'One.', '',
    'SECTIONS:',
    'EMOJI: 💰', 'HEADER: Market', 'BULLETS:', '- Deal closed',
    '',
    'EMOJI: 👥', 'HEADER: Team', 'BULLETS:', '- Hired one engineer',
    '',
    'ACTION_ITEMS:', '**Name**', 'Get the doc.', '',
    'NEXT_STEPS:', '- None noted this cycle.',
  ].join('\n');
  const httpPost = async () => fakeResponse(text);
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  const result = await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' });

  assert.equal(result.sections.length, 2);
  assert.deepEqual(result.sections[0], { emoji: '💰', header: 'Market', bullets: ['Deal closed'] });
  assert.deepEqual(result.sections[1], { emoji: '👥', header: 'Team', bullets: ['Hired one engineer'] });
  assert.equal(result.next_steps, 'None noted this cycle.');
});

test('simplify() sends a prompt banning semicolon-chained overview sentences, bare process verbs, and requiring TBC over guessed specificity', async () => {
  const calls = [];
  const httpPost = async (url, body) => { calls.push({ url, body }); return fakeResponse(FULL_RESPONSE); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' });

  const prompt = calls[0].body.messages[0].content;
  assert.match(prompt, /never chain multiple facts into one sentence with semicolons/);
  assert.match(prompt, /never a bare process verb alone \(discuss\/follow up\/coordinate\/review\)/);
  assert.match(prompt, /append "\(TBC\)"/);
  assert.match(prompt, /append "\(outcome: TBC\)"/);
});

test('simplify() sends a prompt requiring blockers to be flagged with the warning emoji', async () => {
  const calls = [];
  const httpPost = async (url, body) => { calls.push({ url, body }); return fakeResponse(FULL_RESPONSE); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' });

  const prompt = calls[0].body.messages[0].content;
  assert.match(prompt, /waiting on.*blocked by.*pending/i);
  assert.match(prompt, /⚠️/);
});

test('simplify() sends a prompt requiring a task to be reassigned to the new owner on a clear handoff', async () => {
  const calls = [];
  const httpPost = async (url, body) => { calls.push({ url, body }); return fakeResponse(FULL_RESPONSE); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' });

  const prompt = calls[0].body.messages[0].content;
  assert.match(prompt, /handoff/i);
  assert.match(prompt, /new owner/i);
});

test('simplify() includes prior open items and narrative in the prompt when context.seriesState is passed', async () => {
  const calls = [];
  const httpPost = async (url, body) => { calls.push({ body }); return fakeResponse(FULL_RESPONSE); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  const seriesState = { open_items: [{ text: 'Old item', assignee: 'B', status: 'open' }], narrative: 'Prior narrative text.' };
  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' }, { seriesState });

  const prompt = calls[0].body.messages[0].content;
  assert.match(prompt, /Old item/);
  assert.match(prompt, /Prior narrative text\./);
});

test('simplify() omits the series-context block entirely when context.seriesState is not passed (backward compatible)', async () => {
  const calls = [];
  const httpPost = async (url, body) => { calls.push({ body }); return fakeResponse(FULL_RESPONSE); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' });

  const prompt = calls[0].body.messages[0].content;
  assert.doesNotMatch(prompt, /Prior open items/);
});

test('simplify() includes the company tone hint in the prompt when context.company is passed', async () => {
  const calls = [];
  const httpPost = async (url, body) => { calls.push({ url, body }); return fakeResponse(FULL_RESPONSE); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' }, { company: 'BOND' });

  const prompt = calls[0].body.messages[0].content;
  assert.match(prompt, /semi-formal, highly execution-focused/);
});

test('simplify() omits any tone hint when no company is passed, and both context fields can be passed together', async () => {
  const calls = [];
  const httpPost = async (url, body) => { calls.push({ url, body }); return fakeResponse(FULL_RESPONSE); };
  const summarizer = createSummarizer({ apiKey: 'test-key', httpPost });

  await summarizer.simplify({ title: 'Meet', attendees: [], overview: 'ov', action_items: 'ai' }, { seriesState: { open_items: [], narrative: 'N.' } });

  const prompt = calls[0].body.messages[0].content;
  assert.doesNotMatch(prompt, /execution-focused/);
  assert.doesNotMatch(prompt, /decision-focused/);
  assert.match(prompt, /N\./);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd webhook-service && node --test test/summarizer.test.js`
Expected: FAIL — `parseResponse` doesn't yet understand `SECTIONS:`/`NEXT_STEPS:`, `buildPrompt` doesn't accept a `{ company }` key, second param is still positional `seriesState`

- [ ] **Step 4: Rewrite `summarizer.js`**

Replace the full contents of `webhook-service/src/summarizer.js`:

```js
const axios = require('axios');
const { BOLD_MARKER_SYNTAX_HINT } = require('./bold-marker');
const { getProfile } = require('./company-profiles');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const RULES = `Simplify this meeting summary. Respond with EXACTLY this format and nothing else:

OVERVIEW:
<no more than 3 sentences, one per distinct domain (e.g. market/strategy, engineering/product, operations/team); each sentence states exactly one fact/decision/status — never chain multiple facts into one sentence with semicolons; if a topic has several sub-facts, keep only the single most decision-relevant one and drop the rest; omit detail already covered in action items>

SECTIONS:
<one or more blocks, each exactly three lines (EMOJI:, HEADER:, BULLETS:), separated by a blank line between blocks:
EMOJI: <a single emoji matching the topic's nature, e.g. 💰 for market/finance, 🛠 for engineering/product, 👥 for team/ops>
HEADER: <short department/topic name, Title Case, e.g. "Engineering", "Marketing">
BULLETS: <one bullet per line starting with "- "; prefix a line with "⚠️ " (after the dash) when it describes a blocker — something explicitly waiting on, blocked by, or pending another person or event>
Group the meeting's actual topics into these sections; do not invent a section with no real content behind it.>

ACTION_ITEMS:
<grouped by assignee under a "**Name**" heading; each item opens with a deliverable verb naming what changes as a result (Get/Send/Confirm/Update/Schedule or similar) — never a bare process verb alone (discuss/follow up/coordinate/review) with no concrete outcome attached; prefix an item with "⚠️ " when it is blocked (waiting on/blocked by/pending another person or event); if this meeting's content shows a task's ownership was handed off from one person to another, list it under the NEW owner's heading, not the original owner's — this is a deliberate handoff reassignment, not an error; no timestamps; where two assignees share an overlapping task, merge it into one item noting joint ownership; if an item has no clear deadline, do not guess one — append "(TBC)"; if no concrete deliverable can be identified for an item, use the closest honest verb and append "(outcome: TBC)" rather than inventing specificity; ${BOLD_MARKER_SYNTAX_HINT}>

NEXT_STEPS:
<one or two bullet lines ("- " prefix) naming a broader team-level next step or upcoming milestone; if none is evident from this meeting, output exactly "- None noted this cycle.">`;

function buildPrompt({ title, attendees, overview, action_items }, context = {}) {
  const { seriesState, company } = context;

  const hasSeriesContext = seriesState && ((seriesState.open_items && seriesState.open_items.length) || seriesState.narrative);
  const seriesBlock = hasSeriesContext
    ? `\nPrior open items and narrative for this meeting series (for reference only -- you may note an item is recurring, but do not invent detail beyond what's here):\nOpen items:\n${JSON.stringify(seriesState.open_items ?? [], null, 2)}\nNarrative so far:\n${seriesState.narrative ?? ''}\n`
    : '';

  const profile = company ? getProfile(company) : null;
  const toneLine = profile ? `\nTone for this team: ${profile.tone}.\n` : '';

  return `${RULES}
${seriesBlock}${toneLine}
Meeting: ${title}
Attendees: ${(attendees ?? []).join(', ')}

Overview:
${overview}

Action Items:
${action_items}`;
}

function parseSections(sectionsText) {
  const blocks = sectionsText.trim().split(/\n\s*\n/).filter(Boolean);
  return blocks.map((block) => {
    const emojiMatch = block.match(/EMOJI:\s*(.+)/);
    const headerMatch = block.match(/HEADER:\s*(.+)/);
    const bulletsMatch = block.match(/BULLETS:\s*([\s\S]*)/);
    const bullets = (bulletsMatch ? bulletsMatch[1] : '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('-'))
      .map((line) => line.replace(/^-\s*/, ''));
    return {
      emoji: emojiMatch ? emojiMatch[1].trim() : '',
      header: headerMatch ? headerMatch[1].trim() : '',
      bullets,
    };
  });
}

function parseResponse(text) {
  const match = text.match(/OVERVIEW:\s*([\s\S]*?)\s*SECTIONS:\s*([\s\S]*?)\s*ACTION_ITEMS:\s*([\s\S]*?)\s*NEXT_STEPS:\s*([\s\S]*)/);
  if (!match) {
    throw new Error('summarizer response did not contain the expected OVERVIEW:/SECTIONS:/ACTION_ITEMS:/NEXT_STEPS: sections');
  }
  const [, overview, sectionsText, action_items, next_steps] = match;
  return {
    overview: overview.trim(),
    sections: parseSections(sectionsText),
    action_items: action_items.trim(),
    next_steps: next_steps.trim(),
  };
}

function defaultHttpPost(url, body, config) {
  return axios.post(url, body, config);
}

function createSummarizer({ apiKey, model = 'claude-sonnet-5', maxTokens = 1024, httpPost = defaultHttpPost }) {
  // context: { seriesState, company }, both optional -- see docs/superpowers/plans/
  // 2026-07-04-fireflies-telegram-notetaker.md Task 6 for why this replaced the
  // meeting-history plan's positional `seriesState` second parameter.
  async function simplify(summary, context) {
    const response = await httpPost(
      ANTHROPIC_URL,
      { model, max_tokens: maxTokens, messages: [{ role: 'user', content: buildPrompt(summary, context) }] },
      { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
    );

    const text = response?.data?.content?.find((block) => block.type === 'text')?.text;
    if (!text) {
      throw new Error('summarizer response had no text content');
    }
    return parseResponse(text);
  }

  return { simplify };
}

module.exports = { createSummarizer };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webhook-service && node --test test/summarizer.test.js`
Expected: PASS, 12 tests

- [ ] **Step 6: Check and, if needed, update `summarizer-notifier-integration.test.js`**

If Step 1 found this test uses the old 2-section fake response or calls `simplify(summary, seriesState)` positionally, update both: use the `FULL_RESPONSE`-style 4-section fake text, and change the call to `simplify(summary, { seriesState })` (or `{}` if it wasn't testing series continuity). Run `cd webhook-service && node --test test/summarizer-notifier-integration.test.js` and fix until it passes. If its assertions check a single combined Telegram message body, leave a note that Task 7 will revisit them once `notifier.js` gains the two new formatting functions — don't block this task on Task 7's not-yet-built functions.

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run: `cd webhook-service && npm test`
Expected: PASS, 101 tests (96 from Task 5 + 5 new summarizer tests: original file had 7 tests — 5 base + 2 seriesState — now 12, net +5).

- [ ] **Step 8: Commit**

```bash
cd "/Users/sraghavan/Documents/Claude/Projects/ERN Meeting Automation"
git add webhook-service/src/summarizer.js webhook-service/test/summarizer.test.js webhook-service/test/summarizer-notifier-integration.test.js
git commit -m "Summarizer: merge company tone hint into context object, add SECTIONS/NEXT_STEPS, blocker + handoff detection"
```

---

### Task 7: `notifier.js` — Agenda/Overview + To-Dos messages

**Files:**
- Modify: `webhook-service/src/notifier.js`
- Modify: `webhook-service/test/notifier.test.js`

**Interfaces:**
- Consumes: `linkifyBoldNames` (Task 3), `toHtmlBold` (existing `bold-marker.js`), `getProfile` (Task 1).
- Produces: `createNotifier(...)` gains `notifyAgendaOverviewTo(chatId, summary): Promise<void>` and `notifyTodosTo(chatId, summary): Promise<void>`, where `summary` is the post-`simplifyOrFallback` shape (`{ title, attendees, overview, sections?, action_items, next_steps?, recordingUrl? }`). `notifyUnrouted` gains a new 4th parameter `company: string | null`. `notifySummaryTo` (existing, single-message) is left in place — still used as-is by `formatSummaryBody`/`notifyUnrouted`'s safety-net path — not called by the main routed success path after Task 8. Task 8 depends on all of these exact signatures.

- [ ] **Step 1: Add failing tests**

In `webhook-service/test/notifier.test.js`, replace the existing `notifyUnrouted` test with two tests, and add the new tests at the end of the file:

```js
test('notifyUnrouted posts to unroutedChatId (not opsChatId) with the meeting title, summary, and guessed company when given', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };

    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', unroutedChatId: 'super-team-chat', httpPost });
    const summary = { title: 'Random 1:1', overview: 'ov', action_items: 'ai' };
    await notifier.notifyUnrouted('meeting-7', 'Random 1:1', summary, 'BOND');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.chat_id, 'super-team-chat');
    assert.match(calls[0].body.text, /Random 1:1/);
    assert.match(calls[0].body.text, /meeting-7/);
    assert.match(calls[0].body.text, /ov/);
    assert.match(calls[0].body.text, /classified as Bond by content/);
    assert.equal(calls[0].body.parse_mode, 'HTML');
});

test('notifyUnrouted omits the classification note when no company is guessed', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };

    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', unroutedChatId: 'super-team-chat', httpPost });
    const summary = { title: 'Random 1:1', overview: 'ov', action_items: 'ai' };
    await notifier.notifyUnrouted('meeting-8', 'Random 1:1', summary, null);

    assert.doesNotMatch(calls[0].body.text, /classified as/);
});

test('notifyAgendaOverviewTo renders the title, overview, and section blocks with emoji/bold headers and bullets', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };
    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });

    const summary = {
        title: 'Bond Daily Standup',
        overview: 'Ship X progressed.',
        sections: [{ emoji: '🛠', header: 'Engineering', bullets: ['Shipped the API', '⚠️ Waiting on RE7'] }],
    };
    await notifier.notifyAgendaOverviewTo('chat-1', summary);

    const { text } = calls[0].body;
    assert.match(text, /Bond Daily Standup/);
    assert.match(text, /Ship X progressed\./);
    assert.match(text, /<b>Engineering<\/b>/);
    assert.match(text, /• Shipped the API/);
    assert.match(text, /• ⚠️ Waiting on RE7/);
    assert.equal(calls[0].body.parse_mode, 'HTML');
});

test('notifyAgendaOverviewTo renders overview-only when sections is absent (raw-fallback case)', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };
    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });

    await notifier.notifyAgendaOverviewTo('chat-1', { title: 'ERN Daily Sync', overview: 'Raw overview text.' });

    const { text } = calls[0].body;
    assert.match(text, /Raw overview text\./);
});

test('notifyAgendaOverviewTo escapes HTML special characters in overview and section bullets', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };
    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });

    await notifier.notifyAgendaOverviewTo('chat-1', {
        title: 'T', overview: 'A <script> & things', sections: [{ emoji: '👥', header: 'Team', bullets: ['<b>raw</b> tag'] }],
    });

    const { text } = calls[0].body;
    assert.match(text, /A &lt;script&gt; &amp; things/);
    assert.doesNotMatch(text, /<script>/);
});

test('notifyTodosTo groups action items, converts assignee names to handles, and includes the recording link', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };
    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });

    await notifier.notifyTodosTo('chat-1', {
        title: 'Bond Daily Standup',
        action_items: '**Vinson Leow**\n⚠️ Get the doc.',
        next_steps: 'Prep board update',
        recordingUrl: 'https://app.fireflies.ai/view/abc123',
    });

    const { text } = calls[0].body;
    assert.match(text, /<b>@vinsonleow<\/b>/);
    assert.match(text, /⚠️ Get the doc\./);
    assert.match(text, /Prep board update/);
    assert.match(text, /https:\/\/app\.fireflies\.ai\/view\/abc123/);
});

test('notifyTodosTo omits the recording line and Next Steps section when absent', async () => {
    const calls = [];
    const httpPost = async (url, body) => { calls.push({ url, body }); };
    const notifier = createNotifier({ botToken: 'test-token', opsChatId: 'ops-1', httpPost });

    await notifier.notifyTodosTo('chat-1', { title: 'T', action_items: '**Name**\nGet the doc.' });

    const { text } = calls[0].body;
    assert.doesNotMatch(text, /Recording/);
    assert.doesNotMatch(text, /Next Steps/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webhook-service && node --test test/notifier.test.js`
Expected: FAIL — `notifyAgendaOverviewTo`/`notifyTodosTo` are not functions, `notifyUnrouted` doesn't accept/use a 4th argument

- [ ] **Step 3: Update `notifier.js`**

Replace the full contents of `webhook-service/src/notifier.js`:

```js
const axios = require('axios');
const { handleFor, linkifyBoldNames } = require('./attendee-handles');
const { toHtmlBold } = require('./bold-marker');
const { getProfile } = require('./company-profiles');

function defaultHttpPost(url, body, config) {
    return axios.post(url, body, config);
}

function escapeHtml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Escapes third-party text first, then converts **bold** markers into <b> tags via the shared
// bold-marker.js contract — the only way bold reaches Telegram, since we never trust raw HTML
// from Fireflies or the summarizer.
function withBoldMarkers(text) {
    return toHtmlBold(escapeHtml(text));
}

function formatSummaryBody(summary) {
    const mentions = (summary.attendees ?? []).map(handleFor).map(escapeHtml).join(' ');
    const mentionsLine = mentions ? `${mentions}\n` : '';
    return `Hey guys please find here the meeting summary for today. Please lmk if anything's missing.\n${mentionsLine}${escapeHtml(summary.title)} Summary\n\nOverview:\n${withBoldMarkers(summary.overview)}\n\nAction Items:\n${withBoldMarkers(summary.action_items)}`;
}

// Message 2 of the post-meeting pair: title, overview, then one block per summarizer section
// (department/topic, emoji + bold header, bulleted lines). `sections` is absent whenever the
// summarizer didn't run (raw Fireflies fallback) — in that case this renders overview-only,
// matching today's simpler behavior rather than forcing an empty Sections block.
function formatAgendaOverviewBody(summary) {
    const header = `📋 <b>${escapeHtml(summary.title)} Update</b>\n\n---\n\n📌 <b>Overview</b>\n${withBoldMarkers(summary.overview)}`;
    if (!summary.sections || summary.sections.length === 0) return header;

    const sectionBlocks = summary.sections.map((section) => {
        const bullets = section.bullets.map((bullet) => `• ${withBoldMarkers(bullet)}`).join('\n');
        return `\n\n---\n\n${escapeHtml(section.emoji)} <b>${escapeHtml(section.header)}</b>\n${bullets}`;
    }).join('');

    return `${header}${sectionBlocks}`;
}

// Message 3 of the post-meeting pair: action items (assignee names converted to @handles),
// recording link (when Fireflies gave us one), Next Steps (when the summarizer produced one).
function formatTodosBody(summary) {
    const itemsBlock = withBoldMarkers(linkifyBoldNames(summary.action_items));
    const recordingLine = summary.recordingUrl
        ? `\n\n---\n\n🎥 <b>Recording</b>\n${escapeHtml(summary.recordingUrl)}`
        : '';
    const nextStepsLines = (summary.next_steps ?? '')
        .split('\n')
        .map((line) => line.trim().replace(/^-\s*/, ''))
        .filter(Boolean)
        .map((line) => `• ${withBoldMarkers(line)}`)
        .join('\n');
    const nextStepsBlock = nextStepsLines ? `\n\n---\n\n🔜 <b>Next Steps</b>\n${nextStepsLines}` : '';

    return `✅ <b>Action Items</b>\n\n---\n\n${itemsBlock}${recordingLine}${nextStepsBlock}`;
}

function createNotifier({ botToken, opsChatId, unroutedChatId, httpPost = defaultHttpPost }) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    function send(chatId, text, parseMode = 'HTML') {
        const body = { chat_id: chatId, text };
        if (parseMode) body.parse_mode = parseMode;
        return httpPost(url, body);
    }

    async function notifySummaryTo(chatId, summary) {
        await send(chatId, formatSummaryBody(summary));
    }

    async function notifyAgendaOverviewTo(chatId, summary) {
        await send(chatId, formatAgendaOverviewBody(summary));
    }

    async function notifyTodosTo(chatId, summary) {
        await send(chatId, formatTodosBody(summary));
    }

    // Relay path for the pre-meeting Cloud Routine (see ADR-0004): the routine composes plain
    // text itself and never gets the bot token, so this sends it verbatim with no parse_mode.
    async function sendPlainText(chatId, text) {
        await send(chatId, text, null);
    }

    async function notifyOpsFailure(meetingId, reason) {
        await send(opsChatId, `Error processing meeting ${escapeHtml(meetingId)}: ${escapeHtml(reason)}`);
    }

    async function notifyUnrouted(meetingId, meetingTitle, summary, company) {
        const profile = company ? getProfile(company) : null;
        const classificationNote = profile
            ? ` (title didn't match a known series, classified as ${profile.label} by content)`
            : '';
        const text = `No routing match for meeting "${escapeHtml(meetingTitle)}" (${escapeHtml(meetingId)})${escapeHtml(classificationNote)} — sending summary here instead.\n\n${formatSummaryBody(summary)}`;
        await send(unroutedChatId, text);
    }

    return { notifySummaryTo, notifyAgendaOverviewTo, notifyTodosTo, notifyOpsFailure, notifyUnrouted, sendPlainText };
}

module.exports = { createNotifier };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webhook-service && node --test test/notifier.test.js`
Expected: PASS, 12 tests (6 existing, with the `notifyUnrouted` test replaced by 2, + 5 new formatting tests = 6 - 1 + 2 + 5).

- [ ] **Step 5: Fix `summarizer-notifier-integration.test.js` if Task 6 deferred it**

If Task 6's Step 6 left a note deferring this test, now update it to call `notifyAgendaOverviewTo`/`notifyTodosTo` with a real `summarizer.simplify()` output, confirming the two modules agree on the `sections`/`next_steps` shape end-to-end. Run `cd webhook-service && node --test test/summarizer-notifier-integration.test.js` until it passes.

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `cd webhook-service && npm test`
Expected: PASS, 107 tests (101 from Task 6 + 6 new: the unrouted-test split nets +1, plus 5 new format tests).

- [ ] **Step 7: Commit**

```bash
cd "/Users/sraghavan/Documents/Claude/Projects/ERN Meeting Automation"
git add webhook-service/src/notifier.js webhook-service/test/notifier.test.js webhook-service/test/summarizer-notifier-integration.test.js
git commit -m "Notifier: add Agenda/Overview + To-Dos message formatting, company-aware unrouted notice"
```

---

### Task 8: Merge company resolution + dual independent sends into `handle-webhook.js` (already carries history-tracking logic)

**Files:**
- Modify: `webhook-service/src/handle-webhook.js`
- Modify: `webhook-service/test/handle-webhook.test.js`

**Interfaces:**
- Consumes: `meetingRouter.resolveCompany`/`resolveSeriesKey` (Task 4/existing), `companyClassifier.classify` (Task 2), `summarizer.simplify(summary, { seriesState, company })` (Task 6), `notifier.notifyAgendaOverviewTo`/`notifyTodosTo`/`notifyUnrouted(..., company)` (Task 7), and the existing `meetingHistory`/`historyConsolidator` deps and their call pattern (`consolidateHistoryBestEffort`, `fetchSeriesStateOrNull`) — **do not remove or weaken any of the existing history-tracking behavior**, this task adds to it.
- Produces: `handleFirefliesWebhook(event, deps)` gains one new **optional** dep: `companyClassifier`. Task 9 depends on `createApp` accepting and forwarding this same param.

- [ ] **Step 1: Replace `handle-webhook.test.js`'s `fakeDeps` and every test that referenced `notifySummaryTo`, then add new tests**

Replace the full contents of `webhook-service/test/handle-webhook.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { handleFirefliesWebhook } = require('../src/handle-webhook');
const { createSeenMeetings } = require('../src/seen-meetings');
const { createMeetingRouter } = require('../src/meeting-router');

function fakeDeps({ summary = { title: 'ERN Daily Sync', overview: 'ov', action_items: 'ai' }, fetchSummaryImpl, meetingRouter, companyClassifier } = {}) {
    const calls = { fetchSummary: 0, notifyAgendaOverviewTo: 0, notifyTodosTo: 0, notifyOpsFailure: 0, notifyUnrouted: 0 };
    const firefliesClient = {
        fetchSummary: async (meetingId) => {
            calls.fetchSummary += 1;
            if (fetchSummaryImpl) return fetchSummaryImpl(meetingId);
            return summary;
        },
    };
    const notifier = {
        notifyAgendaOverviewTo: async () => { calls.notifyAgendaOverviewTo += 1; },
        notifyTodosTo: async () => { calls.notifyTodosTo += 1; },
        notifyOpsFailure: async () => { calls.notifyOpsFailure += 1; },
        notifyUnrouted: async () => { calls.notifyUnrouted += 1; },
    };
    const seenMeetings = createSeenMeetings();
    const router = meetingRouter || createMeetingRouter([{ match: 'ERN Daily Sync', chatId: 'super-team-chat', company: 'ERN' }]);
    return { firefliesClient, notifier, seenMeetings, meetingRouter: router, companyClassifier, calls };
}

test('ignores events that are not "meeting.summarized"', async () => {
    const deps = fakeDeps();
    const result = await handleFirefliesWebhook({ eventType: 'Something else', meetingId: 'm1' }, deps);
    assert.deepEqual(result, { status: 'ignored', meetingId: 'm1' });
    assert.equal(deps.calls.fetchSummary, 0);
});

test('returns duplicate on a second call for the same meetingId without calling firefliesClient again', async () => {
    const deps = fakeDeps();
    const event = { eventType: 'meeting.summarized', meetingId: 'm1' };

    const first = await handleFirefliesWebhook(event, deps);
    assert.equal(first.status, 'processed');
    assert.equal(deps.calls.fetchSummary, 1);

    const second = await handleFirefliesWebhook(event, deps);
    assert.deepEqual(second, { status: 'duplicate', meetingId: 'm1' });
    assert.equal(deps.calls.fetchSummary, 1, 'firefliesClient should not be called again');
});

test('sends both the Agenda/Overview and To-Dos messages to the routed chat on success', async () => {
    const deps = fakeDeps({ summary: { title: 'ERN Daily Sync', overview: 'ov', action_items: 'ai' } });
    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm2' }, deps);
    assert.equal(result.status, 'processed');
    assert.equal(deps.calls.notifyAgendaOverviewTo, 1);
    assert.equal(deps.calls.notifyTodosTo, 1);
    assert.equal(deps.calls.notifyOpsFailure, 0);
    assert.equal(deps.calls.notifyUnrouted, 0);
});

test('calls notifier.notifyOpsFailure when fetchSummary resolves null', async () => {
    const deps = fakeDeps({ fetchSummaryImpl: async () => null });
    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm3' }, deps);
    assert.equal(result.status, 'failed');
    assert.equal(deps.calls.notifyOpsFailure, 1);
    assert.equal(deps.calls.notifyAgendaOverviewTo, 0);
    assert.equal(deps.calls.notifyTodosTo, 0);
});

test('calls notifier.notifyOpsFailure when fetchSummary throws', async () => {
    const deps = fakeDeps({ fetchSummaryImpl: async () => { throw new Error('boom'); } });
    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm4' }, deps);
    assert.equal(result.status, 'failed');
    assert.equal(deps.calls.notifyOpsFailure, 1);
});

test('calls notifier.notifyUnrouted when no routing rule matches the meeting title', async () => {
    const deps = fakeDeps({ summary: { title: 'Random 1:1', overview: 'ov', action_items: 'ai' } });
    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm5' }, deps);
    assert.equal(result.status, 'unrouted');
    assert.equal(deps.calls.notifyUnrouted, 1);
    assert.equal(deps.calls.notifyAgendaOverviewTo, 0);
    assert.equal(deps.calls.notifyOpsFailure, 0);
});

test('uses the summarizer to simplify the summary before notifying, when a summarizer is provided', async () => {
    const deps = fakeDeps({ summary: { title: 'ERN Daily Sync', attendees: ['A'], overview: 'long overview', action_items: 'long items' } });
    let notifiedOverview, notifiedTodos;
    deps.notifier.notifyAgendaOverviewTo = async (chatId, summary) => { deps.calls.notifyAgendaOverviewTo += 1; notifiedOverview = summary; };
    deps.notifier.notifyTodosTo = async (chatId, summary) => { deps.calls.notifyTodosTo += 1; notifiedTodos = summary; };
    const summarizer = { simplify: async () => ({ overview: 'short overview', sections: [], action_items: 'short items', next_steps: '' }) };

    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm6' }, { ...deps, summarizer });

    assert.equal(result.status, 'processed');
    assert.equal(notifiedOverview.overview, 'short overview');
    assert.equal(notifiedTodos.action_items, 'short items');
    assert.equal(notifiedOverview.title, 'ERN Daily Sync', 'title/attendees should pass through unchanged');
});

test('falls back to the raw summary when the summarizer throws', async () => {
    const deps = fakeDeps({ summary: { title: 'ERN Daily Sync', overview: 'long overview', action_items: 'long items' } });
    let notifiedOverview, notifiedTodos;
    deps.notifier.notifyAgendaOverviewTo = async (chatId, summary) => { deps.calls.notifyAgendaOverviewTo += 1; notifiedOverview = summary; };
    deps.notifier.notifyTodosTo = async (chatId, summary) => { deps.calls.notifyTodosTo += 1; notifiedTodos = summary; };
    const summarizer = { simplify: async () => { throw new Error('anthropic api down'); } };

    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm7' }, { ...deps, summarizer });

    assert.equal(result.status, 'processed');
    assert.equal(notifiedOverview.overview, 'long overview');
    assert.equal(notifiedTodos.action_items, 'long items');
    assert.equal(deps.calls.notifyOpsFailure, 0, 'a summarizer failure must not be treated as a processing failure');
});

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

test('fetches series state, passes it to the summarizer as context.seriesState, and writes updated history when the meeting has a seriesKey', async () => {
    const router = createMeetingRouter([{ match: 'Bond Daily', chatId: 'bond-chat', seriesKey: 'BOND_TEAM', company: 'BOND' }]);
    const deps = fakeDeps({ summary: { title: 'Bond Daily', attendees: ['A'], overview: 'raw ov', action_items: 'raw ai' }, meetingRouter: router });

    const historyCalls = { getSeriesState: [], appendHistory: [], upsertSeriesState: [] };
    const meetingHistory = {
        getSeriesState: async (seriesKey) => { historyCalls.getSeriesState.push(seriesKey); return { open_items: [{ text: 'Old', status: 'open' }], narrative: 'Prior narrative.' }; },
        appendHistory: async (row) => { historyCalls.appendHistory.push(row); },
        upsertSeriesState: async (seriesKey, state) => { historyCalls.upsertSeriesState.push({ seriesKey, state }); },
    };

    let summarizerCalledWith;
    const summarizer = { simplify: async (summary, context) => { summarizerCalledWith = { summary, context }; return { overview: 'condensed ov', sections: [], action_items: 'condensed ai', next_steps: '' }; } };

    const historyConsolidator = { consolidate: async ({ seriesState, meeting }) => ({ open_items: [{ text: 'Old', status: 'closed', closed_reason: 'done' }], narrative: 'Updated narrative.' }) };

    const result = await handleFirefliesWebhook(
        { eventType: 'meeting.summarized', meetingId: 'm9' },
        { ...deps, summarizer, meetingHistory, historyConsolidator }
    );

    assert.equal(result.status, 'processed');
    assert.deepEqual(historyCalls.getSeriesState, ['BOND_TEAM']);
    assert.deepEqual(summarizerCalledWith.context.seriesState, { open_items: [{ text: 'Old', status: 'open' }], narrative: 'Prior narrative.' });
    assert.equal(summarizerCalledWith.context.company, 'BOND');

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
    const router = createMeetingRouter([{ match: 'Bond Daily', chatId: 'bond-chat', seriesKey: 'BOND_TEAM', company: 'BOND' }]);
    const deps = fakeDeps({ summary: { title: 'Bond Daily', overview: 'ov', action_items: 'ai' }, meetingRouter: router });

    const meetingHistory = { getSeriesState: async () => { throw new Error('supabase down'); }, appendHistory: async () => {}, upsertSeriesState: async () => {} };
    let summarizerCalledWithContext;
    const summarizer = { simplify: async (summary, context) => { summarizerCalledWithContext = context; return { overview: 'ov', sections: [], action_items: 'ai', next_steps: '' }; } };

    const result = await handleFirefliesWebhook(
        { eventType: 'meeting.summarized', meetingId: 'm10' },
        { ...deps, summarizer, meetingHistory, historyConsolidator: { consolidate: async () => ({ open_items: [], narrative: '' }) } }
    );

    assert.equal(result.status, 'processed');
    assert.equal(deps.calls.notifyOpsFailure, 0);
    assert.equal(summarizerCalledWithContext.seriesState, null);
});

test('a historyConsolidator failure does not block the summary, does not call notifyOpsFailure, and skips the history write', async () => {
    const router = createMeetingRouter([{ match: 'Bond Daily', chatId: 'bond-chat', seriesKey: 'BOND_TEAM', company: 'BOND' }]);
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
    assert.equal(deps.calls.notifyAgendaOverviewTo, 1);
    assert.equal(deps.calls.notifyTodosTo, 1);
    assert.equal(deps.calls.notifyOpsFailure, 0);
    assert.equal(historyCalls.appendHistory, 0);
    assert.equal(historyCalls.upsertSeriesState, 0);
});

test('resolves company via the routing table and passes it to the summarizer', async () => {
    const router = createMeetingRouter([{ match: 'Bond Daily', chatId: 'bond-chat', company: 'BOND' }]);
    const deps = fakeDeps({ summary: { title: 'Bond Daily Standup', overview: 'ov', action_items: 'ai' }, meetingRouter: router });
    let summarizerCalledWithCompany;
    const summarizer = { simplify: async (summary, context) => { summarizerCalledWithCompany = context.company; return { overview: 'ov', sections: [], action_items: 'ai', next_steps: '' }; } };

    await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm12' }, { ...deps, summarizer });

    assert.equal(summarizerCalledWithCompany, 'BOND');
});

test('falls back to the content classifier for company when the title has no routing match, but still routes to notifyUnrouted', async () => {
    const router = createMeetingRouter([{ match: 'ERN Daily Sync', chatId: 'super-team-chat', company: 'ERN' }]);
    const summary = { title: 'Ad Hoc Bond Sync', overview: 'Discussed TVL and RE7 API.', action_items: 'ai' };
    const deps = fakeDeps({ summary, meetingRouter: router });
    let unroutedCompany;
    deps.notifier.notifyUnrouted = async (meetingId, title, s, company) => { deps.calls.notifyUnrouted += 1; unroutedCompany = company; };
    const companyClassifier = { classify: () => 'BOND' };

    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm13' }, { ...deps, companyClassifier });

    assert.equal(result.status, 'unrouted');
    assert.equal(unroutedCompany, 'BOND');
});

test('both post-meeting messages are attempted independently — a failure in one does not block the other', async () => {
    const deps = fakeDeps({ summary: { title: 'ERN Daily Sync', overview: 'ov', action_items: 'ai' } });
    deps.notifier.notifyAgendaOverviewTo = async () => { deps.calls.notifyAgendaOverviewTo += 1; throw new Error('telegram down'); };
    deps.notifier.notifyTodosTo = async () => { deps.calls.notifyTodosTo += 1; };

    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm14' }, deps);

    assert.equal(result.status, 'processed');
    assert.equal(deps.calls.notifyAgendaOverviewTo, 1);
    assert.equal(deps.calls.notifyTodosTo, 1, 'the To-Dos send must still be attempted even though Agenda/Overview failed');
    assert.equal(deps.calls.notifyOpsFailure, 1, 'the partial failure must be reported to ops');
});

test('the reverse partial failure (To-Dos fails, Agenda/Overview succeeds) is also both-attempted and reported', async () => {
    const deps = fakeDeps({ summary: { title: 'ERN Daily Sync', overview: 'ov', action_items: 'ai' } });
    deps.notifier.notifyAgendaOverviewTo = async () => { deps.calls.notifyAgendaOverviewTo += 1; };
    deps.notifier.notifyTodosTo = async () => { deps.calls.notifyTodosTo += 1; throw new Error('telegram down'); };

    const result = await handleFirefliesWebhook({ eventType: 'meeting.summarized', meetingId: 'm15' }, deps);

    assert.equal(result.status, 'processed');
    assert.equal(deps.calls.notifyAgendaOverviewTo, 1);
    assert.equal(deps.calls.notifyTodosTo, 1);
    assert.equal(deps.calls.notifyOpsFailure, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webhook-service && node --test test/handle-webhook.test.js`
Expected: FAIL — `handleFirefliesWebhook` doesn't yet call `notifyAgendaOverviewTo`/`notifyTodosTo`, doesn't resolve company, doesn't pass a context object to the summarizer

- [ ] **Step 3: Rewrite `handle-webhook.js`**

Replace the full contents of `webhook-service/src/handle-webhook.js` (this merges the existing history-tracking logic with company resolution and the dual independent sends — every existing history behavior is preserved):

```js
// Fireflies Webhooks V2 event name (the V1 name, 'Transcription completed', is legacy —
// see app.js for the V2 payload-field translation: `event`/`meeting_id` -> `eventType`/`meetingId`).
const MEETING_SUMMARIZED = 'meeting.summarized';

async function simplifyOrFallback(summarizer, summary, context) {
    if (!summarizer) {
        return summary;
    }
    try {
        const simplified = await summarizer.simplify(summary, context);
        return { ...summary, ...simplified };
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

// Title match is authoritative (routing-table.js); the content classifier only ever fills in
// when there was no title match at all — it never overrides a real routing decision.
function resolveCompany(meetingRouter, companyClassifier, rawSummary) {
    const fromTitle = meetingRouter.resolveCompany(rawSummary.title);
    if (fromTitle) return fromTitle;
    return companyClassifier ? companyClassifier.classify(rawSummary) : null;
}

// Both post-meeting messages are attempted regardless of whether the other fails — a Telegram
// hiccup on one must not silently drop the other. Any failure is reported to ops without
// changing the overall 'processed' result, since the pipeline itself completed correctly.
async function sendPostMeetingMessages(notifier, chatId, summary, meetingId) {
    const results = await Promise.allSettled([
        notifier.notifyAgendaOverviewTo(chatId, summary),
        notifier.notifyTodosTo(chatId, summary),
    ]);
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
        const reasons = failures.map((r) => r.reason?.message ?? String(r.reason)).join('; ');
        await notifier.notifyOpsFailure(meetingId, `one or more post-meeting messages failed: ${reasons}`).catch(() => {});
    }
}

// Best-effort: runs only after the post-meeting messages have already been sent, so a failure
// here must never surface as notifyOpsFailure or affect what was already sent (ADR-0003's "a
// degraded feature is not an ops failure" precedent, extended to this second automatic model call).
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

async function handleFirefliesWebhook({ eventType, meetingId }, { firefliesClient, notifier, seenMeetings, meetingRouter, summarizer, companyClassifier, meetingHistory, historyConsolidator }) {
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
        const company = resolveCompany(meetingRouter, companyClassifier, rawSummary);

        const summary = await simplifyOrFallback(summarizer, rawSummary, { seriesState, company });

        const chatId = meetingRouter.resolveChatId(summary.title);
        if (!chatId) {
            await notifier.notifyUnrouted(meetingId, summary.title, summary, company);
            return { status: 'unrouted', meetingId };
        }

        await sendPostMeetingMessages(notifier, chatId, summary, meetingId);

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webhook-service && node --test test/handle-webhook.test.js`
Expected: PASS, 16 tests

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `cd webhook-service && npm test`
Expected: PASS, 111 tests (107 from Task 7 + 4 new: 12 existing handle-webhook tests grew to 16, net +4).

- [ ] **Step 6: Commit**

```bash
cd "/Users/sraghavan/Documents/Claude/Projects/ERN Meeting Automation"
git add webhook-service/src/handle-webhook.js webhook-service/test/handle-webhook.test.js
git commit -m "Merge company resolution + independent dual post-meeting sends into handle-webhook.js (preserves history tracking)"
```

---

### Task 9: `app.js` + `index.js` wiring (adds to the existing `meetingHistory`/`historyConsolidator` wiring)

**Files:**
- Modify: `webhook-service/src/app.js`
- Modify: `webhook-service/test/app.test.js`
- Modify: `webhook-service/index.js`

**Interfaces:**
- Consumes: `createCompanyClassifier` (Task 2), `handleFirefliesWebhook`'s new `companyClassifier` dep (Task 8).
- Produces: nothing further downstream — final wiring task.

- [ ] **Step 1: Update `app.js`**

In `webhook-service/src/app.js`, add `companyClassifier` to `createApp`'s destructured params (alongside the existing `meetingHistory`, `historyConsolidator`) and forward it in the call to `handleFirefliesWebhook`:

```js
function createApp({ secret, relaySecret, firefliesClient, notifier, seenMeetings, meetingRouter, summarizer, companyClassifier, meetingHistory, historyConsolidator, relayChatMap, onProcessed }) {
```

```js
        const { event, meeting_id: meetingId } = req.body ?? {};
        const result = await handleFirefliesWebhook(
            { eventType: event, meetingId },
            { firefliesClient, notifier, seenMeetings, meetingRouter, summarizer, companyClassifier, meetingHistory, historyConsolidator }
        );
        if (onProcessed) onProcessed(result);
```

(Everything else in `app.js` stays unchanged.)

- [ ] **Step 2: Update `app.test.js`'s fake notifier and the first smoke test**

In `webhook-service/test/app.test.js`, update `startTestServer`'s fake `notifier` object to include the two new methods (drop `notifySummaryTo` from the fake — it's no longer called by the webhook path):

```js
    const calls = { notifyAgendaOverviewTo: [], notifyTodosTo: [], notifyOpsFailure: [], notifyUnrouted: [], sendPlainText: [] };
    const firefliesClient = {
        fetchSummary: fetchSummaryImpl || (async () => ({ title: ROUTED_TITLE, overview: 'ov', action_items: 'ai' })),
    };
    const notifier = {
        notifyAgendaOverviewTo: async (chatId, summary) => { calls.notifyAgendaOverviewTo.push({ chatId, summary }); },
        notifyTodosTo: async (chatId, summary) => { calls.notifyTodosTo.push({ chatId, summary }); },
        notifyOpsFailure: async (meetingId, reason) => { calls.notifyOpsFailure.push({ meetingId, reason }); },
        notifyUnrouted: async (meetingId, title, summary, company) => { calls.notifyUnrouted.push({ meetingId, title, summary, company }); },
        sendPlainText: async (chatId, text) => { calls.sendPlainText.push({ chatId, text }); },
    };
```

Update the first smoke test's assertions from `calls.notifySummaryTo` to the two new arrays:

```js
test('smoke: a validly signed Fireflies V2 "meeting.summarized" webhook is acked and routed end-to-end', async () => {
    const { server, port, calls, processed } = startTestServer();
    try {
        const res = await postWebhook(port, { event: 'meeting.summarized', meeting_id: 'smoke-1', timestamp: '2026-07-03T00:00:00Z' });
        assert.equal(res.status, 200);

        const result = await processed;
        assert.deepEqual(result, { status: 'processed', meetingId: 'smoke-1' });
        assert.equal(calls.notifyAgendaOverviewTo.length, 1);
        assert.equal(calls.notifyTodosTo.length, 1);
        assert.equal(calls.notifyAgendaOverviewTo[0].chatId, 'super-team-chat');
        assert.equal(calls.notifyOpsFailure.length, 0);
        assert.equal(calls.notifyUnrouted.length, 0);
    } finally {
        server.close();
    }
});
```

Update the other three assertions on `calls.notifySummaryTo.length` in the remaining smoke tests (`'a webhook with a bad signature...'`, `'when the summary never becomes ready...'`, `'an unrecognized meeting title...'`) to `calls.notifyAgendaOverviewTo.length` (same expected values: `0` in all three). Note: the `meetingRouter` used by `startTestServer` (`createMeetingRouter([{ match: ROUTED_TITLE, chatId: 'super-team-chat' }])`) has no `company`/`seriesKey` field — that's fine, both `resolveCompany`/`resolveSeriesKey` return `null` for it, matching today's behavior (no history tracking, no company hint in these particular smoke tests).

- [ ] **Step 3: Add one new smoke test for the classifier fallback**

Append to `webhook-service/test/app.test.js`:

```js
test('smoke: an unrecognized title still gets a company guess from content when passed a companyClassifier', async () => {
    const calls = { notifyAgendaOverviewTo: [], notifyTodosTo: [], notifyOpsFailure: [], notifyUnrouted: [], sendPlainText: [] };
    const firefliesClient = {
        fetchSummary: async () => ({ title: 'Ad Hoc Sync', overview: 'Discussed TVL and RE7 API updates.', action_items: 'ai' }),
    };
    const notifier = {
        notifyAgendaOverviewTo: async () => {},
        notifyTodosTo: async () => {},
        notifyOpsFailure: async () => {},
        notifyUnrouted: async (meetingId, title, summary, company) => { calls.notifyUnrouted.push({ company }); },
        sendPlainText: async () => {},
    };
    const meetingRouter = createMeetingRouter([{ match: ROUTED_TITLE, chatId: 'super-team-chat', company: 'ERN' }]);
    const { createCompanyClassifier } = require('../src/company-classifier');

    let resolveProcessed;
    const processed = new Promise((resolve) => { resolveProcessed = resolve; });
    const app = createApp({
        secret: SECRET, relaySecret: RELAY_SECRET, firefliesClient, notifier,
        seenMeetings: createSeenMeetings(), meetingRouter, relayChatMap: {},
        companyClassifier: createCompanyClassifier(),
        onProcessed: (result) => resolveProcessed(result),
    });
    const server = app.listen(0);
    const port = server.address().port;

    try {
        await postWebhook(port, { event: 'meeting.summarized', meeting_id: 'smoke-classify' });
        await processed;
        assert.equal(calls.notifyUnrouted.length, 1);
        assert.equal(calls.notifyUnrouted[0].company, 'BOND');
    } finally {
        server.close();
    }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webhook-service && node --test test/app.test.js`
Expected: PASS, 8 tests (7 existing, updated in place + 1 new)

- [ ] **Step 5: Update `index.js`**

In `webhook-service/index.js`, add the require and construct the classifier (alongside the existing `meetingHistory`/`historyConsolidator` construction — do not remove those), then pass it into `createApp`:

```js
const { createCompanyClassifier } = require('./src/company-classifier');
```

(add this require near the other `./src/*` requires, e.g. right after `createHistoryConsolidator`)

```js
// Pure content-based fallback, no config needed -- always available, only ever consulted when
// meetingRouter.resolveCompany(title) returns null (see handle-webhook.js's resolveCompany).
const companyClassifier = createCompanyClassifier();
```

(add this right after the existing `historyConsolidator` construction)

Update the `createApp({...})` call to add `companyClassifier` alongside the existing `meetingHistory`/`historyConsolidator`:

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
    companyClassifier,
    meetingHistory,
    historyConsolidator,
    onProcessed: (result) => {
        if (result.status === 'failed' || result.status === 'unrouted') {
            console.error('Fireflies webhook processing needs attention:', result);
        }
    },
});
```

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `cd webhook-service && npm test`
Expected: PASS, 112 tests (111 from Task 8 + 1 new smoke test) — this is the final test count for this plan.

- [ ] **Step 7: Commit**

```bash
cd "/Users/sraghavan/Documents/Claude/Projects/ERN Meeting Automation"
git add webhook-service/src/app.js webhook-service/test/app.test.js webhook-service/index.js
git commit -m "Wire companyClassifier through app.js/index.js alongside existing meetingHistory/historyConsolidator"
```

---

### Task 10: Pre-meeting routine prompt rewrite + docs

**Files:**
- Modify: `routines/pre-meeting-reminder.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing from earlier tasks (prose-only, per ADR-0001/0002 — a Cloud Routine prompt has no code path to `require()` any of this plan's modules).
- Produces: nothing downstream.

- [ ] **Step 1: Rewrite the routine's prompt and handle table**

In `routines/pre-meeting-reminder.md`, make these changes:

1. Update step 2 of the prompt from:
   ```
   2. Filter to events starting between 3 and 6 hours from right now.
   ```
   to:
   ```
   2. Filter to events starting between 11 and 13 hours from right now (approximates "at least 12 hours before" with enough width that an hourly cadence can't miss it on drift).
   ```

2. Replace step 5's structure (the per-attendee agenda) with the topic-level structure from the 2026-07-04 Agent Briefing:
   ```
   5. For each remaining matching event, draft a "Pre-Meeting Reminder" message in this exact
      structure — note this groups by TOPIC, not by attendee (a deliberate change from the old
      per-attendee format, per the 2026-07-04 briefing):

      ⏰ *<meeting series name> — Pre-Meeting Reminder*
      _Sending ahead of today's call. Please come prepared on the following:_

      ---

      📌 *On the Agenda*
      • <high-level topic 1, pulled from the event description>
      • <high-level topic 2>

      ---

      📎 *Please review before joining*
      • <a specific document, metric, or pending item mentioned in the event description that
        attendees should look at beforehand — omit this whole section if the description has
        nothing review-worthy, don't invent one>

      ---

      🕐 _See you on the call. Reply here if you can't make it._

      Tag every attendee (using the mapping below) on the line right after the title, same as
      today. Group the event description's per-attendee notes UP into shared topics for "On the
      Agenda" — do not simply relabel each attendee's bullets as a "topic"; a well-formed topic
      like "RE7 / Midas API" may summarize what was previously one attendee's item, and that's
      fine. Keep bullets terse, matching the source material's own terseness — don't pad.
   ```

3. Replace the attendee handle mapping list with the corrected/expanded table:
   ```
   Attendee handle mapping (kept in sync with `webhook-service/src/attendee-handles.js` — a
   Cloud Routine prompt has no code path to require() that file, so update both by hand):
   - Taweh Bey Solowii -> @tawehbeysolowii
   - Vinson Leow -> @vinsonleow
   - Hoa Ha -> @hoaha47
   - Sowmya Raghavan -> @sraghavan
   - Caitlin Sarah -> @caitlinsarah
   - Red -> @redbeem
   - Dr. Jonathan -> @jonscott
   - Keli Whitlock -> @keliwhitlock
   - Jerad Finck -> @JeradFinck
   - Rob Christensen has no Telegram handle -- list by plain name, same as any unmapped attendee.
   ```

4. Update the routing table in step 4 to add the new title patterns (mirroring Task 4's `routing-table.js`):
   ```
   4. For each remaining matching event, resolve which symbolic chat key it goes to by checking
      the event title against this table, most-specific-first:
      - Title contains "Bond <> Nebula" -> chatKey "BOND_NEBULA"
      - Title contains "Bond <> 0g Weekly Sync" -> chatKey "BOND_TEAM"
      - Title contains "BOND Daily Standup" -> chatKey "BOND_TEAM"
      - Title contains "Bond" -> chatKey "BOND_TEAM"
      - Title contains "ERN Daily Executive Standup" -> chatKey "ERN_EXEC_STANDUP"
      - Title contains "ERN <> Nebula" -> chatKey "ERN_SUPER_TEAM"
      - Title contains "ERN Daily Sync" -> chatKey "ERN_SUPER_TEAM"
      - No match -> chatKey "ERN_SUPER_TEAM" (send there instead of dropping it, so it stays
        visible to the team rather than in a private ops DM; prefix the message with
        `No routing match for meeting "<title>" — sending agenda here instead.` so someone
        notices and can add a rule)
   ```

5. Update the "Refreshed 2026-07-03..." real-example note below the prompt to say it's now stale relative to the new topic-level structure — replace its heading line with: `Real example pending — the format above changed 2026-07-04 from per-attendee to topic-level; refresh this example from the next real send.` (Do not fabricate a new fake example — leave it for the next real run, per the project's "never invent specificity" convention.)

- [ ] **Step 2: Update `CLAUDE.md`'s status log**

Add a new dated entry at the end of the running status log in `CLAUDE.md` (after the "Meeting history + cross-meeting consolidation added" entry):

```markdown
**Fireflies-Telegram notetaker merge (2026-07-04), see
[design spec](docs/superpowers/specs/2026-07-04-fireflies-telegram-notetaker-design.md) and
[plan](docs/superpowers/plans/2026-07-04-fireflies-telegram-notetaker.md).** Merged the
2026-07-04 "Agent Briefing" into the deployed pipeline, on top of the meeting-history work
above: `company-profiles.js`/`company-classifier.js` add content-based Bond/ERN classification
as a fallback when `routing-table.js`'s title match misses (title match stays authoritative for
both routing and company, alongside the existing `seriesKey`). `summarizer.js`'s second
parameter changed from a positional `seriesState` to a `{ seriesState, company }` context
object, and its response now includes `SECTIONS`/`NEXT_STEPS` alongside `OVERVIEW`/
`ACTION_ITEMS`, flags blockers with `⚠️`, reassigns handed-off tasks to their new owner, and
takes a per-company tone hint. `notifier.js` sends the post-meeting update as two independent
Telegram messages (Agenda/Overview, then To-Dos with a Fireflies recording link) instead of
one — a failure in either is reported to ops without blocking the other or the history-write
step that follows. `fireflies-client.js` now fetches `transcript_url`. Fixed Sowmya's handle
(`@sraghavan`, was `@sowmyaraghavan`) and added missing Bond (`@redbeem`) and ERN (`@jonscott`,
`@keliwhitlock`, `@JeradFinck`) handles. `routing-table.js` gained 3 new title patterns (`BOND
Daily Standup`, `Bond <> 0g Weekly Sync`, `ERN <> Nebula`), each with a `seriesKey` for history
tracking too. The pre-meeting routine's prompt changed from a 3-6h window with per-attendee
bullets to an 11-13h window with topic-level "On the Agenda"/"Please review before joining"
sections (prose-only change, no code). Out of scope, explicitly deferred: 30-min Fireflies
polling (the existing webhook is already real-time), Monday.com task links (no integration
exists). **112/112 tests pass.**
```

- [ ] **Step 3: Final full-suite run**

Run: `cd webhook-service && npm test`
Expected: PASS, 112 tests, 0 failures — this confirms the whole merge (both plans together) is complete and non-regressive.

- [ ] **Step 4: Commit and push**

```bash
cd "/Users/sraghavan/Documents/Claude/Projects/ERN Meeting Automation"
git add routines/pre-meeting-reminder.md CLAUDE.md
git commit -m "Update pre-meeting routine to topic-level format + 12h window, update handle table, update CLAUDE.md"
git push origin main
```
