const crypto = require('crypto');

/**
 * Pure shared-token check for the pre-meeting-agenda relay endpoint (see ADR-0004).
 * No process.env reads, never throws.
 *
 * @param {object} params
 * @param {string} params.secret - RELAY_SECRET
 * @param {string} params.authHeader - value of the incoming Authorization header,
 *   expected format "Bearer <token>"
 * @returns {boolean}
 */
function verifyRelayToken({ secret, authHeader }) {
  if (!secret || !authHeader) {
    return false;
  }

  try {
    const expected = `Bearer ${secret}`;
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(authHeader);

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  } catch {
    return false;
  }
}

module.exports = { verifyRelayToken };
