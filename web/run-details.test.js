const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RUN_DETAILS_JS_PATH = path.resolve(__dirname, "run-details.js");

function readRunDetailsScript() {
  return fs.readFileSync(RUN_DETAILS_JS_PATH, "utf8");
}

test("run details summary includes selected context bundle metadata", () => {
  const source = readRunDetailsScript();

  assert.match(source, /const contextBundleTitle = String\(run\.context_bundle_title \|\| ""\)\.trim\(\);/);
  assert.match(source, /const contextBundleId = Number\.parseInt\(run\.context_bundle_id,\s*10\);/);
  assert.match(source, /<div><strong>Context Bundle<\/strong><span>\$\{escapeHtml\(contextBundleDisplay\)\}<\/span><\/div>/);
  assert.match(source, /: `\$\{contextBundleTitle\} \(#\$\{contextBundleId\}\)`/);
  assert.match(source, /: "\(\s*none\s*\)";/);
});
