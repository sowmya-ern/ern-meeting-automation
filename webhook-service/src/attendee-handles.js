// Kept in sync manually with the identical table in routines/pre-meeting-reminder.md — a
// Cloud Routine prompt has no code path to require() this file (ADR-0001/0002), so update
// both when this table changes.
const HANDLES = {
  'Taweh Bey Solowii': '@tawehbeysolowii',
  'Vinson Leow': '@vinsonleow',
  'Hoa Ha': '@hoaha47',
  'Sowmya Raghavan': '@sraghavan',
  'Caitlin Sarah': '@caitlinsarah',
  Red: '@redbeem',
  'Dr. Jonathan': '@jonscott',
  'Keli Whitlock': '@keliwhitlock',
  'Jerad Finck': '@JeradFinck',
  // Rob Christensen intentionally absent -- no Telegram handle given, falls back to plain name.
};

function handleFor(displayName) {
  return HANDLES[displayName] ?? displayName;
}

// Swaps a "**Full Name**" bold-marker heading (the shape summarizer.js emits for action-item
// assignees) for "**@handle**" when the name is known, so Telegram output tags the real
// person instead of showing their plain name. Unmapped names pass through unchanged.
function linkifyBoldNames(text) {
  return text.replace(/\*\*([^*]+)\*\*/g, (full, name) => `**${handleFor(name)}**`);
}

module.exports = { handleFor, linkifyBoldNames };
