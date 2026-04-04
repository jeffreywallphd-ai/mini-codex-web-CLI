const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FEATURES_JS_PATH = path.resolve(__dirname, "features.js");

function readFeaturesScript() {
  return fs.readFileSync(FEATURES_JS_PATH, "utf8");
}

test("feature automation button starts feature-scoped automation endpoint", () => {
  const source = readFeaturesScript();

  assert.match(
    source,
    /fetch\(`\/api\/automation\/start\/feature\/\$\{encodeURIComponent\(String\(featureId\)\)\}`,\s*\{\s*method:\s*"POST"/m
  );
  assert.match(source, /body:\s*JSON\.stringify\(\{\s*projectName,\s*baseBranch,\s*stopOnIncompleteStory\s*\}\)/m);
});

test("epic automation button starts epic-scoped automation endpoint with epic identifier", () => {
  const source = readFeaturesScript();

  assert.match(
    source,
    /fetch\(`\/api\/automation\/start\/epic\/\$\{encodeURIComponent\(String\(epicId\)\)\}`,\s*\{\s*method:\s*"POST"/m
  );
  assert.match(source, /body:\s*JSON\.stringify\(\{\s*projectName,\s*baseBranch,\s*stopOnIncompleteStory\s*\}\)/m);
  assert.match(
    source,
    /const result = await startEpicAutomation\(epic\.id,\s*\{\s*stopOnIncompleteStory:\s*stopOnIncompleteCheckbox\.checked\s*\}\);/m
  );
});

test("story automation button starts story-scoped automation endpoint and queues one story", () => {
  const source = readFeaturesScript();

  assert.match(
    source,
    /fetch\(`\/api\/automation\/start\/story\/\$\{encodeURIComponent\(String\(storyId\)\)\}`,\s*\{\s*method:\s*"POST"/m
  );
  assert.match(source, /body:\s*JSON\.stringify\(\{\s*projectName,\s*baseBranch\s*\}\)/m);
  assert.match(source, /const totalStories = Number\(result\?\.queue\?\.totalStories\);/);
  assert.match(source, /if \(totalStories !== 1\)/);
  assert.doesNotMatch(source, /\/api\/stories\/\$\{story\.id\}\/complete-with-automation/);
  assert.match(source, /"Complete with Automation"/);
});

test("feature card automation UI keeps existing card copy and eligibility affordance", () => {
  const source = readFeaturesScript();

  assert.match(source, /button\.textContent\s*=\s*isActiveFeatureRun\s*\?\s*"Automation Running\.\.\."\s*:\s*"Complete with Automation"/m);
  assert.match(source, /"Stop Run For Incomplete Stories"/);
  assert.match(source, /"No incomplete stories in this feature\."/);
});

test("epic card automation UI adds complete-with-automation control and status summary", () => {
  const source = readFeaturesScript();

  assert.match(source, /function createEpicAutomationUi\(content,\s*epic\)/);
  assert.match(source, /"No incomplete stories in this epic\."/);
  assert.match(source, /createEpicAutomationStatusSummary\(content,\s*epic\);/);
  assert.match(source, /button\.textContent\s*=\s*isActiveEpicRun\s*\?\s*"Automation Running\.\.\."\s*:\s*"Complete with Automation"/m);
  assert.match(source, /stopRunForIncompleteStoriesByEpicId\.get\(epic\.id\)/);
  assert.match(source, /"Stop Run For Incomplete Stories"/);
});

test("feature card shows compact automation status summary with required states and fallback", () => {
  const source = readFeaturesScript();

  assert.match(source, /function getFeatureAutomationStatus\(/);
  assert.match(source, /if \(rawStatus === "running"\) return "running";/);
  assert.match(source, /if \(rawStatus === "completed"\) return "completed";/);
  assert.match(source, /if \(rawStatus === "stopped"\) return "stopped";/);
  assert.match(source, /if \(rawStatus === "failed"\) return "failed";/);
  assert.match(source, /return "not_started";/);
  assert.match(source, /className = "feature-automation-status-row"/);
  assert.match(source, /className = `automation-status-pill automation-status-pill--\$\{status\}`/);
  assert.match(source, /createFeatureAutomationStatusSummary\(content, feature\);/);
});

test("story card automation UI stays lightweight without story-level stop-on-incomplete toggle", () => {
  const source = readFeaturesScript();

  assert.match(source, /function createStoryAutomationUi\(content,\s*story\)/);
  assert.match(source, /function createStoryAutomationStatusSummary\(content,\s*story\)/);
  assert.match(source, /function getStoryAutomationStatus\(story\)/);
  assert.match(source, /if \(rawStatus === "running"\) return "running";/);
  assert.match(source, /if \(rawStatus === "completed"\) return "completed";/);
  assert.match(source, /if \(rawStatus === "stopped"\) return "stopped";/);
  assert.match(source, /if \(rawStatus === "failed"\) return "failed";/);
  assert.match(source, /createStoryAutomationStatusSummary\(content,\s*story\);/);
  assert.match(source, /className = `automation-status-pill automation-status-pill--\$\{status\}`/);
  assert.match(source, /return "not_started";/);
  assert.doesNotMatch(source, /Stop Merge if Story Implementation is Incomplete/);
});

test("automation status summaries show persisted stop reasons for failure, incomplete stop, and manual stop", () => {
  const source = readFeaturesScript();

  assert.match(source, /function getAutomationStopReasonSummary\(stopReason\)/);
  assert.match(source, /if \(normalizedReason === "execution_failed"\)/);
  assert.match(source, /if \(normalizedReason === "story_incomplete"\)/);
  assert.match(source, /if \(normalizedReason === "manual_stop"\)/);
  assert.match(source, /Stopped because a story execution failed\./);
  assert.match(source, /Stopped because an incomplete story was found with stop-on-incomplete enabled\./);
  assert.match(source, /Stopped because a manual stop was requested\./);
  assert.match(source, /if \(status !== "stopped" && status !== "failed"\)/);
  assert.match(source, /if \(!summary\)/);
  assert.match(source, /row\.textContent = `Stop reason: \$\{summary\}`;/);
  assert.match(source, /stopReason: feature\?\.feature_automation_stop_reason/);
  assert.match(source, /stopReason: epic\?\.epic_automation_stop_reason/);
  assert.match(source, /stopReason: story\?\.story_automation_stop_reason/);
});

test("automation summaries render current executing story from backend status payload", () => {
  const source = readFeaturesScript();

  assert.match(source, /function getCurrentExecutingStorySummary\(automationType,\s*targetId\)/);
  assert.match(source, /const currentItem = globalAutomationStatus\?\.queue\?\.currentItem;/);
  assert.match(source, /if \(String\(activeRun\.status \|\| ""\)\.toLowerCase\(\) !== "running"\)/);
  assert.match(source, /row\.textContent = `Current story: \$\{summary\}`;/);
  assert.match(source, /appendCurrentExecutingStoryLine\(content,\s*"feature",\s*feature\?\.id\);/);
  assert.match(source, /appendCurrentExecutingStoryLine\(content,\s*"epic",\s*epic\?\.id\);/);
});

test("frontend polls automation status endpoint using active backend automation run id", () => {
  const source = readFeaturesScript();

  assert.match(source, /async function loadAutomationStatus\(\)/);
  assert.match(source, /const runId = Number\.parseInt\(globalAutomationLock\?\.automationRunId,\s*10\);/);
  assert.match(source, /fetch\(`\/api\/automation\/status\/\$\{encodeURIComponent\(String\(runId\)\)\}`\)/);
  assert.match(source, /globalAutomationStatus = result;/);
  assert.match(source, /await loadAutomationLock\(\);\s*await loadAutomationStatus\(\);\s*renderFeatureLists\(\);/m);
});
