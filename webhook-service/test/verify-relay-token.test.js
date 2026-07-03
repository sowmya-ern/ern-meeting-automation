const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyRelayToken } = require('../src/verify-relay-token');

test('accepts a matching Bearer token', () => {
  assert.equal(verifyRelayToken({ secret: 'abc123', authHeader: 'Bearer abc123' }), true);
});

test('rejects a non-matching token', () => {
  assert.equal(verifyRelayToken({ secret: 'abc123', authHeader: 'Bearer wrong' }), false);
});

test('rejects a missing Authorization header', () => {
  assert.equal(verifyRelayToken({ secret: 'abc123', authHeader: undefined }), false);
});

test('rejects when no secret is configured, even if a header is present', () => {
  assert.equal(verifyRelayToken({ secret: undefined, authHeader: 'Bearer abc123' }), false);
});

test('does not throw on a malformed header', () => {
  assert.equal(verifyRelayToken({ secret: 'abc123', authHeader: 'not-a-bearer-token' }), false);
});
