const crypto = require('crypto');

/**
 * Pure HMAC-SHA256 signature check. No process.env reads, no network calls.
 *
 * @param {object} params
 * @param {string} params.secret - shared secret used to sign the payload
 * @param {string} params.signatureHeader - value of the incoming signature header
 *   (expected format: "sha256=<hex digest>")
 * @param {string|Buffer} params.rawBody - raw, unparsed request body
 * @returns {boolean} true if the signature matches, false otherwise (never throws)
 */
function verifySignature({ secret, signatureHeader, rawBody }) {
  if (!signatureHeader) {
    return false;
  }

  try {
    const expected = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signatureHeader);

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  } catch {
    return false;
  }
}

module.exports = { verifySignature };
