const test = require('node:test');
const assert = require('node:assert/strict');
const { handleFor, linkifyBoldNames } = require('../src/attendee-handles');

test('returns the mapped Telegram handle for a known attendee', () => {
  assert.equal(handleFor('Taweh Bey Solowii'), '@tawehbeysolowii');
  assert.equal(handleFor('Vinson Leow'), '@vinsonleow');
  assert.equal(handleFor('Hoa Ha'), '@hoaha47');
  assert.equal(handleFor('Sowmya Raghavan'), '@sraghavan');
  assert.equal(handleFor('Caitlin Sarah'), '@caitlinsarah');
  assert.equal(handleFor('Red'), '@redbeem');
  assert.equal(handleFor('Dr. Jonathan'), '@jonscott');
  assert.equal(handleFor('Keli Whitlock'), '@keliwhitlock');
  assert.equal(handleFor('Jerad Finck'), '@JeradFinck');
});

test('falls back to the plain display name for an unmapped attendee', () => {
  assert.equal(handleFor('Random Guest'), 'Random Guest');
  assert.equal(handleFor('Rob Christensen'), 'Rob Christensen');
});

test('linkifyBoldNames replaces a bolded known name with its bolded handle', () => {
  const result = linkifyBoldNames('**Vinson Leow**\nGet the doc.');
  assert.equal(result, '**@vinsonleow**\nGet the doc.');
});

test('linkifyBoldNames leaves a bolded unmapped name unchanged', () => {
  const result = linkifyBoldNames('**Rob Christensen**\nConfirm budget.');
  assert.equal(result, '**Rob Christensen**\nConfirm budget.');
});

test('linkifyBoldNames handles multiple bolded names in one string', () => {
  const result = linkifyBoldNames('**Hoa Ha**\n- Item A\n\n**Red**\n- Item B');
  assert.equal(result, '**@hoaha47**\n- Item A\n\n**@redbeem**\n- Item B');
});
