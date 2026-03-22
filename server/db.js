const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dataDir = path.resolve(__dirname, "../data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.resolve(dataDir, "app.db");
const db = new sqlite3.Database(dbPath);

const RUN_COLUMNS = {
  execution_mode: "TEXT",
  branch_name: "TEXT",
  base_branch: "TEXT",
  git_status: "TEXT",
  executed_command: "TEXT",
  spawn_command: "TEXT",
  merge_code: "INTEGER",
  merge_stdout: "TEXT",
  merge_stderr: "TEXT",
  merged_at: "DATETIME"
};

function ensureRunColumns() {
  db.all("PRAGMA table_info(runs)", [], (err, rows) => {
    if (err) {
      console.error("Failed to inspect runs table:", err);
      return;
    }

    const existing = new Set(rows.map((row) => row.name));

    for (const [column, type] of Object.entries(RUN_COLUMNS)) {
      if (existing.has(column)) continue;
      db.run(`ALTER TABLE runs ADD COLUMN ${column} ${type}`);
    }
  });
}

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

  ensureRunColumns();
});

function saveRun(run) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO runs
      (
        project_name,
        prompt,
        code,
        stdout,
        stderr,
        status_before,
        status_after,
        usage_delta,
        credits_remaining,
        execution_mode,
        branch_name,
        base_branch,
        git_status,
        executed_command,
        spawn_command
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.projectName,
        run.prompt,
        run.code,
        run.stdout,
        run.stderr,
        run.statusBefore,
        run.statusAfter,
        run.usageDelta,
        run.creditsRemaining,
        run.executionMode,
        run.branchName,
        run.baseBranch,
        run.gitStatus,
        run.executedCommand,
        run.spawnCommand
      ],
      function onInsert(err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

function getRuns() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, project_name, prompt, code, created_at, execution_mode, branch_name, merged_at
       FROM runs ORDER BY id DESC LIMIT 50`,
      [],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

function getRunById(id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM runs WHERE id = ?`,
      [id],
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });
}

function updateRunMerge(id, mergeResult) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE runs
       SET git_status = ?,
           merge_code = ?,
           merge_stdout = ?,
           merge_stderr = ?,
           merged_at = CASE WHEN ? = 0 THEN CURRENT_TIMESTAMP ELSE merged_at END
       WHERE id = ?`,
      [
        mergeResult.gitStatus,
        mergeResult.code,
        mergeResult.stdout,
        mergeResult.stderr,
        mergeResult.code,
        id
      ],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

module.exports = { saveRun, getRuns, getRunById, updateRunMerge };
