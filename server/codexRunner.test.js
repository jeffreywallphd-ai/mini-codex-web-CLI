const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EXECUTION_MODE_FLAGS,
  buildCodexExecArgs,
  extractCreditsRemaining,
  normalizePrompt
} = require("./codexRunner");

test("execution mode flags are only set for write mode", () => {
  assert.deepEqual(EXECUTION_MODE_FLAGS.read, []);
  assert.deepEqual(buildCodexExecArgs("Please update the README", "read"), [
    "exec",
    "Please update the README"
  ]);
  assert.deepEqual(buildCodexExecArgs("Please make the change", "write"), [
    "exec",
    "--full-auto",
    "Please make the change"
  ]);
});

test("prompts are normalized before being passed to codex exec", () => {
  assert.equal(normalizePrompt("  review base branch safety  "), "review base branch safety");
  assert.deepEqual(buildCodexExecArgs("  review base branch safety  ", "read"), [
    "exec",
    "review base branch safety"
  ]);
});

test("blank prompts do not create extra arguments", () => {
  assert.deepEqual(buildCodexExecArgs("   ", "read"), ["exec"]);
  assert.deepEqual(buildCodexExecArgs("   ", "write"), ["exec", "--full-auto"]);
});

test("credits can be parsed from different status output formats", () => {
  assert.equal(extractCreditsRemaining("remaining: 42.5"), 42.5);
  assert.equal(extractCreditsRemaining("Credits 17"), 17);
  assert.equal(extractCreditsRemaining("no credits here"), null);
});
