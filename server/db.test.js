const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const sqlite3 = require("sqlite3").verbose();
const { CONTEXT_BUNDLE_PART_TYPES } = require("./contextBundlePartTypes");

const {
  dbReady,
  saveRun,
  getRunById,
  getRuns,
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
  deleteRunById
} = require("./db");

const dbPath = path.resolve(__dirname, "../data/app.db");

function getDbRow(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    db.get(sql, params, (err, row) => {
      db.close();
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function cleanupAutomationRun(id) {
  return new Promise((resolve, reject) => {
    if (!Number.isInteger(id) || id <= 0) {
      resolve();
      return;
    }

    const db = new sqlite3.Database(dbPath);
    db.run("DELETE FROM automation_runs WHERE id = ?", [id], (err) => {
      db.close();
      if (err) return reject(err);
      resolve();
    });
  });
}

function cleanupAutomationStoryExecutions(automationRunId) {
  return new Promise((resolve, reject) => {
    if (!Number.isInteger(automationRunId) || automationRunId <= 0) {
      resolve();
      return;
    }

    const db = new sqlite3.Database(dbPath);
    db.run("DELETE FROM automation_story_executions WHERE automation_run_id = ?", [automationRunId], (err) => {
      db.close();
      if (err) return reject(err);
      resolve();
    });
  });
}

function cleanupRun(id) {
  return new Promise((resolve, reject) => {
    if (!Number.isInteger(id) || id <= 0) {
      resolve();
      return;
    }

    const db = new sqlite3.Database(dbPath);
    db.run("DELETE FROM runs WHERE id = ?", [id], (err) => {
      db.close();
      if (err) return reject(err);
      resolve();
    });
  });
}

function cleanupFeatureScope(scope = {}) {
  return new Promise((resolve, reject) => {
    const projectName = String(scope?.projectName || "").trim();
    const baseBranch = String(scope?.baseBranch || "").trim();
    if (!projectName || !baseBranch) {
      resolve();
      return;
    }

    const db = new sqlite3.Database(dbPath);
    db.run(
      "DELETE FROM features WHERE project_name = ? AND base_branch = ?",
      [projectName, baseBranch],
      (err) => {
        db.close();
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function cleanupContextBundle(id) {
  return new Promise((resolve, reject) => {
    if (!Number.isInteger(id) || id <= 0) {
      resolve();
      return;
    }

    const db = new sqlite3.Database(dbPath);
    db.run("DELETE FROM context_bundles WHERE id = ?", [id], (err) => {
      db.close();
      if (err) return reject(err);
      resolve();
    });
  });
}

async function createStoryFixture() {
  const target = Date.now();
  const featureDraft = {
    name: `Feature ${target}`,
    description: "Fixture feature",
    epics: [
      {
        name: `Epic ${target}`,
        description: "Fixture epic",
        stories: [
          { name: `Story ${target}`, description: "Fixture story" }
        ]
      }
    ]
  };

  const scope = {
    projectName: `db-test-project-${target}`,
    baseBranch: `db-test-branch-${target}`
  };

  await createFeatureTree(featureDraft, scope);
  const features = await getFeaturesTree(scope);
  const storyId = features?.[0]?.epics?.[0]?.stories?.[0]?.id;
  if (!Number.isInteger(storyId) || storyId <= 0) {
    throw new Error("Failed to build story fixture.");
  }
  return storyId;
}

async function createRunFixture() {
  const fixtureId = Date.now();
  return saveRun({
    projectName: `db-test-project-${fixtureId}`,
    prompt: "fixture prompt",
    code: 0,
    stdout: "",
    stderr: "",
    statusBefore: "",
    statusAfter: "",
    usageDelta: "",
    creditsRemaining: null,
    executionMode: "read",
    branchName: `fixture-branch-${fixtureId}`,
    baseBranch: "main",
    gitStatus: "",
    gitStatusFiles: [],
    gitDiffMap: {},
    changeTitle: "fixture",
    changeDescription: "fixture",
    promptWithInstructions: "fixture",
    executedCommand: "fixture",
    spawnCommand: "fixture",
    completionStatus: "complete",
    completionWork: "fixture completion work",
    runStartTime: Date.now() - 1,
    runEndTime: Date.now()
  });
}

test("automation metadata is persisted and updateable in sqlite", async () => {
  await dbReady;
  const targetId = Date.now();
  let automationRunId = null;

  try {
    const created = await createAutomationRun({
      automationType: "story",
      targetId,
      projectName: "db-test-project",
      baseBranch: "main",
      stopFlag: false,
      stopOnIncomplete: true,
      automationStatus: "running",
      currentPosition: 1,
      stopReason: null
    });
    automationRunId = created.id;

    assert.equal(created.automation_type, "story");
    assert.equal(created.target_id, targetId);
    assert.equal(created.project_name, "db-test-project");
    assert.equal(created.base_branch, "main");
    assert.equal(created.stop_flag, 0);
    assert.equal(created.stop_on_incomplete, 1);
    assert.equal(created.current_position, 1);
    assert.equal(created.automation_status, "running");
    assert.equal(created.stop_reason, null);
    assert.equal(created.context_bundle_id, null);
    assert.equal(created.failed_story_id, null);
    assert.equal(created.failure_summary, null);

    const loaded = await getAutomationRunById(automationRunId);
    assert.equal(loaded.id, automationRunId);
    assert.equal(loaded.automation_type, "story");
    assert.equal(loaded.target_id, targetId);
    assert.equal(loaded.project_name, "db-test-project");
    assert.equal(loaded.base_branch, "main");
    assert.equal(loaded.stop_on_incomplete, 1);
    assert.equal(loaded.automation_status, "running");
    assert.equal(loaded.stop_reason, null);
    assert.equal(loaded.context_bundle_id, null);
    assert.equal(loaded.failed_story_id, null);
    assert.equal(loaded.failure_summary, null);

    const updated = await updateAutomationRunMetadata(automationRunId, {
      stopFlag: true,
      stopOnIncomplete: false,
      currentPosition: 2,
      automationStatus: "failed",
      stopReason: "execution_failed",
      contextBundleId: 456,
      failedStoryId: 123,
      failureSummary: "Prompt parse failed."
    });
    assert.equal(updated.stop_flag, 1);
    assert.equal(updated.stop_on_incomplete, 0);
    assert.equal(updated.current_position, 2);
    assert.equal(updated.automation_status, "failed");
    assert.equal(updated.stop_reason, "execution_failed");
    assert.equal(updated.context_bundle_id, 456);
    assert.equal(updated.failed_story_id, 123);
    assert.equal(updated.failure_summary, "Prompt parse failed.");
  } finally {
    await cleanupAutomationRun(automationRunId);
  }
});

test("automation metadata persistence enforces a single active run per automation target", async () => {
  await dbReady;
  const targetId = Date.now();
  let firstRunId = null;

  try {
    const firstRun = await createAutomationRun({
      automationType: "story",
      targetId,
      projectName: "db-unique-target-project",
      baseBranch: "main",
      stopFlag: false,
      stopOnIncomplete: false,
      automationStatus: "running",
      currentPosition: 1,
      stopReason: null
    });
    firstRunId = firstRun.id;

    await assert.rejects(
      () => createAutomationRun({
        automationType: "story",
        targetId,
        projectName: "db-unique-target-project-alt",
        baseBranch: "release/1.0",
        stopFlag: false,
        stopOnIncomplete: false,
        automationStatus: "running",
        currentPosition: 1,
        stopReason: null
      }),
      (error) => {
        assert.equal(error?.code, "automation_target_conflict");
        assert.match(String(error?.message || ""), /already running/i);
        return true;
      }
    );
  } finally {
    await cleanupAutomationRun(firstRunId);
  }
});

test("run records persist automation origin linkage with backward-compatible null defaults", async () => {
  await dbReady;

  let automationRunId = null;
  let automatedRunId = null;
  let manualRunId = null;

  try {
    const automationRun = await createAutomationRun({
      automationType: "feature",
      targetId: 12345,
      projectName: "db-test-project",
      baseBranch: "main",
      stopFlag: false,
      stopOnIncomplete: false,
      automationStatus: "running",
      currentPosition: 1,
      stopReason: null
    });
    automationRunId = automationRun.id;

    automatedRunId = await saveRun({
      projectName: "db-test-project",
      prompt: "automated run prompt",
      code: 0,
      stdout: "",
      stderr: "",
      statusBefore: "",
      statusAfter: "",
      usageDelta: "",
      creditsRemaining: null,
      executionMode: "write",
      branchName: "codex-auto-branch",
      baseBranch: "main",
      gitStatus: "",
      gitStatusFiles: [],
      gitDiffMap: {},
      changeTitle: "automation update",
      changeDescription: "automation update",
      promptWithInstructions: "automation prompt",
      executedCommand: "automation command",
      spawnCommand: "automation spawn",
      completionStatus: "complete",
      completionWork: "none",
      runStartTime: Date.now() - 100,
      runEndTime: Date.now(),
      automationOriginType: "feature",
      automationOriginId: 12345,
      automationRunId,
      contextBundleId: 88
    });

    manualRunId = await saveRun({
      projectName: "db-test-project",
      prompt: "manual run prompt",
      code: 0,
      stdout: "",
      stderr: "",
      statusBefore: "",
      statusAfter: "",
      usageDelta: "",
      creditsRemaining: null,
      executionMode: "read",
      branchName: "codex-manual-branch",
      baseBranch: "main",
      gitStatus: "",
      gitStatusFiles: [],
      gitDiffMap: {},
      changeTitle: "manual update",
      changeDescription: "manual update",
      promptWithInstructions: "manual prompt",
      executedCommand: "manual command",
      spawnCommand: "manual spawn",
      completionStatus: "incomplete",
      completionWork: "Remaining manual tasks",
      runStartTime: Date.now() - 100,
      runEndTime: Date.now()
    });

    const automatedRun = await getRunById(automatedRunId);
    assert.equal(automatedRun.automation_origin_type, "feature");
    assert.equal(automatedRun.automation_origin_id, 12345);
    assert.equal(automatedRun.automation_run_id, automationRunId);
    assert.equal(automatedRun.context_bundle_id, 88);

    const manualRun = await getRunById(manualRunId);
    assert.equal(manualRun.automation_origin_type, null);
    assert.equal(manualRun.automation_origin_id, null);
    assert.equal(manualRun.automation_run_id, null);
    assert.equal(manualRun.context_bundle_id, null);

    const recentRuns = await getRuns({ status: "all" });
    const automatedSummary = recentRuns.find((run) => run.id === automatedRunId);
    const manualSummary = recentRuns.find((run) => run.id === manualRunId);
    assert.ok(automatedSummary);
    assert.ok(manualSummary);
    assert.equal(automatedSummary.automation_origin_type, "feature");
    assert.equal(automatedSummary.automation_origin_id, 12345);
    assert.equal(automatedSummary.automation_run_id, automationRunId);
    assert.equal(automatedSummary.context_bundle_id, 88);
    assert.equal(manualSummary.automation_origin_type, null);
    assert.equal(manualSummary.automation_origin_id, null);
    assert.equal(manualSummary.automation_run_id, null);
    assert.equal(manualSummary.context_bundle_id, null);
  } finally {
    await cleanupRun(automatedRunId);
    await cleanupRun(manualRunId);
    await cleanupAutomationRun(automationRunId);
  }
});

test("deleting an unmerged run clears linked story completion association", async () => {
  await dbReady;

  const stamp = Date.now();
  const scope = {
    projectName: `db-delete-link-${stamp}`,
    baseBranch: "main"
  };
  let runId = null;

  try {
    await createFeatureTree(
      {
        name: `Feature Delete Link ${stamp}`,
        description: "Delete linkage fixture",
        epics: [
          {
            name: `Epic Delete Link ${stamp}`,
            description: "Fixture epic",
            stories: [{ name: `Story Delete Link ${stamp}`, description: "Fixture story" }]
          }
        ]
      },
      scope
    );

    const seededFeatures = await getFeaturesTree(scope);
    const storyId = seededFeatures?.[0]?.epics?.[0]?.stories?.[0]?.id;
    assert.ok(Number.isInteger(storyId) && storyId > 0);

    runId = await saveRun({
      projectName: scope.projectName,
      prompt: "fixture prompt",
      code: 0,
      stdout: "",
      stderr: "",
      statusBefore: "",
      statusAfter: "",
      usageDelta: "",
      creditsRemaining: null,
      executionMode: "write",
      branchName: `fixture-delete-branch-${stamp}`,
      baseBranch: scope.baseBranch,
      gitStatus: "",
      gitStatusFiles: [],
      gitDiffMap: {},
      changeTitle: "fixture",
      changeDescription: "fixture",
      promptWithInstructions: "fixture",
      executedCommand: "fixture command",
      spawnCommand: "fixture spawn",
      completionStatus: "complete",
      completionWork: "none",
      runStartTime: Date.now() - 1000,
      runEndTime: Date.now()
    });

    await syncStoryCompletionFromRun(storyId, runId);

    const linkedStoryState = (await getFeaturesTree(scope))[0].epics[0].stories[0];
    assert.equal(linkedStoryState.run_id, runId);
    assert.equal(linkedStoryState.is_complete, true);

    const deletedCount = await deleteRunById(runId);
    assert.equal(deletedCount, 1);

    const detachedStoryState = (await getFeaturesTree(scope))[0].epics[0].stories[0];
    assert.equal(detachedStoryState.run_id, null);
    assert.equal(detachedStoryState.run_status, "not_started");
    assert.equal(detachedStoryState.is_complete, false);
  } finally {
    await cleanupRun(runId);
    await cleanupFeatureScope(scope);
  }
});

test("automation metadata persistence validates required fields", async () => {
  await dbReady;

  await assert.rejects(
    () => createAutomationRun({
      automationType: "",
      targetId: 1,
      projectName: "demo-project",
      baseBranch: "main",
      currentPosition: 1
    }),
    /Automation type is required/
  );

  await assert.rejects(
    () => createAutomationRun({
      automationType: "unknown",
      targetId: 1,
      projectName: "demo-project",
      baseBranch: "main",
      currentPosition: 1
    }),
    /Automation type must be feature, epic, or story/
  );

  await assert.rejects(
    () => createAutomationRun({
      automationType: "story",
      targetId: 0,
      projectName: "demo-project",
      baseBranch: "main",
      currentPosition: 1
    }),
    /Target id must be a positive integer/
  );

  await assert.rejects(
    () => createAutomationRun({
      automationType: "story",
      targetId: 1,
      projectName: "",
      baseBranch: "main",
      currentPosition: 1
    }),
    /Project name is required/
  );

  await assert.rejects(
    () => createAutomationRun({
      automationType: "story",
      targetId: 1,
      projectName: "demo-project",
      baseBranch: "",
      currentPosition: 1
    }),
    /Base branch is required/
  );

  await assert.rejects(
    () => updateAutomationRunMetadata(1, { automationStatus: "invalid" }),
    /Automation status must be pending, running, completed, failed, or stopped/
  );

  await assert.rejects(
    () => updateAutomationRunMetadata(1, {}),
    /At least one automation metadata field must be provided/
  );

  await assert.rejects(
    () => updateAutomationRunMetadata(1, { failedStoryId: 0 }),
    /Failed story id must be a positive integer when provided/
  );
});

test("automation story execution outcomes are persisted for status displays", async () => {
  await dbReady;

  const targetId = Date.now();
  const storyId = await createStoryFixture();
  const runId = await createRunFixture();
  let automationRunId = null;

  try {
    const automationRun = await createAutomationRun({
      automationType: "story",
      targetId,
      projectName: `db-test-project-${targetId}`,
      baseBranch: "main",
      stopFlag: false,
      stopOnIncomplete: true,
      automationStatus: "running",
      currentPosition: 1
    });
    automationRunId = automationRun.id;

    const recorded = await recordAutomationStoryExecution({
      automationRunId,
      storyId,
      positionInQueue: 1,
      executionStatus: "completed",
      queueAction: "stopped",
      runId,
      completionStatus: "incomplete",
      completionWork: "Waiting on follow-up migration tasks."
    });

    assert.equal(recorded.automation_run_id, automationRunId);
    assert.equal(recorded.story_id, storyId);
    assert.equal(recorded.position_in_queue, 1);
    assert.equal(recorded.execution_status, "completed");
    assert.equal(recorded.queue_action, "stopped");
    assert.equal(recorded.run_id, runId);
    assert.equal(recorded.completion_status, "incomplete");
    assert.equal(recorded.completion_work, "Waiting on follow-up migration tasks.");

    const outcomes = await getAutomationStoryExecutionsByRunId(automationRunId);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].run_id, runId);
    assert.equal(outcomes[0].queue_action, "stopped");
    assert.equal(outcomes[0].completion_status, "incomplete");
    assert.equal(outcomes[0].completion_work, "Waiting on follow-up migration tasks.");

    const failed = await recordAutomationStoryExecution({
      automationRunId,
      storyId,
      positionInQueue: 2,
      executionStatus: "failed",
      queueAction: "failed",
      runId: null,
      completionStatus: "unknown",
      completionWork: null,
      error: "Prompt generation failed (cause: missing story description)."
    });

    assert.equal(failed.execution_status, "failed");
    assert.equal(failed.story_id, storyId);
    assert.equal(failed.error, "Prompt generation failed (cause: missing story description).");

    const refreshedOutcomes = await getAutomationStoryExecutionsByRunId(automationRunId);
    assert.equal(refreshedOutcomes.length, 2);
    assert.equal(refreshedOutcomes[1].execution_status, "failed");
    assert.equal(refreshedOutcomes[1].error, "Prompt generation failed (cause: missing story description).");
  } finally {
    await cleanupAutomationStoryExecutions(automationRunId);
    await cleanupAutomationRun(automationRunId);
  }
});

test("automation story execution persistence validates required fields", async () => {
  await dbReady;

  await assert.rejects(
    () => recordAutomationStoryExecution({
      automationRunId: 0,
      storyId: 1,
      positionInQueue: 1,
      executionStatus: "completed",
      queueAction: "advanced"
    }),
    /Automation run id must be a positive integer/
  );

  await assert.rejects(
    () => recordAutomationStoryExecution({
      automationRunId: 1,
      storyId: 0,
      positionInQueue: 1,
      executionStatus: "completed",
      queueAction: "advanced"
    }),
    /Story id must be a positive integer/
  );

  await assert.rejects(
    () => recordAutomationStoryExecution({
      automationRunId: 1,
      storyId: 1,
      positionInQueue: 0,
      executionStatus: "completed",
      queueAction: "advanced"
    }),
    /Position in queue must be a positive integer/
  );

  await assert.rejects(
    () => recordAutomationStoryExecution({
      automationRunId: 1,
      storyId: 1,
      positionInQueue: 1,
      executionStatus: "running",
      queueAction: "advanced"
    }),
    /Execution status must be completed or failed/
  );

  await assert.rejects(
    () => recordAutomationStoryExecution({
      automationRunId: 1,
      storyId: 1,
      positionInQueue: 1,
      executionStatus: "completed",
      queueAction: "done"
    }),
    /Queue action must be advanced, stopped, or failed/
  );
});

test("automation queue stories can be resolved by feature/epic/story targets", async () => {
  await dbReady;

  const stamp = Date.now();
  const scope = {
    projectName: `db-automation-status-${stamp}`,
    baseBranch: "main"
  };

  await createFeatureTree(
    {
      name: `Feature ${stamp}`,
      description: "Queue scope fixture",
      epics: [
        {
          name: `Epic A ${stamp}`,
          description: "First epic",
          stories: [
            { name: `Story A1 ${stamp}`, description: "A1" },
            { name: `Story A2 ${stamp}`, description: "A2" }
          ]
        },
        {
          name: `Epic B ${stamp}`,
          description: "Second epic",
          stories: [
            { name: `Story B1 ${stamp}`, description: "B1" }
          ]
        }
      ]
    },
    scope
  );

  const features = await getFeaturesTree(scope);
  const feature = features[0];
  const epicA = feature.epics[0];
  const epicB = feature.epics[1];
  const storyA1 = epicA.stories[0];

  const featureQueue = await getAutomationQueueStoriesByTarget("feature", feature.id);
  assert.equal(featureQueue.length, 3);
  assert.deepEqual(featureQueue.map((item) => item.positionInQueue), [1, 2, 3]);
  assert.deepEqual(featureQueue.map((item) => item.storyId), [
    epicA.stories[0].id,
    epicA.stories[1].id,
    epicB.stories[0].id
  ]);

  const epicQueue = await getAutomationQueueStoriesByTarget("epic", epicA.id);
  assert.equal(epicQueue.length, 2);
  assert.deepEqual(epicQueue.map((item) => item.storyId), [
    epicA.stories[0].id,
    epicA.stories[1].id
  ]);

  const storyQueue = await getAutomationQueueStoriesByTarget("story", storyA1.id);
  assert.equal(storyQueue.length, 1);
  assert.equal(storyQueue[0].storyId, storyA1.id);

  const invalidQueue = await getAutomationQueueStoriesByTarget("feature", 0);
  assert.deepEqual(invalidQueue, []);
});

test("automation run queue snapshot items are persisted for restart-safe progress derivation", async () => {
  await dbReady;

  const stamp = Date.now();
  const scope = {
    projectName: `db-queue-snapshot-${stamp}`,
    baseBranch: "main"
  };
  let automationRunId = null;

  try {
    await createFeatureTree(
      {
        name: `Feature Snapshot ${stamp}`,
        description: "Queue snapshot fixture",
        epics: [
          {
            name: `Epic Snapshot ${stamp}`,
            description: "Fixture epic",
            stories: [
              { name: `Story Snapshot 1 ${stamp}`, description: "S1" },
              { name: `Story Snapshot 2 ${stamp}`, description: "S2" }
            ]
          }
        ]
      },
      scope
    );

    const features = await getFeaturesTree(scope);
    const feature = features[0];
    const epic = feature.epics[0];
    const [storyOne, storyTwo] = epic.stories;

    const automationRun = await createAutomationRun({
      automationType: "feature",
      targetId: feature.id,
      projectName: scope.projectName,
      baseBranch: scope.baseBranch,
      stopFlag: false,
      stopOnIncomplete: false,
      automationStatus: "running",
      currentPosition: 1,
      stopReason: null
    });
    automationRunId = automationRun.id;

    await recordAutomationRunQueueItems({
      automationRunId,
      stories: [
        {
          positionInQueue: 1,
          featureId: feature.id,
          featureTitle: feature.name,
          epicId: epic.id,
          epicTitle: epic.name,
          storyId: storyOne.id,
          storyTitle: storyOne.name,
          storyDescription: storyOne.description,
          storyCreatedAt: storyOne.created_at
        },
        {
          positionInQueue: 2,
          featureId: feature.id,
          featureTitle: feature.name,
          epicId: epic.id,
          epicTitle: epic.name,
          storyId: storyTwo.id,
          storyTitle: storyTwo.name,
          storyDescription: storyTwo.description,
          storyCreatedAt: storyTwo.created_at
        }
      ]
    });

    const queueSnapshot = await getAutomationRunQueueItemsByRunId(automationRunId);
    assert.equal(queueSnapshot.length, 2);
    assert.deepEqual(
      queueSnapshot.map((item) => item.positionInQueue),
      [1, 2]
    );
    assert.deepEqual(
      queueSnapshot.map((item) => item.storyId),
      [storyOne.id, storyTwo.id]
    );
    assert.equal(queueSnapshot[0].storyTitle, storyOne.name);
    assert.equal(queueSnapshot[1].storyTitle, storyTwo.name);
  } finally {
    await cleanupAutomationRun(automationRunId);
    await cleanupFeatureScope(scope);
  }
});

test("findRunningAutomationByScope returns only active runs for the same automation target", async () => {
  await dbReady;
  const targetId = Date.now();
  let runningRunId = null;
  let completedRunId = null;
  let otherTargetRunId = null;

  try {
    const runningRun = await createAutomationRun({
      automationType: "feature",
      targetId,
      projectName: "db-conflict-project",
      baseBranch: "main",
      stopFlag: false,
      stopOnIncomplete: false,
      automationStatus: "running",
      currentPosition: 1,
      stopReason: null
    });
    runningRunId = runningRun.id;

    const completedRun = await createAutomationRun({
      automationType: "feature",
      targetId,
      projectName: "db-conflict-project",
      baseBranch: "main",
      stopFlag: true,
      stopOnIncomplete: false,
      automationStatus: "completed",
      currentPosition: 1,
      stopReason: "all_work_complete"
    });
    completedRunId = completedRun.id;

    const otherTargetRun = await createAutomationRun({
      automationType: "feature",
      targetId: targetId + 1,
      projectName: "db-conflict-project-alt",
      baseBranch: "release/1.0",
      stopFlag: false,
      stopOnIncomplete: false,
      automationStatus: "running",
      currentPosition: 1,
      stopReason: null
    });
    otherTargetRunId = otherTargetRun.id;

    const exactScopeConflict = await findRunningAutomationByScope({
      automationType: "feature",
      targetId
    });
    assert.equal(exactScopeConflict.id, runningRunId);
    assert.equal(exactScopeConflict.automation_status, "running");

    const excludedConflict = await findRunningAutomationByScope({
      automationType: "feature",
      targetId,
      excludeAutomationRunId: runningRunId
    });
    assert.equal(excludedConflict, undefined);

    const unrelatedTargetConflict = await findRunningAutomationByScope({
      automationType: "feature",
      targetId: targetId + 1
    });
    assert.equal(unrelatedTargetConflict.id, otherTargetRunId);
  } finally {
    await cleanupAutomationRun(otherTargetRunId);
    await cleanupAutomationRun(completedRunId);
    await cleanupAutomationRun(runningRunId);
  }
});

test("automation run queue snapshot validation enforces required ids and stories", async () => {
  await dbReady;

  await assert.rejects(
    () => recordAutomationRunQueueItems({
      automationRunId: 0,
      stories: [{ positionInQueue: 1, storyId: 1 }]
    }),
    /Automation run id must be a positive integer/
  );

  await assert.rejects(
    () => recordAutomationRunQueueItems({
      automationRunId: 1,
      stories: []
    }),
    /Queue snapshot stories are required/
  );

  await assert.rejects(
    () => recordAutomationRunQueueItems({
      automationRunId: 1,
      stories: [{ positionInQueue: 0, storyId: 1 }]
    }),
    /Queue snapshot position must be a positive integer/
  );

  await assert.rejects(
    () => recordAutomationRunQueueItems({
      automationRunId: 1,
      stories: [{ positionInQueue: 1, storyId: 0 }]
    }),
    /Queue snapshot story id must be a positive integer/
  );
});

test("feature tree includes latest feature automation status summary with safe fallback", async () => {
  await dbReady;

  const stamp = Date.now();
  const scope = {
    projectName: `db-feature-status-${stamp}`,
    baseBranch: "main"
  };
  const unrelatedScope = {
    projectName: `db-feature-status-unrelated-${stamp}`,
    baseBranch: "main"
  };

  const automationRunIds = [];

  try {
    await createFeatureTree(
      {
        name: `Feature Running ${stamp}`,
        description: "status fixture",
        epics: [{ name: "Epic", description: "", stories: [{ name: "Story", description: "" }] }]
      },
      scope
    );
    await createFeatureTree(
      {
        name: `Feature Completed ${stamp}`,
        description: "status fixture",
        epics: [{ name: "Epic", description: "", stories: [{ name: "Story", description: "" }] }]
      },
      scope
    );
    await createFeatureTree(
      {
        name: `Feature Stopped ${stamp}`,
        description: "status fixture",
        epics: [{ name: "Epic", description: "", stories: [{ name: "Story", description: "" }] }]
      },
      scope
    );
    await createFeatureTree(
      {
        name: `Feature Failed ${stamp}`,
        description: "status fixture",
        epics: [{ name: "Epic", description: "", stories: [{ name: "Story", description: "" }] }]
      },
      scope
    );
    await createFeatureTree(
      {
        name: `Feature Not Started ${stamp}`,
        description: "status fixture",
        epics: [{ name: "Epic", description: "", stories: [{ name: "Story", description: "" }] }]
      },
      scope
    );

    const seededFeatures = await getFeaturesTree(scope);
    const byName = new Map(seededFeatures.map((feature) => [feature.name, feature]));
    const runningFeature = byName.get(`Feature Running ${stamp}`);
    const completedFeature = byName.get(`Feature Completed ${stamp}`);
    const stoppedFeature = byName.get(`Feature Stopped ${stamp}`);
    const failedFeature = byName.get(`Feature Failed ${stamp}`);
    const notStartedFeature = byName.get(`Feature Not Started ${stamp}`);

    assert.ok(runningFeature);
    assert.ok(completedFeature);
    assert.ok(stoppedFeature);
    assert.ok(failedFeature);
    assert.ok(notStartedFeature);

    const runningRun = await createAutomationRun({
      automationType: "feature",
      targetId: runningFeature.id,
      projectName: scope.projectName,
      baseBranch: scope.baseBranch,
      stopFlag: false,
      stopOnIncomplete: false,
      automationStatus: "running",
      currentPosition: 1,
      stopReason: null
    });
    automationRunIds.push(runningRun.id);

    const completedRun = await createAutomationRun({
      automationType: "feature",
      targetId: completedFeature.id,
      projectName: scope.projectName,
      baseBranch: scope.baseBranch,
      stopFlag: false,
      stopOnIncomplete: false,
      automationStatus: "completed",
      currentPosition: 1,
      stopReason: "all_work_complete"
    });
    automationRunIds.push(completedRun.id);

    const stoppedRun = await createAutomationRun({
      automationType: "feature",
      targetId: stoppedFeature.id,
      projectName: scope.projectName,
      baseBranch: scope.baseBranch,
      stopFlag: true,
      stopOnIncomplete: true,
      automationStatus: "stopped",
      currentPosition: 1,
      stopReason: "story_incomplete"
    });
    automationRunIds.push(stoppedRun.id);

    const failedRun = await createAutomationRun({
      automationType: "feature",
      targetId: failedFeature.id,
      projectName: scope.projectName,
      baseBranch: scope.baseBranch,
      stopFlag: true,
      stopOnIncomplete: false,
      automationStatus: "failed",
      currentPosition: 1,
      stopReason: "execution_failed"
    });
    automationRunIds.push(failedRun.id);

    const unrelatedRun = await createAutomationRun({
      automationType: "feature",
      targetId: completedFeature.id,
      projectName: unrelatedScope.projectName,
      baseBranch: unrelatedScope.baseBranch,
      stopFlag: false,
      stopOnIncomplete: false,
      automationStatus: "running",
      currentPosition: 1,
      stopReason: null
    });
    automationRunIds.push(unrelatedRun.id);

    const hydratedFeatures = await getFeaturesTree(scope);
    const hydratedByName = new Map(hydratedFeatures.map((feature) => [feature.name, feature]));

    assert.equal(hydratedByName.get(`Feature Running ${stamp}`).feature_automation_status, "running");
    assert.equal(hydratedByName.get(`Feature Completed ${stamp}`).feature_automation_status, "completed");
    assert.equal(hydratedByName.get(`Feature Stopped ${stamp}`).feature_automation_status, "stopped");
    assert.equal(hydratedByName.get(`Feature Failed ${stamp}`).feature_automation_status, "failed");
    assert.equal(hydratedByName.get(`Feature Not Started ${stamp}`).feature_automation_status, "not_started");

    assert.equal(
      hydratedByName.get(`Feature Completed ${stamp}`).feature_automation_run_id,
      completedRun.id
    );
    assert.equal(
      hydratedByName.get(`Feature Completed ${stamp}`).feature_automation_stop_reason,
      "all_work_complete"
    );
  } finally {
    for (const automationRunId of automationRunIds) {
      await cleanupAutomationRun(automationRunId);
    }
    await cleanupFeatureScope(scope);
  }
});

test("feature tree includes latest epic and story automation status summaries with safe fallback", async () => {
  await dbReady;

  const stamp = Date.now();
  const scope = {
    projectName: `db-epic-story-status-${stamp}`,
    baseBranch: "main"
  };
  const unrelatedScope = {
    projectName: `db-epic-story-status-unrelated-${stamp}`,
    baseBranch: "main"
  };

  const automationRunIds = [];

  try {
    await createFeatureTree(
      {
        name: `Feature Epic/Story Status ${stamp}`,
        description: "status fixture",
        epics: [
          { name: `Epic Running ${stamp}`, description: "", stories: [{ name: `Story Running ${stamp}`, description: "" }] },
          { name: `Epic Completed ${stamp}`, description: "", stories: [{ name: `Story Completed ${stamp}`, description: "" }] },
          { name: `Epic Stopped ${stamp}`, description: "", stories: [{ name: `Story Stopped ${stamp}`, description: "" }] },
          { name: `Epic Failed ${stamp}`, description: "", stories: [{ name: `Story Failed ${stamp}`, description: "" }] },
          { name: `Epic Not Started ${stamp}`, description: "", stories: [{ name: `Story Not Started ${stamp}`, description: "" }] }
        ]
      },
      scope
    );

    const seededFeatures = await getFeaturesTree(scope);
    const firstFeature = seededFeatures[0];
    const epicByName = new Map(firstFeature.epics.map((epic) => [epic.name, epic]));

    const epicRunning = epicByName.get(`Epic Running ${stamp}`);
    const epicCompleted = epicByName.get(`Epic Completed ${stamp}`);
    const epicStopped = epicByName.get(`Epic Stopped ${stamp}`);
    const epicFailed = epicByName.get(`Epic Failed ${stamp}`);
    const epicNotStarted = epicByName.get(`Epic Not Started ${stamp}`);

    assert.ok(epicRunning);
    assert.ok(epicCompleted);
    assert.ok(epicStopped);
    assert.ok(epicFailed);
    assert.ok(epicNotStarted);

    const storyRunning = epicRunning.stories[0];
    const storyCompleted = epicCompleted.stories[0];
    const storyStopped = epicStopped.stories[0];
    const storyFailed = epicFailed.stories[0];
    const storyNotStarted = epicNotStarted.stories[0];

    const epicRunningRun = await createAutomationRun({
      automationType: "epic",
      targetId: epicRunning.id,
      projectName: scope.projectName,
      baseBranch: scope.baseBranch,
      stopFlag: false,
      stopOnIncomplete: false,
      automationStatus: "running",
      currentPosition: 1,
      stopReason: null
    });
    automationRunIds.push(epicRunningRun.id);

    const epicCompletedRun = await createAutomationRun({
      automationType: "epic",
      targetId: epicCompleted.id,
      projectName: scope.projectName,
      baseBranch: scope.baseBranch,
      stopFlag: false,
      stopOnIncomplete: false,
      automationStatus: "completed",
      currentPosition: 1,
      stopReason: "all_work_complete"
    });
    automationRunIds.push(epicCompletedRun.id);

    const epicStoppedRun = await createAutomationRun({
      automationType: "epic",
      targetId: epicStopped.id,
      projectName: scope.projectName,
      baseBranch: scope.baseBranch,
      stopFlag: true,
      stopOnIncomplete: true,
      automationStatus: "stopped",
      currentPosition: 1,
      stopReason: "story_incomplete"
    });
    automationRunIds.push(epicStoppedRun.id);

    const epicFailedRun = await createAutomationRun({
      automationType: "epic",
      targetId: epicFailed.id,
      projectName: scope.projectName,
      baseBranch: scope.baseBranch,
      stopFlag: true,
      stopOnIncomplete: false,
      automationStatus: "failed",
      currentPosition: 1,
      stopReason: "execution_failed"
    });
    automationRunIds.push(epicFailedRun.id);

    const storyRunningRun = await createAutomationRun({
      automationType: "story",
      targetId: storyRunning.id,
      projectName: scope.projectName,
      baseBranch: scope.baseBranch,
      stopFlag: false,
      stopOnIncomplete: false,
      automationStatus: "running",
      currentPosition: 1,
      stopReason: null
    });
    automationRunIds.push(storyRunningRun.id);

    const storyCompletedRun = await createAutomationRun({
      automationType: "story",
      targetId: storyCompleted.id,
      projectName: scope.projectName,
      baseBranch: scope.baseBranch,
      stopFlag: false,
      stopOnIncomplete: false,
      automationStatus: "completed",
      currentPosition: 1,
      stopReason: "all_work_complete"
    });
    automationRunIds.push(storyCompletedRun.id);

    const storyStoppedRun = await createAutomationRun({
      automationType: "story",
      targetId: storyStopped.id,
      projectName: scope.projectName,
      baseBranch: scope.baseBranch,
      stopFlag: true,
      stopOnIncomplete: true,
      automationStatus: "stopped",
      currentPosition: 1,
      stopReason: "story_incomplete"
    });
    automationRunIds.push(storyStoppedRun.id);

    const storyFailedRun = await createAutomationRun({
      automationType: "story",
      targetId: storyFailed.id,
      projectName: scope.projectName,
      baseBranch: scope.baseBranch,
      stopFlag: true,
      stopOnIncomplete: false,
      automationStatus: "failed",
      currentPosition: 1,
      stopReason: "execution_failed"
    });
    automationRunIds.push(storyFailedRun.id);

    const unrelatedEpicRun = await createAutomationRun({
      automationType: "epic",
      targetId: epicCompleted.id,
      projectName: unrelatedScope.projectName,
      baseBranch: unrelatedScope.baseBranch,
      stopFlag: false,
      stopOnIncomplete: false,
      automationStatus: "running",
      currentPosition: 1,
      stopReason: null
    });
    automationRunIds.push(unrelatedEpicRun.id);

    const unrelatedStoryRun = await createAutomationRun({
      automationType: "story",
      targetId: storyCompleted.id,
      projectName: unrelatedScope.projectName,
      baseBranch: unrelatedScope.baseBranch,
      stopFlag: false,
      stopOnIncomplete: false,
      automationStatus: "running",
      currentPosition: 1,
      stopReason: null
    });
    automationRunIds.push(unrelatedStoryRun.id);

    const hydratedFeatures = await getFeaturesTree(scope);
    const hydratedEpicsByName = new Map(hydratedFeatures[0].epics.map((epic) => [epic.name, epic]));

    assert.equal(hydratedEpicsByName.get(`Epic Running ${stamp}`).epic_automation_status, "running");
    assert.equal(hydratedEpicsByName.get(`Epic Completed ${stamp}`).epic_automation_status, "completed");
    assert.equal(hydratedEpicsByName.get(`Epic Stopped ${stamp}`).epic_automation_status, "stopped");
    assert.equal(hydratedEpicsByName.get(`Epic Failed ${stamp}`).epic_automation_status, "failed");
    assert.equal(hydratedEpicsByName.get(`Epic Not Started ${stamp}`).epic_automation_status, "not_started");
    assert.equal(hydratedEpicsByName.get(`Epic Completed ${stamp}`).epic_automation_run_id, epicCompletedRun.id);
    assert.equal(hydratedEpicsByName.get(`Epic Completed ${stamp}`).epic_automation_stop_reason, "all_work_complete");

    const storiesByName = new Map(
      hydratedFeatures[0].epics
        .flatMap((epic) => epic.stories || [])
        .map((story) => [story.name, story])
    );
    assert.equal(storiesByName.get(`Story Running ${stamp}`).story_automation_status, "running");
    assert.equal(storiesByName.get(`Story Completed ${stamp}`).story_automation_status, "completed");
    assert.equal(storiesByName.get(`Story Stopped ${stamp}`).story_automation_status, "stopped");
    assert.equal(storiesByName.get(`Story Failed ${stamp}`).story_automation_status, "failed");
    assert.equal(storiesByName.get(`Story Not Started ${stamp}`).story_automation_status, "not_started");
    assert.equal(storiesByName.get(`Story Completed ${stamp}`).story_automation_run_id, storyCompletedRun.id);
    assert.equal(storiesByName.get(`Story Completed ${stamp}`).story_automation_stop_reason, "all_work_complete");
  } finally {
    for (const automationRunId of automationRunIds) {
      await cleanupAutomationRun(automationRunId);
    }
    await cleanupFeatureScope(scope);
  }
});

test("context bundle schema migration creates bundle foundation tables", async () => {
  await dbReady;

  const schemaVersion = await getDbRow("SELECT version FROM schema_version LIMIT 1");
  assert.ok(Number.isInteger(schemaVersion?.version));
  assert.ok(schemaVersion.version >= 19);

  const bundleTable = await getDbRow(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'context_bundles'"
  );
  const partTable = await getDbRow(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'context_bundle_parts'"
  );

  assert.equal(bundleTable?.name, "context_bundles");
  assert.equal(partTable?.name, "context_bundle_parts");

  const runBundleColumn = await getDbRow(
    "SELECT name FROM pragma_table_info('runs') WHERE name = 'context_bundle_id'"
  );
  const automationBundleColumn = await getDbRow(
    "SELECT name FROM pragma_table_info('automation_runs') WHERE name = 'context_bundle_id'"
  );
  assert.equal(runBundleColumn?.name, "context_bundle_id");
  assert.equal(automationBundleColumn?.name, "context_bundle_id");
});

test("context bundle part type semantics expose a controlled list", () => {
  assert.deepEqual(CONTEXT_BUNDLE_PART_TYPES, [
    "repository_context",
    "architecture_guidance",
    "coding_standards",
    "documentation_standards",
    "domain_glossary",
    "implementation_constraints",
    "testing_expectations",
    "feature_background",
    "user_notes"
  ]);
});

test("context bundles support multiple bundles with deterministic ordered parts", async () => {
  await dbReady;

  const stamp = Date.now();
  const createdBundleIds = [];

  try {
    const bundleA = await createContextBundle({
      title: `Bundle A ${stamp}`,
      description: "Bundle A description",
      status: "draft",
      intendedUse: "story_implementation",
      tags: ["backend", "api"],
      projectName: "bundle-project-a",
      summary: "Bundle A summary"
    });
    createdBundleIds.push(bundleA.id);

    const bundleB = await createContextBundle({
      title: `Bundle B ${stamp}`,
      description: "Bundle B description",
      status: "active"
    });
    createdBundleIds.push(bundleB.id);

    assert.notEqual(bundleA.id, bundleB.id);

    await createContextBundlePart({
      bundleId: bundleA.id,
      partType: "implementation_constraints",
      title: "Constraints",
      content: "Never mutate unrelated files.",
      instructions: "Enforce before planning.",
      position: 2,
      includeInCompiled: true,
      includeInPreview: false
    });
    await createContextBundlePart({
      bundleId: bundleA.id,
      partType: "feature_background",
      title: "Objective",
      content: "Implement story scope only.",
      notes: "Primary context section.",
      position: 1,
      includeInCompiled: true,
      includeInPreview: true
    });
    await createContextBundlePart({
      bundleId: bundleB.id,
      partType: "repository_context",
      title: "Reference",
      content: "Use existing architecture patterns.",
      position: 1,
      includeInCompiled: false,
      includeInPreview: true
    });

    const loadedA = await getContextBundleById(bundleA.id);
    assert.equal(loadedA.id, bundleA.id);
    assert.equal(loadedA.intended_use, "story_implementation");
    assert.deepEqual(loadedA.tags, ["backend", "api"]);
    assert.equal(loadedA.project_name, "bundle-project-a");
    assert.equal(loadedA.summary, "Bundle A summary");
    assert.equal(loadedA.parts.length, 2);
    assert.deepEqual(
      loadedA.parts.map((part) => part.position),
      [1, 2]
    );
    assert.deepEqual(
      loadedA.parts.map((part) => part.bundle_id),
      [bundleA.id, bundleA.id]
    );

    const loadedPartsA = await getContextBundlePartsByBundleId(bundleA.id);
    assert.equal(loadedPartsA[0].part_type, "feature_background");
    assert.equal(loadedPartsA[0].part_type_label, "Feature Background");
    assert.equal(loadedPartsA[1].part_type, "implementation_constraints");
    assert.equal(loadedPartsA[1].part_type_label, "Implementation Constraints");

    const allBundles = await getContextBundles();
    const byId = new Map(allBundles.map((bundle) => [bundle.id, bundle]));
    assert.equal(byId.get(bundleA.id)?.parts?.length, 2);
    assert.equal(byId.get(bundleB.id)?.parts?.length, 1);
    assert.deepEqual(
      (byId.get(bundleB.id)?.parts || []).map((part) => part.bundle_id),
      [bundleB.id]
    );
  } finally {
    for (const bundleId of createdBundleIds) {
      await cleanupContextBundle(bundleId);
    }
  }
});

test("context bundle duplication clones metadata and parts without relationship corruption", async () => {
  await dbReady;

  let sourceBundleId = null;
  let duplicateBundleId = null;

  try {
    const sourceBundle = await createContextBundle({
      title: `Bundle Duplicate Source ${Date.now()}`,
      description: "Source description",
      status: "active",
      intendedUse: "story_implementation",
      tags: ["duplicate", "clone"],
      projectName: "bundle-dup-project",
      summary: "Source summary"
    });
    sourceBundleId = sourceBundle.id;

    await createContextBundlePart({
      bundleId: sourceBundleId,
      partType: "repository_context",
      title: "Repository Baseline",
      content: "Reference architecture snapshot.",
      position: 1,
      includeInCompiled: true,
      includeInPreview: true
    });
    await createContextBundlePart({
      bundleId: sourceBundleId,
      partType: "implementation_constraints",
      title: "Guardrails",
      content: "Keep scope constrained.",
      position: 2,
      includeInCompiled: false,
      includeInPreview: true
    });

    const duplicated = await duplicateContextBundleById(sourceBundleId);
    assert.ok(duplicated);
    duplicateBundleId = duplicated.id;

    assert.notEqual(duplicated.id, sourceBundleId);
    assert.match(duplicated.title, /\(Copy\)$/);
    assert.equal(duplicated.description, "Source description");
    assert.equal(duplicated.status, "active");
    assert.equal(duplicated.intended_use, "story_implementation");
    assert.deepEqual(duplicated.tags, ["duplicate", "clone"]);
    assert.equal(duplicated.project_name, "bundle-dup-project");
    assert.equal(duplicated.summary, "Source summary");
    assert.equal(duplicated.parts.length, 2);
    assert.deepEqual(duplicated.parts.map((part) => part.position), [1, 2]);
    assert.deepEqual(duplicated.parts.map((part) => part.bundle_id), [duplicated.id, duplicated.id]);
    assert.notEqual(duplicated.parts[0].id, duplicated.parts[1].id);

    const sourceReloaded = await getContextBundleById(sourceBundleId);
    assert.equal(sourceReloaded.parts.length, 2);
    assert.deepEqual(sourceReloaded.parts.map((part) => part.bundle_id), [sourceBundleId, sourceBundleId]);
    assert.deepEqual(sourceReloaded.parts.map((part) => part.position), [1, 2]);
  } finally {
    await cleanupContextBundle(duplicateBundleId);
    await cleanupContextBundle(sourceBundleId);
  }
});

test("context bundle and part models support create update and delete", async () => {
  await dbReady;

  let bundleId = null;
  let partId = null;
  let cascadePartId = null;

  try {
    const createdBundle = await createContextBundle({
      title: `Bundle CRUD ${Date.now()}`,
      description: "Initial description",
      status: "draft"
    });
    bundleId = createdBundle.id;

    const updatedBundle = await updateContextBundle(bundleId, {
      title: "Bundle CRUD Updated",
      description: "Updated description",
      status: "active",
      intendedUse: "bug_fixes",
      tags: ["db", "migration", "db"],
      projectName: "bundle-crud-project",
      summary: "Updated bundle metadata summary.",
      tokenEstimate: 256,
      isActive: 1,
      lastUsedAt: "2026-04-04T12:34:56.000Z"
    });
    assert.equal(updatedBundle.title, "Bundle CRUD Updated");
    assert.equal(updatedBundle.description, "Updated description");
    assert.equal(updatedBundle.status, "active");
    assert.equal(updatedBundle.intended_use, "bug_fixes");
    assert.deepEqual(updatedBundle.tags, ["db", "migration"]);
    assert.equal(updatedBundle.project_name, "bundle-crud-project");
    assert.equal(updatedBundle.summary, "Updated bundle metadata summary.");
    assert.equal(updatedBundle.token_estimate, 256);
    assert.equal(updatedBundle.is_active, 1);
    assert.equal(updatedBundle.last_used_at, "2026-04-04T12:34:56.000Z");

    const clearedMetadataBundle = await updateContextBundle(bundleId, {
      intendedUse: "",
      tags: [],
      projectName: "",
      summary: ""
    });
    assert.equal(clearedMetadataBundle.intended_use, null);
    assert.deepEqual(clearedMetadataBundle.tags, []);
    assert.equal(clearedMetadataBundle.project_name, null);
    assert.equal(clearedMetadataBundle.summary, null);

    const createdPart = await createContextBundlePart({
      bundleId,
      partType: "architecture_guidance",
      title: "Part Initial",
      content: "Initial content",
      instructions: "Initial instruction",
      notes: "Initial note",
      position: 1,
      includeInCompiled: true,
      includeInPreview: true,
      tokenEstimate: 64,
      isActive: 1
    });
    partId = createdPart.id;

    const updatedPart = await updateContextBundlePart(partId, {
      partType: "testing_expectations",
      title: "Part Updated",
      content: "Updated content",
      instructions: "",
      notes: "",
      position: 3,
      includeInCompiled: false,
      includeInPreview: true,
      tokenEstimate: 96,
      isActive: 0
    });
    assert.equal(updatedPart.part_type, "testing_expectations");
    assert.equal(updatedPart.part_type_label, "Testing Expectations");
    assert.equal(updatedPart.title, "Part Updated");
    assert.equal(updatedPart.content, "Updated content");
    assert.equal(updatedPart.instructions, null);
    assert.equal(updatedPart.notes, null);
    assert.equal(updatedPart.position, 3);
    assert.equal(updatedPart.include_in_compiled, 0);
    assert.equal(updatedPart.include_in_preview, 1);
    assert.equal(updatedPart.token_estimate, 96);
    assert.equal(updatedPart.is_active, 0);

    const deletedPartCount = await deleteContextBundlePartById(partId);
    assert.equal(deletedPartCount, 1);
    partId = null;
    const missingPart = await getContextBundlePartById(createdPart.id);
    assert.equal(missingPart, undefined);

    const cascadePart = await createContextBundlePart({
      bundleId,
      partType: "repository_context",
      title: "Cascade Part",
      content: "Should be removed with parent bundle.",
      position: 4
    });
    cascadePartId = cascadePart.id;

    const deletedBundleCount = await deleteContextBundleById(bundleId);
    assert.equal(deletedBundleCount, 1);
    bundleId = null;
    const missingBundle = await getContextBundleById(createdBundle.id);
    assert.equal(missingBundle, null);
    const missingCascadePart = await getContextBundlePartById(cascadePart.id);
    assert.equal(missingCascadePart, undefined);
    cascadePartId = null;
  } finally {
    if (partId) {
      await deleteContextBundlePartById(partId);
    }
    if (cascadePartId) {
      await deleteContextBundlePartById(cascadePartId);
    }
    if (bundleId) {
      await cleanupContextBundle(bundleId);
    }
  }
});

test("context bundle part type validation rejects unknown types and supports canonical aliases", async () => {
  await dbReady;

  let bundleId = null;
  let aliasedPartId = null;

  try {
    const createdBundle = await createContextBundle({
      title: `Bundle Part Type Validation ${Date.now()}`,
      description: "Part type validation coverage bundle.",
      status: "draft"
    });
    bundleId = createdBundle.id;

    const aliasedPart = await createContextBundlePart({
      bundleId,
      partType: "policy",
      title: "Legacy Alias",
      content: "Alias should normalize.",
      position: 1
    });
    aliasedPartId = aliasedPart.id;
    assert.equal(aliasedPart.part_type, "implementation_constraints");
    assert.equal(aliasedPart.part_type_label, "Implementation Constraints");

    await assert.rejects(
      () => createContextBundlePart({
        bundleId,
        partType: "totally_custom_type",
        title: "Invalid Type",
        content: "Should fail.",
        position: 2
      }),
      /Context bundle part type must be one of/
    );

    await assert.rejects(
      () => updateContextBundlePart(aliasedPart.id, {
        partType: "unsupported_next_type"
      }),
      /Context bundle part type must be one of/
    );
  } finally {
    if (aliasedPartId) {
      await deleteContextBundlePartById(aliasedPartId);
    }
    if (bundleId) {
      await cleanupContextBundle(bundleId);
    }
  }
});

test("context bundle validation enforces required fields, size limits, and unique ordering", async () => {
  await dbReady;

  let bundleId = null;
  const longTitle = "x".repeat(161);
  const longContent = "x".repeat(24001);

  await assert.rejects(
    () => createContextBundle({
      title: "",
      description: ""
    }),
    (error) => {
      assert.match(error.message, /title is required/i);
      assert.ok(Array.isArray(error.validationErrors));
      assert.ok(error.validationErrors.some((item) => item.field === "title"));
      assert.ok(error.validationErrors.some((item) => item.field === "description"));
      return true;
    }
  );

  await assert.rejects(
    () => createContextBundle({
      title: longTitle,
      description: "Valid description"
    }),
    /must be 160 characters or fewer/
  );

  try {
    const createdBundle = await createContextBundle({
      title: `Bundle Validation ${Date.now()}`,
      description: "Validation test bundle",
      status: "draft"
    });
    bundleId = createdBundle.id;

    await assert.rejects(
      () => createContextBundlePart({
        bundleId,
        partType: "feature_background",
        title: "Part A",
        content: "",
        position: 1
      }),
      /content is required/i
    );

    await assert.rejects(
      () => createContextBundlePart({
        bundleId,
        partType: "feature_background",
        title: "Part A",
        content: longContent,
        position: 1
      }),
      /24000 characters or fewer/
    );

    const partOne = await createContextBundlePart({
      bundleId,
      partType: "feature_background",
      title: "Part A",
      content: "Content A",
      position: 1
    });

    const partTwo = await createContextBundlePart({
      bundleId,
      partType: "implementation_constraints",
      title: "Part B",
      content: "Content B",
      position: 2
    });

    await assert.rejects(
      () => createContextBundlePart({
        bundleId,
        partType: "user_notes",
        title: "Part C",
        content: "Content C",
        position: 2
      }),
      /position 2 is already in use/
    );

    await assert.rejects(
      () => updateContextBundlePart(partTwo.id, { position: 1 }),
      /position 1 is already in use/
    );

    await deleteContextBundlePartById(partOne.id);
    await deleteContextBundlePartById(partTwo.id);
  } finally {
    if (bundleId) {
      await cleanupContextBundle(bundleId);
    }
  }
});
