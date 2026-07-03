// The one shared contract between summarizer.js (producer — instructs the model to emit this
// syntax) and notifier.js (consumer — converts it to Telegram HTML). Both modules depend on
// this file rather than each independently assuming the other's format.
const BOLD_MARKER_SYNTAX_HINT = 'wrap hard deadlines inline in ** ** (e.g. **July 15**)';
const BOLD_MARKER_PATTERN = /\*\*(.+?)\*\*/g;

function toHtmlBold(escapedText) {
  return escapedText.replace(BOLD_MARKER_PATTERN, '<b>$1</b>');
}

module.exports = { BOLD_MARKER_SYNTAX_HINT, BOLD_MARKER_PATTERN, toHtmlBold };
