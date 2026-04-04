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

test("feature card automation UI keeps existing card copy and eligibility affordance", () => {
  const source = readFeaturesScript();

  assert.match(source, /button\.textContent\s*=\s*isActiveFeatureRun\s*\?\s*"Automation Running\.\.\."\s*:\s*"Complete with Automation"/m);
  assert.match(source, /"Stop Run For Incomplete Stories"/);
  assert.match(source, /"No incomplete stories in this feature\."/);
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
