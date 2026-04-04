const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP_JS_PATH = path.resolve(__dirname, "app.js");

function readAppScript() {
  return fs.readFileSync(APP_JS_PATH, "utf8");
}

test("index page app loads context bundle selector options from context bundle API", () => {
  const source = readAppScript();

  assert.match(source, /const contextBundleSelect = document\.getElementById\("contextBundleSelect"\);/);
  assert.match(source, /const contextBundleHint = document\.getElementById\("contextBundleHint"\);/);
  assert.match(source, /async function loadContextBundles\(\)/);
  assert.match(source, /fetch\("\/api\/context-bundles\?includeParts=false"\)/);
  assert.match(source, /function formatContextBundleOption\(bundle\)/);
  assert.match(source, /const meta = \[intendedUse,\s*summary\]\.filter\(Boolean\)\.join\(" \| "\);/);
  assert.match(source, /option\.value = String\(bundleId\);/);
});

test("index run request sends one optional contextBundleId in manual run payload", () => {
  const source = readAppScript();

  assert.match(source, /const contextBundleId = Number\.parseInt\(contextBundleSelect\.value,\s*10\);/);
  assert.match(source, /const selectedContextBundleId = Number\.isInteger\(contextBundleId\) && contextBundleId > 0/);
  assert.match(source, /contextBundleId:\s*selectedContextBundleId,/);
  assert.match(source, /body:\s*JSON\.stringify\(\{\s*[\s\S]*contextBundleId:\s*selectedContextBundleId,[\s\S]*\}\)/m);
});

test("editor state persists selected context bundle choice", () => {
  const source = readAppScript();

  assert.match(source, /contextBundleId:\s*contextBundleSelect\.value \|\| ""/);
  assert.match(source, /contextBundleSelect\.value = "";/);
  assert.match(source, /\[projectSelect,\s*baseBranchSelect,\s*executionModeSelect,\s*promptInput,\s*contextBundleSelect\]\.forEach/);
});

test("index page renders selected context bundle summary metadata", () => {
  const source = readAppScript();

  assert.match(source, /const contextBundleSummaryCard = document\.getElementById\("contextBundleSummaryCard"\);/);
  assert.match(source, /function renderContextBundleSelectionSummary\(\)/);
  assert.match(source, /Summary: \$\{summary \|\| "\(\s*none\s*\)"\}/);
  assert.match(source, /Intended use: \$\{intendedUse \|\| "\(\s*none\s*\)"\}/);
  assert.match(source, /Project affinity: \$\{projectAffinity \|\| "\(\s*none\s*\)"\}/);
  assert.match(source, /contextBundleSelect\.addEventListener\("change", renderContextBundleSelectionSummary\);/);
});
