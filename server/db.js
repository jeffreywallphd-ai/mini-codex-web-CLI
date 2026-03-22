const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dbPath = path.resolve(__dirname, "../data/app.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT,
      prompt TEXT,
      code INTEGER,
      stdout TEXT,
      stderr TEXT,
      status_before TEXT,
      status_after TEXT,
      usage_delta TEXT,
      credits_remaining REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

function saveRun(run) {
  return new Promise((resolve, reject) => {
    db.run(
        `INSERT INTO runs 
        (project_name, prompt, code, stdout, stderr, status_before, status_after, usage_delta, credits_remaining)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            run.projectName,
            run.prompt,
            run.code,
            run.stdout,
            run.stderr,
            run.statusBefore,
            run.statusAfter,
            run.usageDelta,
            run.creditsRemaining
        ],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

function getRuns() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, project_name, prompt, code, created_at
       FROM runs ORDER BY id DESC LIMIT 50`,
      [],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

function getRunById(id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM runs WHERE id = ?`, [id],
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });
}

module.exports = { saveRun, getRuns, getRunById };