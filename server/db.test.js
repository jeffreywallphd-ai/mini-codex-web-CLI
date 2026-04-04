const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const sqlite3 = require("sqlite3").verbose();

const {
  dbReady,
  createAutomationRun,
  getAutomationRunById,
  updateAutomationRunMetadata
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
