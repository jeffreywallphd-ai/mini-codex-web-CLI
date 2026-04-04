const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dataDir = path.resolve(__dirname, "../data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.resolve(dataDir, "app.db");
const db = new sqlite3.Database(dbPath);

const LATEST_SCHEMA_VERSION = 3;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function tableExists(tableName) {
  const row = await get(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName]
  );
  return Boolean(row);
}

async function columnExists(tableName, columnName) {
  const rows = await all(`PRAGMA table_info(${tableName})`);
  return rows.some((row) => row.name === columnName);
}

async function ensureColumn(tableName, columnName, columnType) {
  const exists = await columnExists(tableName, columnName);
  if (exists) return;
  await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
}

async function detectVersionFromSchema() {
  const runsExists = await tableExists("runs");
  if (!runsExists) {
    return 0;
  }

  const hasCompletion = await columnExists("runs", "completion_status");
  const hasTiming = await columnExists("runs", "run_start_time")
    && await columnExists("runs", "run_end_time");

  if (hasTiming) return 3;
  if (hasCompletion) return 2;
  return 1;
}

async function getSchemaVersion() {
  await run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    )
  `);

  const row = await get("SELECT version FROM schema_version LIMIT 1");
  if (row && typeof row.version === "number") {
    return row.version;
  }

  const detectedVersion = await detectVersionFromSchema();
  await run("DELETE FROM schema_version");
  await run("INSERT INTO schema_version (version) VALUES (?)", [detectedVersion]);
  return detectedVersion;
}

async function setSchemaVersion(version) {
  await run("DELETE FROM schema_version");
  await run("INSERT INTO schema_version (version) VALUES (?)", [version]);
}

async function migrateToV1() {
  await run(`
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      execution_mode TEXT,
      branch_name TEXT,
      base_branch TEXT,
      git_status TEXT,
      git_status_files TEXT,
      git_diff_map TEXT,
      change_title TEXT,
      change_description TEXT,
      prompt_with_instructions TEXT,
      executed_command TEXT,
      spawn_command TEXT,
      merge_code INTEGER,
      merge_stdout TEXT,
      merge_stderr TEXT,
      merge_git_status TEXT,
      merged_at DATETIME
    )
  `);

  const legacyColumns = {
    execution_mode: "TEXT",
    branch_name: "TEXT",
    base_branch: "TEXT",
    git_status: "TEXT",
    git_status_files: "TEXT",
    git_diff_map: "TEXT",
    change_title: "TEXT",
    change_description: "TEXT",
    prompt_with_instructions: "TEXT",
    executed_command: "TEXT",
    spawn_command: "TEXT",
    merge_code: "INTEGER",
    merge_stdout: "TEXT",
    merge_stderr: "TEXT",
    merge_git_status: "TEXT",
    merged_at: "DATETIME"
  };

  for (const [columnName, columnType] of Object.entries(legacyColumns)) {
    await ensureColumn("runs", columnName, columnType);
  }
}

async function migrateToV2() {
  await ensureColumn("runs", "completion_status", "TEXT");
  await ensureColumn("runs", "completion_work", "TEXT");
}

async function migrateToV3() {
  await ensureColumn("runs", "run_start_time", "INTEGER");
  await ensureColumn("runs", "run_end_time", "INTEGER");
}

async function runMigrations() {
  let version = await getSchemaVersion();

  if (version <= 1) {
    await migrateToV1();
    if (version < 1) {
      version = 1;
      await setSchemaVersion(version);
    }
  }

  if (version < 2) {
    await migrateToV2();
    version = 2;
    await setSchemaVersion(version);
  }

  if (version < 3) {
    await migrateToV3();
    version = 3;
    await setSchemaVersion(version);
  }

  if (version > LATEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version ${version}. Latest supported is ${LATEST_SCHEMA_VERSION}.`);
  }
}

const dbReady = runMigrations();

function saveRun(run) {
  return new Promise((resolve, reject) => {
    dbReady
      .then(() => {
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
        git_status_files,
        git_diff_map,
        change_title,
        change_description,
        prompt_with_instructions,
        executed_command,
        spawn_command,
        completion_status,
        completion_work,
        run_start_time,
        run_end_time
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
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
        JSON.stringify(run.gitStatusFiles || []),
        JSON.stringify(run.gitDiffMap || {}),
        run.changeTitle,
        run.changeDescription,
        run.promptWithInstructions,
        run.executedCommand,
        run.spawnCommand,
        run.completionStatus,
        run.completionWork,
        run.runStartTime,
        run.runEndTime
      ],
      function onInsert(err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
        );
      })
      .catch(reject);
  });
}

function getRuns() {
  return new Promise((resolve, reject) => {
    dbReady
      .then(() => {
        db.all(
      `SELECT id, project_name, prompt, code, created_at, execution_mode, branch_name, merged_at, change_title, completion_status, completion_work, run_start_time, run_end_time
       FROM runs ORDER BY id DESC LIMIT 50`,
      [],
      (err, rows) => (err ? reject(err) : resolve(rows))
        );
      })
      .catch(reject);
  });
}

function getRunById(id) {
  return new Promise((resolve, reject) => {
    dbReady
      .then(() => {
        db.get(
      `SELECT * FROM runs WHERE id = ?`,
      [id],
      (err, row) => (err ? reject(err) : resolve(row))
        );
      })
      .catch(reject);
  });
}

function updateRunMerge(id, mergeResult) {
  return new Promise((resolve, reject) => {
    dbReady
      .then(() => {
        db.run(
      `UPDATE runs
       SET merge_git_status = ?,
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
      })
      .catch(reject);
  });
}

module.exports = { saveRun, getRuns, getRunById, updateRunMerge, dbReady };
