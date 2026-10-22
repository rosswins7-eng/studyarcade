// Unified DB interface. Turso cloud when TURSO_URL is set, local SQLite otherwise.
const backend = process.env.TURSO_URL
  ? require('./db-turso')
  : require('./db-sqlite');

if (process.env.TURSO_URL) console.log('DB backend: Turso cloud');
else console.log('DB backend: local SQLite');

function publicSet(row) {
  return {
    id: row.id, title: row.title, subject: row.subject,
    module: row.module, module_order: row.module_order,
    description: row.description,
    questionCount: JSON.parse(row.questions_json).length,
    rounds: row.rounds_json ? JSON.parse(row.rounds_json) : null,
    creator: row.creator_name || 'StudyClash',
    plays: row.plays, created_at: row.created_at,
  };
}
function fullSet(row) {
  const s = publicSet(row);
  s.questions = JSON.parse(row.questions_json);
  return s;
}

module.exports = { ...backend, publicSet, fullSet };
