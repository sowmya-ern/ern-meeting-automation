const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifySignature } = require('../src/verify-signature');

function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

test('valid signature passes', () => {
  const secret = 'shh';
  const rawBody = JSON.stringify({ meetingId: 'abc123' });
  const signatureHeader = sign(secret, rawBody);

  assert.equal(verifySignature({ secret, signatureHeader, rawBody }), true);
});

test('tampered body fails', () => {
  const secret = 'shh';
  const rawBody = JSON.stringify({ meetingId: 'abc123' });
  const signatureHeader = sign(secret, rawBody);
  const tamperedBody = JSON.stringify({ meetingId: 'xyz999' });

  assert.equal(
    verifySignature({ secret, signatureHeader, rawBody: tamperedBody }),
    false
  );
});

test('missing signatureHeader fails', () => {
  const secret = 'shh';
  const rawBody = JSON.stringify({ meetingId: 'abc123' });

  assert.equal(
    verifySignature({ secret, signatureHeader: undefined, rawBody }),
    false
  );
});

test('malformed/wrong-length header does not throw and returns false', () => {
  const secret = 'shh';
  const rawBody = JSON.stringify({ meetingId: 'abc123' });

  assert.doesNotThrow(() => {
    const result = verifySignature({
      secret,
      signatureHeader: 'not-a-real-signature',
      rawBody,
    });
    assert.equal(result, false);
  });
});
