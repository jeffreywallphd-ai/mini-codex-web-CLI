const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const INDEX_JS_PATH = path.resolve(__dirname, "index.js");

function readIndexSource() {
  return fs.readFileSync(INDEX_JS_PATH, "utf8");
}

test("manual run merge route uses shared mergeAutomationStoryRun orchestration", () => {
  const source = readIndexSource();
  assert.match(
    source,
    /app\.post\("\/api\/runs\/:id\/merge"[\s\S]*?await mergeAutomationStoryRun\(\{/
  );
});

test("story automation auto-merge uses shared mergeAutomationStoryRun orchestration", () => {
  const source = readIndexSource();
  assert.match(
    source,
    /Auto-merging run #[\s\S]*?await mergeAutomationStoryRun\(\{/
  );
});
