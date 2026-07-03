// Kept in sync manually with the identical table in routines/pre-meeting-reminder.md — a
// Cloud Routine prompt has no code path to require() this file (ADR-0001/0002), so update
// both when this table changes.
const HANDLES = {
  'Taweh Bey Solowii': '@tawehbeysolowii',
  'Vinson Leow': '@vinsonleow',
  'Hoa Ha': '@hoaha47',
  'Sowmya Raghavan': '@sowmyaraghavan',
  'Caitlin Sarah': '@caitlinsarah',
};

function handleFor(displayName) {
  return HANDLES[displayName] ?? displayName;
}

module.exports = { handleFor };
