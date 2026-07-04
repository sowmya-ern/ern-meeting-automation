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
