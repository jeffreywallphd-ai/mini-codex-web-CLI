const { runProcess } = require("./git");

const EXECUTION_MODE_FLAGS = {
  readonly: ["--suggest"],
  "auto-edit": ["--auto-edit"],
  "full-auto": ["--full-auto"]
};

function extractCreditsRemaining(text) {
  if (!text) return null;

  const match =
    text.match(/remaining[:\s]+([\d.]+)/i) ||
    text.match(/credits[:\s]+([\d.]+)/i);

  return match ? parseFloat(match[1]) : null;
}

function normalizePrompt(prompt) {
  return typeof prompt === "string" ? prompt.trim() : "";
}

function buildCodexExecArgs(prompt, executionMode = "readonly") {
  const modeArgs = EXECUTION_MODE_FLAGS[executionMode] || EXECUTION_MODE_FLAGS.readonly;
  const trimmedPrompt = normalizePrompt(prompt);

  if (!trimmedPrompt) {
    return ["exec", ...modeArgs];
  }

  return ["exec", ...modeArgs, "-"];
}

function getCodexExecInput(prompt) {
  const trimmedPrompt = normalizePrompt(prompt);
  return trimmedPrompt ? `${trimmedPrompt}\n` : undefined;
}

async function runCommand(repoPath, commandArgs, options = {}) {
  const [command, ...args] = commandArgs;
  return runProcess(repoPath, command, args, options);
}

async function runCodexWithUsage(repoPath, prompt, executionMode = "readonly") {
  const statusBefore = await runCommand(repoPath, ["codex", "status"]);

  const beforeCredits = extractCreditsRemaining(
    [statusBefore.stdout, statusBefore.stderr].filter(Boolean).join("\n")
  );

  const result = await runCommand(
    repoPath,
    ["codex", ...buildCodexExecArgs(prompt, executionMode)],
    { input: getCodexExecInput(prompt) }
  );

  const statusAfter = await runCommand(repoPath, ["codex", "status"]);

  const afterCredits = extractCreditsRemaining(
    [statusAfter.stdout, statusAfter.stderr].filter(Boolean).join("\n")
  );

  let usageDelta = null;

  if (beforeCredits !== null && afterCredits !== null) {
    usageDelta = (beforeCredits - afterCredits).toFixed(4);
  }

  return {
    ...result,
    executionMode,
    statusBefore: [statusBefore.stdout, statusBefore.stderr].filter(Boolean).join("\n"),
    statusAfter: [statusAfter.stdout, statusAfter.stderr].filter(Boolean).join("\n"),
    usageDelta,
    creditsRemaining: afterCredits
  };
}

module.exports = {
  runCodexWithUsage,
  EXECUTION_MODE_FLAGS,
  buildCodexExecArgs,
  extractCreditsRemaining,
  getCodexExecInput,
  normalizePrompt
};
