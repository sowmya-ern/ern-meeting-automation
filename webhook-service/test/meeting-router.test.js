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
