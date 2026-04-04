const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dataDir = path.resolve(__dirname, "../data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.resolve(dataDir, "app.db");
const db = new sqlite3.Database(dbPath);
db.run("PRAGMA foreign_keys = ON");

const LATEST_SCHEMA_VERSION = 7;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function runWithLastId(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this.lastID);
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

  const hasFeatureTables = await tableExists("features")
    && await tableExists("epics")
    && await tableExists("stories");
  if (hasFeatureTables) {
    const hasArchived = await columnExists("runs", "archived");
    const hasStoryRunId = await columnExists("stories", "run_id");
    const hasFeatureProjectScope = await columnExists("features", "project_name")
      && await columnExists("features", "base_branch");
    if (hasStoryRunId && hasArchived && hasFeatureProjectScope) return 7;
    if (hasStoryRunId && hasArchived) return 6;
    if (hasStoryRunId) return 5;
    return 4;
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

async function migrateToV4() {
  await run(`
    CREATE TABLE IF NOT EXISTS features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL DEFAULT '',
      base_branch TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS epics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      epic_id INTEGER NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_complete INTEGER NOT NULL DEFAULT 0,
      run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
      completion_run_id INTEGER,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_epics_feature_id ON epics(feature_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_stories_epic_id ON stories(epic_id)`);
}

async function migrateToV5() {
  await ensureColumn("stories", "run_id", "INTEGER REFERENCES runs(id) ON DELETE SET NULL");
  await run(`
    UPDATE stories
    SET run_id = completion_run_id
    WHERE run_id IS NULL
      AND completion_run_id IS NOT NULL
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_stories_run_id ON stories(run_id)`);
}

async function migrateToV6() {
  await ensureColumn("runs", "archived", "INTEGER NOT NULL DEFAULT 0");
}

async function migrateToV7() {
  await ensureColumn("features", "project_name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("features", "base_branch", "TEXT NOT NULL DEFAULT ''");
  await run(`
    CREATE INDEX IF NOT EXISTS idx_features_project_branch
    ON features(project_name, base_branch)
  `);
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

  if (version < 4) {
    await migrateToV4();
    version = 4;
    await setSchemaVersion(version);
  }

  if (version < 5) {
    await migrateToV5();
    version = 5;
    await setSchemaVersion(version);
  }

  if (version < 6) {
    await migrateToV6();
    version = 6;
    await setSchemaVersion(version);
  }

  if (version < 7) {
    await migrateToV7();
    version = 7;
    await setSchemaVersion(version);
  }

  if (version > LATEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version ${version}. Latest supported is ${LATEST_SCHEMA_VERSION}.`);
  }
}

const dbReady = runMigrations();

function saveRun(runInput) {
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            runInput.projectName,
            runInput.prompt,
            runInput.code,
            runInput.stdout,
            runInput.stderr,
            runInput.statusBefore,
            runInput.statusAfter,
            runInput.usageDelta,
            runInput.creditsRemaining,
            runInput.executionMode,
            runInput.branchName,
            runInput.baseBranch,
            runInput.gitStatus,
            JSON.stringify(runInput.gitStatusFiles || []),
            JSON.stringify(runInput.gitDiffMap || {}),
            runInput.changeTitle,
            runInput.changeDescription,
            runInput.promptWithInstructions,
            runInput.executedCommand,
            runInput.spawnCommand,
            runInput.completionStatus,
            runInput.completionWork,
            runInput.runStartTime,
            runInput.runEndTime
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

function getRuns({ search = "", status = "active" } = {}) {
  return new Promise((resolve, reject) => {
    dbReady
      .then(() => {
        const normalizedStatus = String(status || "active").toLowerCase();
        const whereClauses = [];
        const params = [];

        if (normalizedStatus === "active") {
          whereClauses.push("COALESCE(archived, 0) = 0");
        } else if (normalizedStatus === "archived") {
          whereClauses.push("COALESCE(archived, 0) = 1");
        }

        const normalizedSearch = String(search || "").trim();
        if (normalizedSearch) {
          whereClauses.push("(project_name LIKE ? OR prompt LIKE ? OR branch_name LIKE ?)");
          const searchTerm = `%${normalizedSearch}%`;
          params.push(searchTerm, searchTerm, searchTerm);
        }

        const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

        db.all(
          `SELECT
             id,
             project_name,
             prompt,
             code,
             created_at,
             execution_mode,
             branch_name,
             merged_at,
             change_title,
             completion_status,
             completion_work,
             run_start_time,
             run_end_time,
             COALESCE(archived, 0) AS archived
           FROM runs
           ${whereSql}
           ORDER BY id DESC
           LIMIT 50`,
          params,
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

async function createFeatureTree(featureDraft, scope = {}) {
  await dbReady;

  const featureName = String(featureDraft?.name || "").trim();
  const featureDescription = String(featureDraft?.description || "").trim();
  const projectName = String(scope?.projectName || "").trim();
  const baseBranch = String(scope?.baseBranch || "").trim();
  const epics = Array.isArray(featureDraft?.epics) ? featureDraft.epics : [];

  if (!featureName) {
    throw new Error("Feature name is required.");
  }
  if (!projectName) {
    throw new Error("Project name is required.");
  }
  if (!baseBranch) {
    throw new Error("Base branch is required.");
  }

  await run("BEGIN TRANSACTION");
  try {
    const featureId = await runWithLastId(
      `INSERT INTO features (project_name, base_branch, name, description) VALUES (?, ?, ?, ?)`,
      [projectName, baseBranch, featureName, featureDescription]
    );

    for (const epicDraft of epics) {
      const epicName = String(epicDraft?.name || "").trim();
      if (!epicName) {
        throw new Error("Epic name is required.");
      }

      const epicDescription = String(epicDraft?.description || "").trim();
      const epicId = await runWithLastId(
        `INSERT INTO epics (feature_id, name, description) VALUES (?, ?, ?)`,
        [featureId, epicName, epicDescription]
      );

      const stories = Array.isArray(epicDraft?.stories) ? epicDraft.stories : [];
      for (const storyDraft of stories) {
        const storyName = String(storyDraft?.name || "").trim();
        if (!storyName) {
          throw new Error("Story name is required.");
        }

        const storyDescription = String(storyDraft?.description || "").trim();
        await runWithLastId(
          `INSERT INTO stories (epic_id, name, description, is_complete) VALUES (?, ?, ?, 0)`,
          [epicId, storyName, storyDescription]
        );
      }
    }

    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }
}

async function getFeaturesTree(scope = {}) {
  await dbReady;
  const projectName = String(scope?.projectName || "").trim();
  const baseBranch = String(scope?.baseBranch || "").trim();

  if (!projectName || !baseBranch) {
    return [];
  }

  const [features, epics, stories] = await Promise.all([
    all(
      `
        SELECT id, project_name, base_branch, name, description, created_at
        FROM features
        WHERE project_name = ? AND base_branch = ?
        ORDER BY id DESC
      `,
      [projectName, baseBranch]
    ),
    all(
      `
        SELECT epics.id, epics.feature_id, epics.name, epics.description, epics.created_at
        FROM epics
        INNER JOIN features ON features.id = epics.feature_id
        WHERE features.project_name = ? AND features.base_branch = ?
        ORDER BY epics.id ASC
      `,
      [projectName, baseBranch]
    ),
    all(`
      SELECT
        stories.id,
        stories.epic_id,
        epics.feature_id AS feature_id,
        stories.name,
        stories.description,
        stories.is_complete AS persisted_is_complete,
        stories.run_id,
        stories.completion_run_id,
        stories.completed_at,
        stories.created_at,
        runs.id AS linked_run_id,
        runs.completion_status AS linked_run_completion_status,
        runs.code AS linked_run_code,
        runs.created_at AS linked_run_created_at
      FROM stories
      LEFT JOIN runs
        ON runs.id = COALESCE(stories.run_id, stories.completion_run_id)
      INNER JOIN epics
        ON epics.id = stories.epic_id
      INNER JOIN features
        ON features.id = epics.feature_id
      WHERE features.project_name = ?
        AND features.base_branch = ?
      ORDER BY stories.id ASC
    `, [projectName, baseBranch])
  ]);

  const featuresById = new Map(features.map((feature) => [feature.id, { ...feature, epics: [] }]));
  const epicsById = new Map();

  for (const epic of epics) {
    const hydratedEpic = { ...epic, stories: [] };
    epicsById.set(epic.id, hydratedEpic);
    const parentFeature = featuresById.get(epic.feature_id);
    if (parentFeature) {
      parentFeature.epics.push(hydratedEpic);
    }
  }

  for (const story of stories) {
    const parentEpic = epicsById.get(story.epic_id);
    if (!parentEpic) continue;

    const associatedRunId = story.linked_run_id || story.run_id || story.completion_run_id || null;
    const normalizedCompletionStatus = story.linked_run_completion_status === "complete"
      ? "complete"
      : story.linked_run_completion_status === "incomplete"
        ? "incomplete"
        : "unknown";
    const isComplete = normalizedCompletionStatus === "complete";
    const runStatus = associatedRunId
      ? (normalizedCompletionStatus === "unknown" ? "in_progress" : normalizedCompletionStatus)
      : "not_started";

    parentEpic.stories.push({
      ...story,
      run_id: associatedRunId,
      run_status: runStatus,
      run_completion_status: normalizedCompletionStatus,
      is_complete: isComplete
    });
  }

  return [...featuresById.values()];
}

async function syncStoryCompletionFromRun(storyId, runId) {
  await dbReady;

  const story = await get(`SELECT id FROM stories WHERE id = ?`, [storyId]);
  if (!story) {
    throw new Error("Story not found.");
  }

  const runRecord = await get(`SELECT id, completion_status FROM runs WHERE id = ?`, [runId]);
  if (!runRecord) {
    throw new Error("Run not found.");
  }

  const isComplete = runRecord.completion_status === "complete" ? 1 : 0;
  await run(
    `
      UPDATE stories
      SET is_complete = ?,
          run_id = ?,
          completion_run_id = ?,
          completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE id = ?
    `,
    [isComplete, runRecord.id, runRecord.id, isComplete, storyId]
  );

  return {
    storyId,
    runId: runRecord.id,
    isComplete: isComplete === 1
  };
}

async function getCompletionEligibleRuns(limit = 100) {
  await dbReady;
  return all(
    `
      SELECT id, project_name, change_title, prompt, completion_status, created_at
      FROM runs
      WHERE completion_status IS NOT NULL
      ORDER BY id DESC
      LIMIT ?
    `,
    [limit]
  );
}

async function getStoryAutomationContext(storyId, scope = {}) {
  await dbReady;
  const projectName = String(scope?.projectName || "").trim();
  const baseBranch = String(scope?.baseBranch || "").trim();

  if (!projectName || !baseBranch) {
    return null;
  }

  return get(
    `
      SELECT
        stories.id AS story_id,
        stories.name AS story_name,
        stories.description AS story_description,
        stories.run_id AS story_run_id,
        epics.id AS epic_id,
        epics.name AS epic_name,
        epics.description AS epic_description,
        features.id AS feature_id,
        features.name AS feature_name,
        features.description AS feature_description
      FROM stories
      INNER JOIN epics ON epics.id = stories.epic_id
      INNER JOIN features ON features.id = epics.feature_id
      WHERE stories.id = ?
        AND features.project_name = ?
        AND features.base_branch = ?
    `,
    [storyId, projectName, baseBranch]
  );
}

async function attachRunToStory(storyId, runId) {
  await dbReady;

  const story = await get(`SELECT id FROM stories WHERE id = ?`, [storyId]);
  if (!story) {
    throw new Error("Story not found.");
  }

  const runRecord = await get(`SELECT id, completion_status FROM runs WHERE id = ?`, [runId]);
  if (!runRecord) {
    throw new Error("Run not found.");
  }

  const isComplete = runRecord.completion_status === "complete" ? 1 : 0;
  await run(
    `
      UPDATE stories
      SET is_complete = ?,
          run_id = ?,
          completion_run_id = ?,
          completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE id = ?
    `,
    [isComplete, runRecord.id, runRecord.id, isComplete, storyId]
  );
}

function setRunArchived(id, archived) {
  return new Promise((resolve, reject) => {
    dbReady
      .then(() => {
        db.run(
          `UPDATE runs SET archived = ? WHERE id = ?`,
          [archived ? 1 : 0, id],
          function onUpdate(err) {
            if (err) return reject(err);
            resolve(this.changes);
          }
        );
      })
      .catch(reject);
  });
}

function deleteRunById(id) {
  return new Promise((resolve, reject) => {
    dbReady
      .then(() => {
        db.run(
          `DELETE FROM runs WHERE id = ?`,
          [id],
          function onDelete(err) {
            if (err) return reject(err);
            resolve(this.changes);
          }
        );
      })
      .catch(reject);
  });
}

module.exports = {
  saveRun,
  getRuns,
  getRunById,
  updateRunMerge,
  createFeatureTree,
  getFeaturesTree,
  getStoryAutomationContext,
  attachRunToStory,
  syncStoryCompletionFromRun,
  getCompletionEligibleRuns,
  setRunArchived,
  deleteRunById,
  dbReady
};
