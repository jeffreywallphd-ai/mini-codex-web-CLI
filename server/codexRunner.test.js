const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EXECUTION_MODE_FLAGS,
  buildCodexExecArgs,
  extractCreditsRemaining
} = require("./codexRunner");

test("execution mode flags are passed after the prompt with a separator", () => {
  assert.deepEqual(EXECUTION_MODE_FLAGS.readonly, ["--", "--suggest"]);
  assert.deepEqual(buildCodexExecArgs("Please update the README", "readonly"), [
    "exec",
    "Please update the README",
    "--",
    "--suggest"
  ]);
  assert.deepEqual(buildCodexExecArgs("Please make the change", "auto-edit"), [
    "exec",
    "Please make the change",
    "--",
    "--auto-edit"
  ]);
  assert.deepEqual(buildCodexExecArgs("Please make the change", "full-auto"), [
    "exec",
    "Please make the change",
    "--",
    "--full-auto"
  ]);
});

test("blank prompts do not create an empty positional argument", () => {
  assert.deepEqual(buildCodexExecArgs("   ", "readonly"), ["exec", "--", "--suggest"]);
});

test("credits can be parsed from different status output formats", () => {
  assert.equal(extractCreditsRemaining("remaining: 42.5"), 42.5);
  assert.equal(extractCreditsRemaining("Credits 17"), 17);
  assert.equal(extractCreditsRemaining("no credits here"), null);
});
