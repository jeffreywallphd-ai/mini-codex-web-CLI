const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dataDir = path.resolve(__dirname, "../data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.resolve(dataDir, "app.db");
const db = new sqlite3.Database(dbPath);
db.run("PRAGMA foreign_keys = ON");

const LATEST_SCHEMA_VERSION = 11;
const VALID_AUTOMATION_TYPES = new Set(["feature", "epic", "story"]);
const VALID_AUTOMATION_STATUSES = new Set(["pending", "running", "completed", "failed", "stopped"]);
const VALID_AUTOMATION_STORY_EXECUTION_STATUSES = new Set(["completed", "failed"]);
const VALID_AUTOMATION_STORY_QUEUE_ACTIONS = new Set(["advanced", "stopped", "failed"]);

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
    const hasAutomationRuns = await tableExists("automation_runs");
    const hasArchived = await columnExists("runs", "archived");
    const hasStoryRunId = await columnExists("stories", "run_id");
    const hasFeatureProjectScope = await columnExists("features", "project_name")
      && await columnExists("features", "base_branch");
    if (hasAutomationRuns && hasStoryRunId && hasArchived && hasFeatureProjectScope) {
      const hasStopOnIncomplete = await columnExists("automation_runs", "stop_on_incomplete");
      const hasAutomationStatus = await columnExists("automation_runs", "automation_status");
      if (hasStopOnIncomplete && hasAutomationStatus) {
        const hasStopReason = await columnExists("automation_runs", "stop_reason");
        if (hasStopReason) {
          const hasStoryExecutionTable = await tableExists("automation_story_executions");
          if (hasStoryExecutionTable) return 11;
          return 10;
        }
        return 9;
      }
      return 8;
    }
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

async function migrateToV8() {
  await run(`
    CREATE TABLE IF NOT EXISTS automation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      automation_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      stop_flag INTEGER NOT NULL DEFAULT 0,
      current_position INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS idx_automation_runs_target
    ON automation_runs(automation_type, target_id)
  `);
}

async function migrateToV9() {
  await ensureColumn("automation_runs", "stop_on_incomplete", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("automation_runs", "automation_status", "TEXT NOT NULL DEFAULT 'running'");
  await run(`
    UPDATE automation_runs
    SET stop_on_incomplete = COALESCE(stop_on_incomplete, 0),
        automation_status = COALESCE(NULLIF(TRIM(automation_status), ''), 'running')
  `);
}

async function migrateToV10() {
  await ensureColumn("automation_runs", "stop_reason", "TEXT");
}

async function migrateToV11() {
  await run(`
    CREATE TABLE IF NOT EXISTS automation_story_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      automation_run_id INTEGER NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
      story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      position_in_queue INTEGER NOT NULL,
      execution_status TEXT NOT NULL,
      queue_action TEXT NOT NULL,
      run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
      completion_status TEXT,
      completion_work TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS idx_automation_story_executions_automation_run
    ON automation_story_executions(automation_run_id, position_in_queue, id)
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS idx_automation_story_executions_story
    ON automation_story_executions(story_id)
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS idx_automation_story_executions_run
    ON automation_story_executions(run_id)
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

  if (version < 8) {
    await migrateToV8();
    version = 8;
    await setSchemaVersion(version);
  }

  if (version < 9) {
    await migrateToV9();
    version = 9;
    await setSchemaVersion(version);
  }

  if (version < 10) {
    await migrateToV10();
    version = 10;
    await setSchemaVersion(version);
  }

  if (version < 11) {
    await migrateToV11();
    version = 11;
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

async function createAutomationRun(input = {}) {
  await dbReady;
  const automationType = String(input.automationType || "").trim().toLowerCase();
  const automationStatus = String(input.automationStatus || "running").trim().toLowerCase();
  const targetId = Number.parseInt(input.targetId, 10);
  const stopFlag = input.stopFlag ? 1 : 0;
  const stopOnIncomplete = input.stopOnIncomplete ? 1 : 0;
  const currentPosition = Number.parseInt(input.currentPosition ?? 1, 10);
  const stopReason = typeof input.stopReason === "string" && input.stopReason.trim()
    ? input.stopReason.trim()
    : null;

  if (!automationType) {
    throw new Error("Automation type is required.");
  }
  if (!VALID_AUTOMATION_TYPES.has(automationType)) {
    throw new Error("Automation type must be feature, epic, or story.");
  }

  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw new Error("Target id must be a positive integer.");
  }

  if (!automationStatus) {
    throw new Error("Automation status is required.");
  }
  if (!VALID_AUTOMATION_STATUSES.has(automationStatus)) {
    throw new Error("Automation status must be pending, running, completed, failed, or stopped.");
  }

  if (!Number.isInteger(currentPosition) || currentPosition <= 0) {
    throw new Error("Current position must be a positive integer.");
  }

  const id = await runWithLastId(
    `
      INSERT INTO automation_runs
      (automation_type, target_id, stop_flag, stop_on_incomplete, current_position, automation_status, stop_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [automationType, targetId, stopFlag, stopOnIncomplete, currentPosition, automationStatus, stopReason]
  );

  return getAutomationRunById(id);
}

async function getAutomationRunById(id) {
  await dbReady;
  const runId = Number.parseInt(id, 10);

  if (!Number.isInteger(runId) || runId <= 0) {
    return null;
  }

  return get(
    `
      SELECT
        id,
        automation_type,
        target_id,
        stop_flag,
        stop_on_incomplete,
        current_position,
        automation_status,
        stop_reason,
        created_at,
        updated_at
      FROM automation_runs
      WHERE id = ?
    `,
    [runId]
  );
}

async function updateAutomationRunMetadata(id, updates = {}) {
  await dbReady;
  const runId = Number.parseInt(id, 10);
  if (!Number.isInteger(runId) || runId <= 0) {
    throw new Error("Automation run id must be a positive integer.");
  }

  const updateClauses = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(updates, "stopFlag")) {
    updateClauses.push("stop_flag = ?");
    params.push(updates.stopFlag ? 1 : 0);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "stopOnIncomplete")) {
    updateClauses.push("stop_on_incomplete = ?");
    params.push(updates.stopOnIncomplete ? 1 : 0);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "currentPosition")) {
    const currentPosition = Number.parseInt(updates.currentPosition, 10);
    if (!Number.isInteger(currentPosition) || currentPosition <= 0) {
      throw new Error("Current position must be a positive integer.");
    }
    updateClauses.push("current_position = ?");
    params.push(currentPosition);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "automationStatus")) {
    const automationStatus = String(updates.automationStatus || "").trim().toLowerCase();
    if (!automationStatus) {
      throw new Error("Automation status is required.");
    }
    if (!VALID_AUTOMATION_STATUSES.has(automationStatus)) {
      throw new Error("Automation status must be pending, running, completed, failed, or stopped.");
    }
    updateClauses.push("automation_status = ?");
    params.push(automationStatus);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "stopReason")) {
    const stopReason = typeof updates.stopReason === "string" && updates.stopReason.trim()
      ? updates.stopReason.trim()
      : null;
    updateClauses.push("stop_reason = ?");
    params.push(stopReason);
  }

  if (updateClauses.length === 0) {
    throw new Error("At least one automation metadata field must be provided.");
  }

  updateClauses.push("updated_at = CURRENT_TIMESTAMP");
  params.push(runId);

  await run(
    `
      UPDATE automation_runs
      SET ${updateClauses.join(", ")}
      WHERE id = ?
    `,
    params
  );

  return getAutomationRunById(runId);
}

