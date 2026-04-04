const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const {
  normalizeContextBundlePartType,
  getContextBundlePartTypeLabel
} = require("./contextBundlePartTypes");

const dataDir = path.resolve(__dirname, "../data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.resolve(dataDir, "app.db");
const db = new sqlite3.Database(dbPath);
db.run("PRAGMA foreign_keys = ON");

const LATEST_SCHEMA_VERSION = 18;
const VALID_AUTOMATION_TYPES = new Set(["feature", "epic", "story"]);
const VALID_AUTOMATION_STATUSES = new Set(["pending", "running", "completed", "failed", "stopped"]);
const VALID_AUTOMATION_STORY_EXECUTION_STATUSES = new Set(["completed", "failed"]);
const VALID_AUTOMATION_STORY_QUEUE_ACTIONS = new Set(["advanced", "stopped", "failed"]);
const AUTOMATION_STATUS_FOR_SUMMARY = new Set(["running", "completed", "failed", "stopped"]);

function normalizeRunOrigin(runInput = {}) {
  const rawType = runInput.automationOriginType ?? runInput.originEntityType ?? null;
  const rawEntityId = runInput.automationOriginId ?? runInput.originEntityId ?? null;
  const rawAutomationRunId = runInput.automationRunId ?? runInput.originAutomationRunId ?? null;

  const automationOriginType = rawType === null || rawType === undefined || rawType === ""
    ? null
    : String(rawType).trim().toLowerCase();
  const automationOriginId = rawEntityId === null || rawEntityId === undefined || rawEntityId === ""
    ? null
    : Number.parseInt(rawEntityId, 10);
  const automationRunId = rawAutomationRunId === null || rawAutomationRunId === undefined || rawAutomationRunId === ""
    ? null
    : Number.parseInt(rawAutomationRunId, 10);

  const hasType = Boolean(automationOriginType);
  const hasEntityId = automationOriginId !== null;

  if (hasType !== hasEntityId) {
    throw new Error("Run automation origin type and target id must be provided together.");
  }

  if (hasType && !VALID_AUTOMATION_TYPES.has(automationOriginType)) {
    throw new Error("Run automation origin type must be feature, epic, or story.");
  }

  if (hasEntityId && (!Number.isInteger(automationOriginId) || automationOriginId <= 0)) {
    throw new Error("Run automation origin target id must be a positive integer.");
  }

  if (automationRunId !== null && (!Number.isInteger(automationRunId) || automationRunId <= 0)) {
    throw new Error("Run automation run id must be a positive integer when provided.");
  }

  return {
    automationOriginType,
    automationOriginId,
    automationRunId
  };
}

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

function runWithChanges(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this.changes);
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

async function indexExists(indexName) {
  const row = await get(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
    [indexName]
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
          if (hasStoryExecutionTable) {
            const hasAutomationScopeContext = await columnExists("automation_runs", "project_name")
              && await columnExists("automation_runs", "base_branch");
            if (hasAutomationScopeContext) {
              const hasRunOriginLinkage = await columnExists("runs", "automation_origin_type")
                && await columnExists("runs", "automation_origin_id")
                && await columnExists("runs", "automation_run_id");
              if (hasRunOriginLinkage) {
                const hasQueueSnapshotTable = await tableExists("automation_run_queue_items");
                if (hasQueueSnapshotTable) {
                  const hasFailedStoryDetails = await columnExists("automation_runs", "failed_story_id")
                    && await columnExists("automation_runs", "failure_summary");
                  if (hasFailedStoryDetails) {
                    const hasActiveTargetIndex = await indexExists("idx_automation_runs_active_target");
                    const hasContextBundleTables = await tableExists("context_bundles")
                      && await tableExists("context_bundle_parts");
                    if (hasContextBundleTables) {
                      const hasBundleMetadata = await columnExists("context_bundles", "intended_use")
                        && await columnExists("context_bundles", "tags")
                        && await columnExists("context_bundles", "project_name")
                        && await columnExists("context_bundles", "summary");
                      if (hasBundleMetadata) return 18;
                      return 17;
                    }
                    if (hasActiveTargetIndex) return 16;
                    return 15;
                  }
                  return 14;
                }
                return 13;
              }
              return 12;
            }
            return 11;
          }
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

async function migrateToV12() {
  await ensureColumn("automation_runs", "project_name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("automation_runs", "base_branch", "TEXT NOT NULL DEFAULT ''");
}

async function migrateToV13() {
  await ensureColumn("runs", "automation_origin_type", "TEXT");
  await ensureColumn("runs", "automation_origin_id", "INTEGER");
  await ensureColumn("runs", "automation_run_id", "INTEGER REFERENCES automation_runs(id) ON DELETE SET NULL");
  await run(`
    CREATE INDEX IF NOT EXISTS idx_runs_automation_origin
    ON runs(automation_origin_type, automation_origin_id)
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS idx_runs_automation_run_id
    ON runs(automation_run_id)
  `);
}

async function migrateToV14() {
  await run(`
    CREATE TABLE IF NOT EXISTS automation_run_queue_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      automation_run_id INTEGER NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
      position_in_queue INTEGER NOT NULL,
      feature_id INTEGER,
      feature_title TEXT,
      epic_id INTEGER,
      epic_title TEXT,
      story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      story_title TEXT,
      story_description TEXT,
      story_created_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(automation_run_id, position_in_queue),
      UNIQUE(automation_run_id, story_id)
    )
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS idx_automation_run_queue_items_run
    ON automation_run_queue_items(automation_run_id, position_in_queue, id)
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS idx_automation_run_queue_items_story
    ON automation_run_queue_items(story_id)
  `);
}

async function migrateToV15() {
  await ensureColumn("automation_runs", "failed_story_id", "INTEGER");
  await ensureColumn("automation_runs", "failure_summary", "TEXT");
}

async function migrateToV16() {
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runs_active_target
    ON automation_runs(automation_type, target_id)
    WHERE automation_status = 'running'
  `);
}

async function migrateToV17() {
  await run(`
    CREATE TABLE IF NOT EXISTS context_bundles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      intended_use TEXT,
      tags TEXT,
      project_name TEXT,
      summary TEXT,
      token_estimate INTEGER,
      is_active INTEGER,
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS context_bundle_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bundle_id INTEGER NOT NULL REFERENCES context_bundles(id) ON DELETE CASCADE,
      part_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      instructions TEXT,
      notes TEXT,
      position INTEGER NOT NULL,
      include_in_compiled INTEGER NOT NULL DEFAULT 1,
      include_in_preview INTEGER NOT NULL DEFAULT 1,
      token_estimate INTEGER,
      is_active INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(bundle_id, position)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_context_bundle_parts_bundle_position
    ON context_bundle_parts(bundle_id, position, id)
  `);
}

async function migrateToV18() {
  await ensureColumn("context_bundles", "intended_use", "TEXT");
  await ensureColumn("context_bundles", "tags", "TEXT");
  await ensureColumn("context_bundles", "project_name", "TEXT");
  await ensureColumn("context_bundles", "summary", "TEXT");
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

  if (version < 12) {
    await migrateToV12();
    version = 12;
    await setSchemaVersion(version);
  }

  if (version < 13) {
    await migrateToV13();
    version = 13;
    await setSchemaVersion(version);
  }

  if (version < 14) {
    await migrateToV14();
    version = 14;
    await setSchemaVersion(version);
  }

  if (version < 15) {
    await migrateToV15();
    version = 15;
    await setSchemaVersion(version);
  }

  if (version < 16) {
    await migrateToV16();
    version = 16;
    await setSchemaVersion(version);
  }

  if (version < 17) {
    await migrateToV17();
    version = 17;
    await setSchemaVersion(version);
  }

  if (version < 18) {
    await migrateToV18();
    version = 18;
    await setSchemaVersion(version);
  }

  if (version > LATEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version ${version}. Latest supported is ${LATEST_SCHEMA_VERSION}.`);
  }
}

const dbReady = runMigrations();

function normalizeNullableInteger(value, fieldName) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative integer when provided.`);
  }

  return parsed;
}

function normalizeNullableFlag(value, fieldName) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value === true || value === false) {
    return value ? 1 : 0;
  }

  const parsed = Number.parseInt(value, 10);
  if (parsed === 0 || parsed === 1) {
    return parsed;
  }

  throw new Error(`${fieldName} must be 0 or 1 when provided.`);
}

function normalizePositiveInteger(value, fieldName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return parsed;
}

function normalizeNullableText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeBundleTags(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const sourceTags = Array.isArray(value)
    ? value
    : String(value).split(",");
  const normalizedTags = [...new Set(
    sourceTags
      .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
      .filter(Boolean)
  )];

  if (normalizedTags.length <= 0) {
    return null;
  }

  return JSON.stringify(normalizedTags);
}

function parseBundleTags(value) {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
        .filter(Boolean);
    }
  } catch (error) {
    // Preserve backward compatibility with any legacy comma-separated values.
  }

  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function decorateContextBundle(bundle) {
  if (!bundle || typeof bundle !== "object") {
    return bundle;
  }

  return {
    ...bundle,
    tags: parseBundleTags(bundle.tags)
  };
}

function decorateContextBundlePart(part) {
  if (!part || typeof part !== "object") {
    return part;
  }

  return {
    ...part,
    part_type_label: getContextBundlePartTypeLabel(part.part_type)
  };
}

function buildCopiedBundleTitle(title) {
  const baseTitle = String(title || "").trim() || "Untitled Bundle";
  return `${baseTitle} (Copy)`;
}

async function createContextBundle(input = {}) {
  await dbReady;

  const title = String(input.title || "").trim();
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const status = String(input.status || "draft").trim().toLowerCase();
  const intendedUse = normalizeNullableText(input.intendedUse ?? input.intended_use);
  const tags = normalizeBundleTags(input.tags);
  const projectName = normalizeNullableText(input.projectName ?? input.project_name);
  const summary = normalizeNullableText(input.summary);
  const tokenEstimate = normalizeNullableInteger(input.tokenEstimate, "Bundle token estimate");
  const isActive = normalizeNullableFlag(input.isActive, "Bundle active flag");
  const lastUsedAt = typeof input.lastUsedAt === "string" && input.lastUsedAt.trim()
    ? input.lastUsedAt.trim()
    : null;

  if (!title) {
    throw new Error("Context bundle title is required.");
  }

  if (!status) {
    throw new Error("Context bundle status is required.");
  }

  const id = await runWithLastId(
    `
      INSERT INTO context_bundles
      (
        title,
        description,
        status,
        intended_use,
        tags,
        project_name,
        summary,
        token_estimate,
        is_active,
        last_used_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [title, description, status, intendedUse, tags, projectName, summary, tokenEstimate, isActive, lastUsedAt]
  );

  return getContextBundleById(id);
}

async function getContextBundleById(id, options = {}) {
  await dbReady;

  const bundleId = Number.parseInt(id, 10);
  if (!Number.isInteger(bundleId) || bundleId <= 0) {
    return null;
  }

  const bundle = await get(
    `
      SELECT
        id,
        title,
        description,
        status,
        intended_use,
        tags,
        project_name,
        summary,
        token_estimate,
        is_active,
        last_used_at,
        created_at,
        updated_at
      FROM context_bundles
      WHERE id = ?
    `,
    [bundleId]
  );

  if (!bundle) {
    return null;
  }

  if (options.includeParts === false) {
    return decorateContextBundle(bundle);
  }

  const parts = await getContextBundlePartsByBundleId(bundle.id);
  return {
    ...decorateContextBundle(bundle),
    parts
  };
}

async function getContextBundles(options = {}) {
  await dbReady;

  const bundles = await all(
    `
      SELECT
        id,
        title,
        description,
        status,
        intended_use,
        tags,
        project_name,
        summary,
        token_estimate,
        is_active,
        last_used_at,
        created_at,
        updated_at
      FROM context_bundles
      ORDER BY id DESC
    `
  );

  if (options.includeParts === false || bundles.length <= 0) {
    return bundles.map((bundle) => decorateContextBundle(bundle));
  }

  const bundleIds = bundles.map((bundle) => bundle.id);
  const placeholders = bundleIds.map(() => "?").join(", ");
  const parts = await all(
    `
      SELECT
        id,
        bundle_id,
        part_type,
        title,
        content,
        instructions,
        notes,
        position,
        include_in_compiled,
        include_in_preview,
        token_estimate,
        is_active,
        created_at,
        updated_at
      FROM context_bundle_parts
      WHERE bundle_id IN (${placeholders})
      ORDER BY bundle_id ASC, position ASC, id ASC
    `,
    bundleIds
  );

  const partsByBundleId = new Map();
  for (const part of parts) {
    const existing = partsByBundleId.get(part.bundle_id) || [];
    existing.push(decorateContextBundlePart(part));
    partsByBundleId.set(part.bundle_id, existing);
  }

  return bundles.map((bundle) => ({
    ...decorateContextBundle(bundle),
    parts: partsByBundleId.get(bundle.id) || []
  }));
}

async function updateContextBundle(id, updates = {}) {
  await dbReady;

  const bundleId = normalizePositiveInteger(id, "Context bundle id");
  const clauses = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(updates, "title")) {
    const title = String(updates.title || "").trim();
    if (!title) {
      throw new Error("Context bundle title is required.");
    }
    clauses.push("title = ?");
    params.push(title);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "description")) {
    clauses.push("description = ?");
    params.push(typeof updates.description === "string" ? updates.description.trim() : "");
  }

  if (Object.prototype.hasOwnProperty.call(updates, "status")) {
    const status = String(updates.status || "").trim().toLowerCase();
    if (!status) {
      throw new Error("Context bundle status is required.");
    }
    clauses.push("status = ?");
    params.push(status);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "intendedUse")
    || Object.prototype.hasOwnProperty.call(updates, "intended_use")) {
    clauses.push("intended_use = ?");
    params.push(normalizeNullableText(updates.intendedUse ?? updates.intended_use));
  }

  if (Object.prototype.hasOwnProperty.call(updates, "tags")) {
    clauses.push("tags = ?");
    params.push(normalizeBundleTags(updates.tags));
  }

  if (Object.prototype.hasOwnProperty.call(updates, "projectName")
    || Object.prototype.hasOwnProperty.call(updates, "project_name")) {
    clauses.push("project_name = ?");
    params.push(normalizeNullableText(updates.projectName ?? updates.project_name));
  }

  if (Object.prototype.hasOwnProperty.call(updates, "summary")) {
    clauses.push("summary = ?");
    params.push(normalizeNullableText(updates.summary));
  }

  if (Object.prototype.hasOwnProperty.call(updates, "tokenEstimate")) {
    clauses.push("token_estimate = ?");
    params.push(normalizeNullableInteger(updates.tokenEstimate, "Bundle token estimate"));
  }

  if (Object.prototype.hasOwnProperty.call(updates, "isActive")) {
    clauses.push("is_active = ?");
    params.push(normalizeNullableFlag(updates.isActive, "Bundle active flag"));
  }

  if (Object.prototype.hasOwnProperty.call(updates, "lastUsedAt")) {
    const lastUsedAt = typeof updates.lastUsedAt === "string" && updates.lastUsedAt.trim()
      ? updates.lastUsedAt.trim()
      : null;
    clauses.push("last_used_at = ?");
    params.push(lastUsedAt);
  }

  if (clauses.length <= 0) {
    throw new Error("At least one context bundle field must be provided.");
  }

  clauses.push("updated_at = CURRENT_TIMESTAMP");
  params.push(bundleId);

  await run(
    `
      UPDATE context_bundles
      SET ${clauses.join(", ")}
      WHERE id = ?
    `,
    params
  );

  return getContextBundleById(bundleId);
}

