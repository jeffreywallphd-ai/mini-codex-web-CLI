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
      currentPosition: 1
    });
    automationRunId = created.id;

    assert.equal(created.automation_type, "story");
    assert.equal(created.target_id, targetId);
    assert.equal(created.stop_flag, 0);
    assert.equal(created.current_position, 1);

    const loaded = await getAutomationRunById(automationRunId);
    assert.equal(loaded.id, automationRunId);
    assert.equal(loaded.automation_type, "story");
    assert.equal(loaded.target_id, targetId);

    const updated = await updateAutomationRunMetadata(automationRunId, {
      stopFlag: true,
      currentPosition: 2
    });
    assert.equal(updated.stop_flag, 1);
    assert.equal(updated.current_position, 2);
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
      automationType: "story",
      targetId: 0,
      currentPosition: 1
    }),
    /Target id must be a positive integer/
  );

  await assert.rejects(
    () => updateAutomationRunMetadata(1, {}),
    /At least one automation metadata field must be provided/
  );
});
