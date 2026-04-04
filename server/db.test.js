const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const sqlite3 = require("sqlite3").verbose();

const {
  dbReady,
  saveRun,
  createFeatureTree,
  getFeaturesTree,
  createAutomationRun,
  getAutomationRunById,
  updateAutomationRunMetadata,
  recordAutomationStoryExecution,
  getAutomationStoryExecutionsByRunId,
  getAutomationQueueStoriesByTarget
} = require("./db");

const dbPath = path.resolve(__dirname, "../data/app.db");

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
      stopFlag: false,
      stopOnIncomplete: true,
      automationStatus: "running",
      currentPosition: 1,
      stopReason: null
    });
    automationRunId = created.id;

    assert.equal(created.automation_type, "story");
    assert.equal(created.target_id, targetId);
    assert.equal(created.stop_flag, 0);
    assert.equal(created.stop_on_incomplete, 1);
    assert.equal(created.current_position, 1);
    assert.equal(created.automation_status, "running");
    assert.equal(created.stop_reason, null);

    const loaded = await getAutomationRunById(automationRunId);
    assert.equal(loaded.id, automationRunId);
    assert.equal(loaded.automation_type, "story");
    assert.equal(loaded.target_id, targetId);
    assert.equal(loaded.stop_on_incomplete, 1);
    assert.equal(loaded.automation_status, "running");
    assert.equal(loaded.stop_reason, null);

    const updated = await updateAutomationRunMetadata(automationRunId, {
      stopFlag: true,
      stopOnIncomplete: false,
      currentPosition: 2,
      automationStatus: "completed",
      stopReason: "all_work_complete"
    });
    assert.equal(updated.stop_flag, 1);
    assert.equal(updated.stop_on_incomplete, 0);
    assert.equal(updated.current_position, 2);
    assert.equal(updated.automation_status, "completed");
    assert.equal(updated.stop_reason, "all_work_complete");
  } finally {
    await cleanupAutomationRun(automationRunId);
  }
});

test("automation metadata persistence validates required fields", async () => {
  await dbReady;

  await assert.rejects(
    () => createAutomationRun({
      automationType: "",
      targetId: 1,
      currentPosition: 1
    }),
    /Automation type is required/
  );

  await assert.rejects(
    () => createAutomationRun({
      automationType: "unknown",
      targetId: 1,
      currentPosition: 1
    }),
    /Automation type must be feature, epic, or story/
  );

  await assert.rejects(
    () => createAutomationRun({
      automationType: "story",
      targetId: 0,
      currentPosition: 1
    }),
    /Target id must be a positive integer/
  );

  await assert.rejects(
    () => updateAutomationRunMetadata(1, { automationStatus: "invalid" }),
    /Automation status must be pending, running, completed, failed, or stopped/
  );

  await assert.rejects(
    () => updateAutomationRunMetadata(1, {}),
    /At least one automation metadata field must be provided/
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