async function deleteContextBundleById(id) {
  await dbReady;

  const bundleId = Number.parseInt(id, 10);
  if (!Number.isInteger(bundleId) || bundleId <= 0) {
    return 0;
  }

  return runWithChanges(
    `
      DELETE FROM context_bundles
      WHERE id = ?
    `,
    [bundleId]
  );
}

async function duplicateContextBundleById(id) {
  await dbReady;

  const bundleId = Number.parseInt(id, 10);
  if (!Number.isInteger(bundleId) || bundleId <= 0) {
    return null;
  }

  const sourceBundle = await getContextBundleById(bundleId);
  if (!sourceBundle) {
    return null;
  }

  const sourceParts = [...(Array.isArray(sourceBundle.parts) ? sourceBundle.parts : [])]
    .sort((left, right) => {
      const positionDelta = Number(left.position) - Number(right.position);
      if (positionDelta !== 0) return positionDelta;
      return Number(left.id) - Number(right.id);
    });

  await run("BEGIN TRANSACTION");
  try {
    const duplicatedBundleId = await runWithLastId(
      `
        INSERT INTO context_bundles
        (
          title,
          description,
          status,
          intended_use,
          tags,
          project_name,
          summary,
          token_estimate,
          is_active,
          last_used_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        buildCopiedBundleTitle(sourceBundle.title),
        sourceBundle.description || "",
        sourceBundle.status || "draft",
        normalizeNullableText(sourceBundle.intended_use),
        normalizeBundleTags(sourceBundle.tags),
        normalizeNullableText(sourceBundle.project_name),
        normalizeNullableText(sourceBundle.summary),
        normalizeNullableInteger(sourceBundle.token_estimate, "Bundle token estimate"),
        normalizeNullableFlag(sourceBundle.is_active, "Bundle active flag"),
        typeof sourceBundle.last_used_at === "string" && sourceBundle.last_used_at.trim()
          ? sourceBundle.last_used_at.trim()
          : null
      ]
    );

    for (const part of sourceParts) {
      await runWithLastId(
        `
          INSERT INTO context_bundle_parts
          (
            bundle_id,
            part_type,
            title,
            content,
            instructions,
            notes,
            position,
            include_in_compiled,
            include_in_preview,
            token_estimate,
            is_active
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          duplicatedBundleId,
          part.part_type,
          part.title,
          part.content || "",
          typeof part.instructions === "string" && part.instructions.trim() ? part.instructions : null,
          typeof part.notes === "string" && part.notes.trim() ? part.notes : null,
          part.position,
          Number(part.include_in_compiled) === 0 ? 0 : 1,
          Number(part.include_in_preview) === 0 ? 0 : 1,
          normalizeNullableInteger(part.token_estimate, "Part token estimate"),
          normalizeNullableFlag(part.is_active, "Part active flag")
        ]
      );
    }

    await run("COMMIT");
    return getContextBundleById(duplicatedBundleId);
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }
}