function normalizeAutomationStoryCompletionStatus(completionStatus) {
  if (completionStatus === null || completionStatus === undefined || completionStatus === "") {
    return null;
  }

  const normalized = String(completionStatus).trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "complete" || normalized === "incomplete" || normalized === "unknown") {
    return normalized;
  }

  return normalized;
}

async function getAutomationStoryExecutionById(id) {
  await dbReady;
  const executionId = Number.parseInt(id, 10);
  if (!Number.isInteger(executionId) || executionId <= 0) {
    return null;
  }

  return get(
    `
      SELECT
        id,
        automation_run_id,
        story_id,
        position_in_queue,
        execution_status,
        queue_action,
        run_id,
        completion_status,
        completion_work,
        error,
        created_at
      FROM automation_story_executions
      WHERE id = ?
    `,
    [executionId]
  );
}

async function recordAutomationStoryExecution(input = {}) {
  await dbReady;

  const automationRunId = Number.parseInt(input.automationRunId, 10);
  const storyId = Number.parseInt(input.storyId, 10);
  const positionInQueue = Number.parseInt(input.positionInQueue, 10);
  const executionStatus = String(input.executionStatus || "").trim().toLowerCase();
  const queueAction = String(input.queueAction || "").trim().toLowerCase();
  const runId = input.runId === null || input.runId === undefined || input.runId === ""
    ? null
    : Number.parseInt(input.runId, 10);
  const completionStatus = normalizeAutomationStoryCompletionStatus(input.completionStatus);
  const completionWork = typeof input.completionWork === "string" && input.completionWork.trim()
    ? input.completionWork
    : null;
  const errorMessage = typeof input.error === "string" && input.error.trim()
    ? input.error
    : null;

  if (!Number.isInteger(automationRunId) || automationRunId <= 0) {
    throw new Error("Automation run id must be a positive integer.");
  }

  if (!Number.isInteger(storyId) || storyId <= 0) {
    throw new Error("Story id must be a positive integer.");
  }

  if (!Number.isInteger(positionInQueue) || positionInQueue <= 0) {
    throw new Error("Position in queue must be a positive integer.");
  }

  if (!executionStatus) {
    throw new Error("Execution status is required.");
  }
  if (!VALID_AUTOMATION_STORY_EXECUTION_STATUSES.has(executionStatus)) {
    throw new Error("Execution status must be completed or failed.");
  }

  if (!queueAction) {
    throw new Error("Queue action is required.");
  }
  if (!VALID_AUTOMATION_STORY_QUEUE_ACTIONS.has(queueAction)) {
    throw new Error("Queue action must be advanced, stopped, or failed.");
  }

  if (runId !== null && (!Number.isInteger(runId) || runId <= 0)) {
    throw new Error("Run id must be a positive integer when provided.");
  }

  const id = await runWithLastId(
    `
      INSERT INTO automation_story_executions
      (
        automation_run_id,
        story_id,
        position_in_queue,
        execution_status,
        queue_action,
        run_id,
        completion_status,
        completion_work,
        error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      automationRunId,
      storyId,
      positionInQueue,
      executionStatus,
      queueAction,
      runId,
      completionStatus,
      completionWork,
      errorMessage
    ]
  );

  return getAutomationStoryExecutionById(id);
}

async function getAutomationStoryExecutionsByRunId(automationRunId) {
  await dbReady;
  const runId = Number.parseInt(automationRunId, 10);
  if (!Number.isInteger(runId) || runId <= 0) {
    return [];
  }

  return all(
    `
      SELECT
        id,
        automation_run_id,
        story_id,
        position_in_queue,
        execution_status,
        queue_action,
        run_id,
        completion_status,
        completion_work,
        error,
        created_at
      FROM automation_story_executions
      WHERE automation_run_id = ?
      ORDER BY position_in_queue ASC, id ASC
    `,
    [runId]
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
  createAutomationRun,
  getAutomationRunById,
  updateAutomationRunMetadata,
  recordAutomationStoryExecution,
  getAutomationStoryExecutionsByRunId,
  getCompletionEligibleRuns,
  setRunArchived,
  deleteRunById,
  dbReady
};
