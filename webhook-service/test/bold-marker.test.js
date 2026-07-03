const test = require('node:test');
const assert = require('node:assert/strict');
const { toHtmlBold, BOLD_MARKER_SYNTAX_HINT } = require('../src/bold-marker');

test('toHtmlBold converts **word** markers into <b>word</b>', () => {
  assert.equal(toHtmlBold('Review the **July 15** deadline'), 'Review the <b>July 15</b> deadline');
});

test('toHtmlBold leaves text with no markers unchanged', () => {
  assert.equal(toHtmlBold('nothing bold here'), 'nothing bold here');
});

test('BOLD_MARKER_SYNTAX_HINT documents the exact syntax summarizer.js instructs the model to emit', () => {
  assert.match(BOLD_MARKER_SYNTAX_HINT, /\*\*/);
});
