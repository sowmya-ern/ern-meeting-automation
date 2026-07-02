const test = require('node:test');
const assert = require('node:assert/strict');

const { createSeenMeetings } = require('../src/seen-meetings');

test('has(id) is false before markSeen(id), true after', () => {
  const seenMeetings = createSeenMeetings();

  assert.equal(seenMeetings.has('meeting-1'), false);

  seenMeetings.markSeen('meeting-1');

  assert.equal(seenMeetings.has('meeting-1'), true);
});

test('independent instances do not share state', () => {
  const instanceA = createSeenMeetings();
  const instanceB = createSeenMeetings();

  instanceA.markSeen('meeting-1');

  assert.equal(instanceA.has('meeting-1'), true);
  assert.equal(instanceB.has('meeting-1'), false);
});
