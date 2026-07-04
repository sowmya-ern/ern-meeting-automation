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
