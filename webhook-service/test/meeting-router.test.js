const test = require('node:test');
const assert = require('node:assert/strict');
const { createMeetingRouter } = require('../src/meeting-router');

const RULES = [
    { match: 'Bond <> Nebula', chatId: 'bond-nebula-chat' },
    { match: 'Bond', chatId: 'bond-team-chat' },
    { match: 'ERN Daily Executive Standup', chatId: 'exec-standup-chat' },
    { match: 'ERN Daily Sync', chatId: 'super-team-chat' },
];

test('resolves the most specific rule first (Bond <> Nebula over plain Bond)', () => {
    const router = createMeetingRouter(RULES);
    assert.equal(router.resolveChatId('Bond <> Nebula weekly sync'), 'bond-nebula-chat');
});

test('falls back to the looser rule when the specific one does not match', () => {
    const router = createMeetingRouter(RULES);
    assert.equal(router.resolveChatId('Bond daily standup'), 'bond-team-chat');
});

test('resolves ERN Daily Executive Standup distinctly from ERN Daily Sync', () => {
    const router = createMeetingRouter(RULES);
    assert.equal(router.resolveChatId('ERN Daily Executive Standup - 2026-07-02'), 'exec-standup-chat');
    assert.equal(router.resolveChatId('ERN Daily Sync - 2026-07-02'), 'super-team-chat');
});

test('returns null when no rule matches', () => {
    const router = createMeetingRouter(RULES);
    assert.equal(router.resolveChatId('Random 1:1 with a candidate'), null);
});

test('returns null for a missing/empty title without throwing', () => {
    const router = createMeetingRouter(RULES);
    assert.equal(router.resolveChatId(undefined), null);
    assert.equal(router.resolveChatId(''), null);
});

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
