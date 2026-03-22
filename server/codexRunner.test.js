const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EXECUTION_MODE_FLAGS,
  buildCodexExecArgs,
  extractCreditsRemaining,
  getCodexExecInput,
  normalizePrompt
} = require("./codexRunner");

test("execution mode flags are passed before stdin prompt input", () => {
  assert.deepEqual(EXECUTION_MODE_FLAGS.readonly, ["--suggest"]);
  assert.deepEqual(buildCodexExecArgs("Please update the README", "readonly"), [
    "exec",
    "--suggest",
    "-"
  ]);
  assert.deepEqual(buildCodexExecArgs("Please make the change", "auto-edit"), [
    "exec",
    "--auto-edit",
    "-"
  ]);
  assert.deepEqual(buildCodexExecArgs("Please make the change", "full-auto"), [
    "exec",
    "--full-auto",
    "-"
  ]);
});

test("prompts are normalized and sent through stdin to avoid subcommand parsing", () => {
  assert.equal(normalizePrompt("  review base branch safety  "), "review base branch safety");
  assert.equal(getCodexExecInput("  review base branch safety  "), "review base branch safety\n");
});

test("blank prompts do not create a stdin marker or input payload", () => {
  assert.deepEqual(buildCodexExecArgs("   ", "readonly"), ["exec", "--suggest"]);
  assert.equal(getCodexExecInput("   "), undefined);
});

test("credits can be parsed from different status output formats", () => {
  assert.equal(extractCreditsRemaining("remaining: 42.5"), 42.5);
  assert.equal(extractCreditsRemaining("Credits 17"), 17);
  assert.equal(extractCreditsRemaining("no credits here"), null);
});
