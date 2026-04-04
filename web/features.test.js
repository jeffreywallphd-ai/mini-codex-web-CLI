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
  assert.match(source, /body:\s*JSON\.stringify\(\{\s*projectName,\s*baseBranch\s*\}\)/m);
});

test("feature card automation UI keeps existing card copy and eligibility affordance", () => {
  const source = readFeaturesScript();

  assert.match(source, /button\.textContent\s*=\s*isActiveFeatureRun\s*\?\s*"Automation Running\.\.\."\s*:\s*"Complete with Automation"/m);
  assert.match(source, /"No incomplete stories in this feature\."/);
});
