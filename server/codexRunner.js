const { runProcess } = require("./git");

const EXECUTION_MODE_FLAGS = {
  read: [],
  write: ["--full-auto", "--ask-for-approval", "on-failure", "--sandbox", "workspace-write"]
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

function buildCodexExecArgs(prompt, executionMode = "read") {
  const modeArgs = EXECUTION_MODE_FLAGS[executionMode] || EXECUTION_MODE_FLAGS.read;
  const trimmedPrompt = normalizePrompt(prompt);
  const args = ["exec", ...modeArgs];

  if (!trimmedPrompt) {
    return args;
  }

  return [...args, trimmedPrompt];
}

async function runCommand(repoPath, commandArgs, options = {}) {
  const [command, ...args] = commandArgs;
  return runProcess(repoPath, command, args, options);
}

async function runCodexWithUsage(repoPath, prompt, executionMode = "read") {
  const statusBefore = await runCommand(repoPath, ["codex", "status"]);

  const beforeCredits = extractCreditsRemaining(
    [statusBefore.stdout, statusBefore.stderr].filter(Boolean).join("\n")
  );

  const commandArgs = ["codex", ...buildCodexExecArgs(prompt, executionMode)];
  const result = await runCommand(repoPath, commandArgs);

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
    executedCommand: result.executedCommand,
    spawnCommand: result.spawnCommand,
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
  normalizePrompt
};
