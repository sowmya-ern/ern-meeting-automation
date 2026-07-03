const test = require('node:test');
const assert = require('node:assert/strict');
const { handleFor } = require('../src/attendee-handles');

test('returns the mapped Telegram handle for a known attendee', () => {
  assert.equal(handleFor('Taweh Bey Solowii'), '@tawehbeysolowii');
  assert.equal(handleFor('Vinson Leow'), '@vinsonleow');
  assert.equal(handleFor('Hoa Ha'), '@hoaha47');
  assert.equal(handleFor('Sowmya Raghavan'), '@sowmyaraghavan');
  assert.equal(handleFor('Caitlin Sarah'), '@caitlinsarah');
});

test('falls back to the plain display name for an unmapped attendee', () => {
  assert.equal(handleFor('Random Guest'), 'Random Guest');
});