async function createContextBundlePart(input = {}) {
  await dbReady;

  const bundleId = normalizePositiveInteger(input.bundleId, "Context bundle id");
  const partType = normalizeContextBundlePartType(
    input.partType || input.type,
    "Context bundle part type"
  );
  const title = String(input.title || "").trim();
  const content = typeof input.content === "string"
    ? input.content
    : (typeof input.body === "string" ? input.body : "");
  const instructions = typeof input.instructions === "string" && input.instructions.trim()
    ? input.instructions
    : null;
  const notes = typeof input.notes === "string" && input.notes.trim()
    ? input.notes
    : null;
  const position = normalizePositiveInteger(input.position, "Context bundle part position");
  const includeInCompiled = Object.prototype.hasOwnProperty.call(input, "includeInCompiled")
    ? (normalizeNullableFlag(input.includeInCompiled, "Part include_in_compiled flag") ?? 1)
    : 1;
  const includeInPreview = Object.prototype.hasOwnProperty.call(input, "includeInPreview")
    ? (normalizeNullableFlag(input.includeInPreview, "Part include_in_preview flag") ?? 1)
    : 1;
  const tokenEstimate = normalizeNullableInteger(input.tokenEstimate, "Part token estimate");
  const isActive = normalizeNullableFlag(input.isActive, "Part active flag");

  if (!title) {
    throw new Error("Context bundle part title is required.");
  }

  const bundle = await get(
    `
      SELECT id
      FROM context_bundles
      WHERE id = ?
    `,
    [bundleId]
  );
  if (!bundle) {
    throw new Error("Context bundle not found.");
  }

  const id = await runWithLastId(
    `
      INSERT INTO context_bundle_parts
      (
        bundle_id,
        part_type,
        title,
        content,
        instructions,
        notes,
        position,
        include_in_compiled,
        include_in_preview,
        token_estimate,
        is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      bundleId,
      partType,
      title,
      content,
      instructions,
      notes,
      position,
      includeInCompiled,
      includeInPreview,
      tokenEstimate,
      isActive
    ]
  );

  return getContextBundlePartById(id);
}

async function getContextBundlePartById(id) {
  await dbReady;

  const partId = Number.parseInt(id, 10);
  if (!Number.isInteger(partId) || partId <= 0) {
    return null;
  }

  const part = await get(
    `
      SELECT
        id,
        bundle_id,
        part_type,
        title,
        content,
        instructions,
        notes,
        position,
        include_in_compiled,
        include_in_preview,
        token_estimate,
        is_active,
        created_at,
        updated_at
      FROM context_bundle_parts
      WHERE id = ?
    `,
    [partId]
  );

  return decorateContextBundlePart(part);
}

async function getContextBundlePartsByBundleId(bundleId) {
  await dbReady;

  const normalizedBundleId = Number.parseInt(bundleId, 10);
  if (!Number.isInteger(normalizedBundleId) || normalizedBundleId <= 0) {
    return [];
  }

  const parts = await all(
    `
      SELECT
        id,
        bundle_id,
        part_type,
        title,
        content,
        instructions,
        notes,
        position,
        include_in_compiled,
        include_in_preview,
        token_estimate,
        is_active,
        created_at,
        updated_at
      FROM context_bundle_parts
      WHERE bundle_id = ?
      ORDER BY position ASC, id ASC
    `,
    [normalizedBundleId]
  );

  return parts.map((part) => decorateContextBundlePart(part));
}

async function updateContextBundlePart(id, updates = {}) {
  await dbReady;

  const partId = normalizePositiveInteger(id, "Context bundle part id");
  const clauses = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(updates, "partType")
    || Object.prototype.hasOwnProperty.call(updates, "type")) {
    const partType = normalizeContextBundlePartType(
      updates.partType || updates.type,
      "Context bundle part type"
    );
    clauses.push("part_type = ?");
    params.push(partType);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "title")) {
    const title = String(updates.title || "").trim();
    if (!title) {
      throw new Error("Context bundle part title is required.");
    }
    clauses.push("title = ?");
    params.push(title);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "content")
    || Object.prototype.hasOwnProperty.call(updates, "body")) {
    const content = typeof updates.content === "string"
      ? updates.content
      : (typeof updates.body === "string" ? updates.body : "");
    clauses.push("content = ?");
    params.push(content);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "instructions")) {
    const instructions = typeof updates.instructions === "string" && updates.instructions.trim()
      ? updates.instructions
      : null;
    clauses.push("instructions = ?");
    params.push(instructions);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "notes")) {
    const notes = typeof updates.notes === "string" && updates.notes.trim()
      ? updates.notes
      : null;
    clauses.push("notes = ?");
    params.push(notes);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "position")) {
    clauses.push("position = ?");
    params.push(normalizePositiveInteger(updates.position, "Context bundle part position"));
  }

  if (Object.prototype.hasOwnProperty.call(updates, "includeInCompiled")) {
    const includeInCompiled = normalizeNullableFlag(
      updates.includeInCompiled,
      "Part include_in_compiled flag"
    );
    clauses.push("include_in_compiled = ?");
    params.push(includeInCompiled === null ? 1 : includeInCompiled);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "includeInPreview")) {
    const includeInPreview = normalizeNullableFlag(
      updates.includeInPreview,
      "Part include_in_preview flag"
    );
    clauses.push("include_in_preview = ?");
    params.push(includeInPreview === null ? 1 : includeInPreview);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "tokenEstimate")) {
    clauses.push("token_estimate = ?");
    params.push(normalizeNullableInteger(updates.tokenEstimate, "Part token estimate"));
  }

  if (Object.prototype.hasOwnProperty.call(updates, "isActive")) {
    clauses.push("is_active = ?");
    params.push(normalizeNullableFlag(updates.isActive, "Part active flag"));
  }

  if (clauses.length <= 0) {
    throw new Error("At least one context bundle part field must be provided.");
  }

  clauses.push("updated_at = CURRENT_TIMESTAMP");
  params.push(partId);

  await run(
    `
      UPDATE context_bundle_parts
      SET ${clauses.join(", ")}
      WHERE id = ?
    `,
    params
  );

  return getContextBundlePartById(partId);
}

async function deleteContextBundlePartById(id) {
  await dbReady;

  const partId = Number.parseInt(id, 10);
  if (!Number.isInteger(partId) || partId <= 0) {
    return 0;
  }

  return runWithChanges(
    `
      DELETE FROM context_bundle_parts
      WHERE id = ?
    `,
    [partId]
  );
}

function saveRun(runInput) {
  return new Promise((resolve, reject) => {
    dbReady
      .then(() => {
        const runOrigin = normalizeRunOrigin(runInput);
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
            run_end_time,
            automation_origin_type,
            automation_origin_id,
            automation_run_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            runInput.runEndTime,
            runOrigin.automationOriginType,
            runOrigin.automationOriginId,
            runOrigin.automationRunId
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
             automation_origin_type,
             automation_origin_id,
             automation_run_id,
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

  const featureIds = features.map((feature) => feature.id).filter((id) => Number.isInteger(id) && id > 0);
  const epicIds = epics.map((epic) => epic.id).filter((id) => Number.isInteger(id) && id > 0);
  const storyIds = stories.map((story) => story.id).filter((id) => Number.isInteger(id) && id > 0);
  let latestFeatureAutomationByFeatureId = new Map();
  let latestEpicAutomationByEpicId = new Map();
  let latestStoryAutomationByStoryId = new Map();

  async function getLatestAutomationByTargetId(automationType, targetIds) {
    if (targetIds.length <= 0) {
      return new Map();
    }

    const placeholders = targetIds.map(() => "?").join(", ");
    const automationRows = await all(
      `
        SELECT
          id,
          target_id,
          automation_status,
          stop_reason,
          created_at,
          updated_at
        FROM automation_runs
        WHERE automation_type = ?
          AND target_id IN (${placeholders})
          AND (
            (project_name = ? AND base_branch = ?)
            OR (COALESCE(project_name, '') = '' AND COALESCE(base_branch, '') = '')
          )
        ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
      `,
      [automationType, ...targetIds, projectName, baseBranch]
    );

    const latestByTargetId = new Map();
    for (const row of automationRows) {
      const targetId = Number.parseInt(row?.target_id, 10);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        continue;
      }

      if (!latestByTargetId.has(targetId)) {
        const rawStatus = String(row?.automation_status || "").trim().toLowerCase();
        const normalizedStatus = AUTOMATION_STATUS_FOR_SUMMARY.has(rawStatus)
          ? rawStatus
          : "not_started";

        latestByTargetId.set(targetId, {
          automation_run_id: Number.parseInt(row?.id, 10) || null,
          automation_status: normalizedStatus,
          automation_stop_reason: row?.stop_reason || null,
          automation_updated_at: row?.updated_at || row?.created_at || null
        });
      }
    }

    return latestByTargetId;
  }

  if (featureIds.length > 0 || epicIds.length > 0 || storyIds.length > 0) {
    [
      latestFeatureAutomationByFeatureId,
      latestEpicAutomationByEpicId,
      latestStoryAutomationByStoryId
    ] = await Promise.all([
      getLatestAutomationByTargetId("feature", featureIds),
      getLatestAutomationByTargetId("epic", epicIds),
      getLatestAutomationByTargetId("story", storyIds)
    ]);
  }

  const featuresById = new Map(features.map((feature) => {
    const latestFeatureAutomation = latestFeatureAutomationByFeatureId.get(feature.id) || null;
    return [feature.id, {
      ...feature,
      feature_automation_run_id: latestFeatureAutomation?.feature_automation_run_id ?? null,
      feature_automation_status: latestFeatureAutomation?.feature_automation_status || "not_started",
      feature_automation_stop_reason: latestFeatureAutomation?.feature_automation_stop_reason ?? null,
      feature_automation_updated_at: latestFeatureAutomation?.feature_automation_updated_at ?? null,
      epics: []
    }];
  }));
  const epicsById = new Map();

  for (const epic of epics) {
    const latestEpicAutomation = latestEpicAutomationByEpicId.get(epic.id) || null;
    const hydratedEpic = {
      ...epic,
      epic_automation_run_id: latestEpicAutomation?.automation_run_id ?? null,
      epic_automation_status: latestEpicAutomation?.automation_status || "not_started",
      epic_automation_stop_reason: latestEpicAutomation?.automation_stop_reason ?? null,
      epic_automation_updated_at: latestEpicAutomation?.automation_updated_at ?? null,
      stories: []
    };
    epicsById.set(epic.id, hydratedEpic);
    const parentFeature = featuresById.get(epic.feature_id);
    if (parentFeature) {
      parentFeature.epics.push(hydratedEpic);
    }
  }

  for (const story of stories) {
    const parentEpic = epicsById.get(story.epic_id);
    if (!parentEpic) continue;
    const latestStoryAutomation = latestStoryAutomationByStoryId.get(story.id) || null;

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
      is_complete: isComplete,
      story_automation_run_id: latestStoryAutomation?.automation_run_id ?? null,
      story_automation_status: latestStoryAutomation?.automation_status || "not_started",
      story_automation_stop_reason: latestStoryAutomation?.automation_stop_reason ?? null,
      story_automation_updated_at: latestStoryAutomation?.automation_updated_at ?? null
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
  const projectName = String(input.projectName || "").trim();
  const baseBranch = String(input.baseBranch || "").trim();
  const targetId = Number.parseInt(input.targetId, 10);
  const stopFlag = input.stopFlag ? 1 : 0;
  const stopOnIncomplete = input.stopOnIncomplete ? 1 : 0;
  const currentPosition = Number.parseInt(input.currentPosition ?? 1, 10);
  const stopReason = typeof input.stopReason === "string" && input.stopReason.trim()
    ? input.stopReason.trim()
    : null;
  const failedStoryId = input.failedStoryId === null || input.failedStoryId === undefined || input.failedStoryId === ""
    ? null
    : Number.parseInt(input.failedStoryId, 10);
  const failureSummary = typeof input.failureSummary === "string" && input.failureSummary.trim()
    ? input.failureSummary.trim()
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
  if (!projectName) {
    throw new Error("Project name is required.");
  }
  if (!baseBranch) {
    throw new Error("Base branch is required.");
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
  if (failedStoryId !== null && (!Number.isInteger(failedStoryId) || failedStoryId <= 0)) {
    throw new Error("Failed story id must be a positive integer when provided.");
  }

  let id;
  try {
    id = await runWithLastId(
      `
        INSERT INTO automation_runs
        (
          automation_type,
          target_id,
          project_name,
          base_branch,
          stop_flag,
          stop_on_incomplete,
          current_position,
          automation_status,
          stop_reason,
          failed_story_id,
          failure_summary
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        automationType,
        targetId,
        projectName,
        baseBranch,
        stopFlag,
        stopOnIncomplete,
        currentPosition,
        automationStatus,
        stopReason,
        failedStoryId,
        failureSummary
      ]
    );
  } catch (error) {
    const normalizedCode = String(error?.code || "").trim().toLowerCase();
    const normalizedMessage = String(error?.message || "").trim().toLowerCase();
    const isActiveTargetConflict = (
      automationStatus === "running"
      && (normalizedCode === "sqlite_constraint" || normalizedCode === "sqlite_constraint_unique")
      && normalizedMessage.includes("automation_runs.automation_type")
      && normalizedMessage.includes("automation_runs.target_id")
    );
    if (isActiveTargetConflict) {
      const conflictError = new Error(`Automation is already running for ${automationType} #${targetId}.`);
      conflictError.code = "automation_target_conflict";
      conflictError.automationType = automationType;
      conflictError.targetId = targetId;
      conflictError.projectName = projectName;
      conflictError.baseBranch = baseBranch;
      conflictError.cause = error;
      throw conflictError;
    }

    throw error;
  }

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
        project_name,
        base_branch,
        stop_flag,
        stop_on_incomplete,
        current_position,
        automation_status,
        stop_reason,
        failed_story_id,
        failure_summary,
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

  if (Object.prototype.hasOwnProperty.call(updates, "failedStoryId")) {
    const failedStoryId = updates.failedStoryId === null || updates.failedStoryId === undefined || updates.failedStoryId === ""
      ? null
      : Number.parseInt(updates.failedStoryId, 10);
    if (failedStoryId !== null && (!Number.isInteger(failedStoryId) || failedStoryId <= 0)) {
      throw new Error("Failed story id must be a positive integer when provided.");
    }
    updateClauses.push("failed_story_id = ?");
    params.push(failedStoryId);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "failureSummary")) {
    const failureSummary = typeof updates.failureSummary === "string" && updates.failureSummary.trim()
      ? updates.failureSummary.trim()
      : null;
    updateClauses.push("failure_summary = ?");
    params.push(failureSummary);
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

async function findRunningAutomationByScope(input = {}) {
  await dbReady;

  const automationType = String(input.automationType || "").trim().toLowerCase();
  const targetId = Number.parseInt(input.targetId, 10);
  const excludeAutomationRunId = input.excludeAutomationRunId === null || input.excludeAutomationRunId === undefined || input.excludeAutomationRunId === ""
    ? null
    : Number.parseInt(input.excludeAutomationRunId, 10);

  if (!VALID_AUTOMATION_TYPES.has(automationType)) {
    return null;
  }

  if (!Number.isInteger(targetId) || targetId <= 0) {
    return null;
  }

  if (excludeAutomationRunId !== null && (!Number.isInteger(excludeAutomationRunId) || excludeAutomationRunId <= 0)) {
    throw new Error("Exclude automation run id must be a positive integer when provided.");
  }

  if (excludeAutomationRunId !== null) {
    return get(
      `
        SELECT
          id,
          automation_type,
          target_id,
          project_name,
          base_branch,
          stop_flag,
          stop_on_incomplete,
          current_position,
          automation_status,
          stop_reason,
          created_at,
          updated_at
        FROM automation_runs
        WHERE automation_type = ?
          AND target_id = ?
          AND automation_status = 'running'
          AND id <> ?
        ORDER BY id DESC
        LIMIT 1
      `,
      [automationType, targetId, excludeAutomationRunId]
    );
  }

  return get(
    `
      SELECT
        id,
        automation_type,
        target_id,
        project_name,
        base_branch,
        stop_flag,
        stop_on_incomplete,
        current_position,
        automation_status,
        stop_reason,
        created_at,
        updated_at
      FROM automation_runs
      WHERE automation_type = ?
        AND target_id = ?
        AND automation_status = 'running'
      ORDER BY id DESC
      LIMIT 1
    `,
    [automationType, targetId]
  );
}

function normalizeQueueSnapshotStory(inputStory = {}) {
  const positionInQueue = Number.parseInt(inputStory.positionInQueue, 10);
  const storyId = Number.parseInt(inputStory.storyId, 10);
  const featureId = inputStory.featureId === null || inputStory.featureId === undefined || inputStory.featureId === ""
    ? null
    : Number.parseInt(inputStory.featureId, 10);
  const epicId = inputStory.epicId === null || inputStory.epicId === undefined || inputStory.epicId === ""
    ? null
    : Number.parseInt(inputStory.epicId, 10);

  if (!Number.isInteger(positionInQueue) || positionInQueue <= 0) {
    throw new Error("Queue snapshot position must be a positive integer.");
  }

  if (!Number.isInteger(storyId) || storyId <= 0) {
    throw new Error("Queue snapshot story id must be a positive integer.");
  }

  if (featureId !== null && (!Number.isInteger(featureId) || featureId <= 0)) {
    throw new Error("Queue snapshot feature id must be a positive integer when provided.");
  }

  if (epicId !== null && (!Number.isInteger(epicId) || epicId <= 0)) {
    throw new Error("Queue snapshot epic id must be a positive integer when provided.");
  }

  return {
    positionInQueue,
    featureId,
    featureTitle: inputStory.featureTitle ?? null,
    epicId,
    epicTitle: inputStory.epicTitle ?? null,
    storyId,
    storyTitle: inputStory.storyTitle ?? null,
    storyDescription: inputStory.storyDescription ?? null,
    storyCreatedAt: inputStory.storyCreatedAt ?? null
  };
}

async function recordAutomationRunQueueItems(input = {}) {
  await dbReady;

  const automationRunId = Number.parseInt(input.automationRunId, 10);
  if (!Number.isInteger(automationRunId) || automationRunId <= 0) {
    throw new Error("Automation run id must be a positive integer.");
  }

  const stories = Array.isArray(input.stories) ? input.stories : [];
  if (stories.length <= 0) {
    throw new Error("Queue snapshot stories are required.");
  }

  const normalizedStories = stories.map((story) => normalizeQueueSnapshotStory(story));
  await run(
    `
      DELETE FROM automation_run_queue_items
      WHERE automation_run_id = ?
    `,
    [automationRunId]
  );

  for (const story of normalizedStories) {
    await runWithLastId(
      `
        INSERT INTO automation_run_queue_items
        (
          automation_run_id,
          position_in_queue,
          feature_id,
          feature_title,
          epic_id,
          epic_title,
          story_id,
          story_title,
          story_description,
          story_created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        automationRunId,
        story.positionInQueue,
        story.featureId,
        story.featureTitle,
        story.epicId,
        story.epicTitle,
        story.storyId,
        story.storyTitle,
        story.storyDescription,
        story.storyCreatedAt
      ]
    );
  }
}

async function getAutomationRunQueueItemsByRunId(automationRunId) {
  await dbReady;

  const runId = Number.parseInt(automationRunId, 10);
  if (!Number.isInteger(runId) || runId <= 0) {
    return [];
  }

  const rows = await all(
    `
      SELECT
        id,
        automation_run_id,
        position_in_queue,
        feature_id,
        feature_title,
        epic_id,
        epic_title,
        story_id,
        story_title,
        story_description,
        story_created_at,
        created_at
      FROM automation_run_queue_items
      WHERE automation_run_id = ?
      ORDER BY position_in_queue ASC, id ASC
    `,
    [runId]
  );

  return rows.map((row) => ({
    id: row.id,
    automationRunId: row.automation_run_id,
    positionInQueue: row.position_in_queue,
    featureId: row.feature_id,
    featureTitle: row.feature_title,
    epicId: row.epic_id,
    epicTitle: row.epic_title,
    storyId: row.story_id,
    storyTitle: row.story_title,
    storyDescription: row.story_description,
    storyCreatedAt: row.story_created_at,
    createdAt: row.created_at
  }));
}

async function getAutomationQueueStoriesByTarget(automationType, targetId) {
  await dbReady;

  const normalizedType = String(automationType || "").trim().toLowerCase();
  const normalizedTargetId = Number.parseInt(targetId, 10);

  if (!VALID_AUTOMATION_TYPES.has(normalizedType)) {
    return [];
  }

  if (!Number.isInteger(normalizedTargetId) || normalizedTargetId <= 0) {
    return [];
  }

  let rows = [];

  if (normalizedType === "feature") {
    rows = await all(
      `
        SELECT
          features.id AS feature_id,
          features.name AS feature_title,
          epics.id AS epic_id,
          epics.name AS epic_title,
          stories.id AS story_id,
          stories.name AS story_title,
          stories.description AS story_description,
          stories.created_at AS story_created_at
        FROM features
        INNER JOIN epics
          ON epics.feature_id = features.id
        INNER JOIN stories
          ON stories.epic_id = epics.id
        WHERE features.id = ?
        ORDER BY
          datetime(epics.created_at) ASC,
          epics.id ASC,
          datetime(stories.created_at) ASC,
          stories.id ASC
      `,
      [normalizedTargetId]
    );
  }

  if (normalizedType === "epic") {
    rows = await all(
      `
        SELECT
          features.id AS feature_id,
          features.name AS feature_title,
          epics.id AS epic_id,
          epics.name AS epic_title,
          stories.id AS story_id,
          stories.name AS story_title,
          stories.description AS story_description,
          stories.created_at AS story_created_at
        FROM epics
        INNER JOIN features
          ON features.id = epics.feature_id
        INNER JOIN stories
          ON stories.epic_id = epics.id
        WHERE epics.id = ?
        ORDER BY
          datetime(stories.created_at) ASC,
          stories.id ASC
      `,
      [normalizedTargetId]
    );
  }

  if (normalizedType === "story") {
    rows = await all(
      `
        SELECT
          features.id AS feature_id,
          features.name AS feature_title,
          epics.id AS epic_id,
          epics.name AS epic_title,
          stories.id AS story_id,
          stories.name AS story_title,
          stories.description AS story_description,
          stories.created_at AS story_created_at
        FROM stories
        INNER JOIN epics
          ON epics.id = stories.epic_id
        INNER JOIN features
          ON features.id = epics.feature_id
        WHERE stories.id = ?
        ORDER BY
          datetime(stories.created_at) ASC,
          stories.id ASC
      `,
      [normalizedTargetId]
    );
  }

  return rows.map((row, index) => ({
    positionInQueue: index + 1,
    featureId: row.feature_id,
    featureTitle: row.feature_title,
    epicId: row.epic_id,
    epicTitle: row.epic_title,
    storyId: row.story_id,
    storyTitle: row.story_title,
    storyDescription: row.story_description,
    storyCreatedAt: row.story_created_at
  }));
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
      .then(async () => {
        const runId = Number.parseInt(id, 10);
        if (!Number.isInteger(runId) || runId <= 0) {
          resolve(0);
          return;
        }

        await run(
          `
            UPDATE stories
            SET
              run_id = CASE WHEN run_id = ? THEN NULL ELSE run_id END,
              completion_run_id = CASE WHEN completion_run_id = ? THEN NULL ELSE completion_run_id END,
              is_complete = CASE
                WHEN run_id = ? OR completion_run_id = ? THEN 0
                ELSE is_complete
              END,
              completed_at = CASE
                WHEN run_id = ? OR completion_run_id = ? THEN NULL
                ELSE completed_at
              END
            WHERE run_id = ? OR completion_run_id = ?
          `,
          [runId, runId, runId, runId, runId, runId, runId, runId]
        );

        db.run(
          `DELETE FROM runs WHERE id = ?`,
          [runId],
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
  createContextBundle,
  getContextBundleById,
  getContextBundles,
  updateContextBundle,
  deleteContextBundleById,
  duplicateContextBundleById,
  createContextBundlePart,
  getContextBundlePartById,
  getContextBundlePartsByBundleId,
  updateContextBundlePart,
  deleteContextBundlePartById,
  getStoryAutomationContext,
  attachRunToStory,
  syncStoryCompletionFromRun,
  createAutomationRun,
  getAutomationRunById,
  findRunningAutomationByScope,
  updateAutomationRunMetadata,
  recordAutomationRunQueueItems,
  recordAutomationStoryExecution,
  getAutomationStoryExecutionsByRunId,
  getAutomationRunQueueItemsByRunId,
  getAutomationQueueStoriesByTarget,
  getCompletionEligibleRuns,
  setRunArchived,
  deleteRunById,
  dbReady
};
