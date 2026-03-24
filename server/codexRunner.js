const EXECUTION_MODE_OPTIONS = {
  read: {},
  write: {
    sandboxMode: "workspace-write",
    approvalPolicy: "on-failure"
  }
};

const CHANGESET_MARKER_START = "<<<CODEX_CHANGESET_START>>>";
const CHANGESET_MARKER_END = "<<<CODEX_CHANGESET_END>>>";
const PROMPT_SUFFIX = `
If the project has a docs folder and a general-prompt-guidance.md file, please follow the guidance provided in general-prompt-guidance.md. 
Before you finish, append a machine-readable summary block to the very end of your response using exactly this format:
${CHANGESET_MARKER_START}
TITLE: <short title, 80 chars or fewer>
DESCRIPTION:
- <short bullet describing a change>
- <short bullet describing another change if needed>
${CHANGESET_MARKER_END}

Rules:
- Include the block exactly once.
- Keep TITLE short and suitable for a git commit / pull request title.
- Keep DESCRIPTION textual, concise, and suitable for a commit body / PR summary.
- Do not wrap the block in backticks.
`;

let codexSdkModulePromise;

function normalizePrompt(prompt) {
  return typeof prompt === "string" ? prompt.trim() : "";
}

function buildAugmentedPrompt(prompt) {
  const normalizedPrompt = normalizePrompt(prompt);
  return normalizedPrompt ? `${normalizedPrompt}\n${PROMPT_SUFFIX}` : PROMPT_SUFFIX.trim();
}

function buildThreadOptions(repoPath, executionMode = "read") {
  return {
    workingDirectory: repoPath,
    ...(EXECUTION_MODE_OPTIONS[executionMode] || EXECUTION_MODE_OPTIONS.read)
  };
}

function formatUsageSummary(usage) {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const parts = [];

  if (typeof usage.input_tokens === "number") {
    parts.push(`input=${usage.input_tokens}`);
  }

  if (typeof usage.output_tokens === "number") {
    parts.push(`output=${usage.output_tokens}`);
  }

  if (typeof usage.total_tokens === "number") {
    parts.push(`total=${usage.total_tokens}`);
  }

  if (parts.length > 0) {
    return parts.join(", ");
  }

  return JSON.stringify(usage);
}

async function loadCodexSdk() {
  codexSdkModulePromise ||= import("@openai/codex-sdk");
  return codexSdkModulePromise;
}

function parseChangeSummary(text) {
  const output = typeof text === "string" ? text : "";
  const match = output.match(
    new RegExp(
      `${CHANGESET_MARKER_START}\\s*TITLE:\\s*(.+?)\\s*DESCRIPTION:\\s*([\\s\\S]*?)\\s*${CHANGESET_MARKER_END}`
    )
  );

  if (!match) {
    return {
      responseText: output.trim(),
      changeTitle: "",
      changeDescription: ""
    };
  }

  const [, rawTitle, rawDescription] = match;
  const responseText = output.replace(match[0], "").trim();

  return {
    responseText,
    changeTitle: rawTitle.trim(),
    changeDescription: rawDescription.trim()
  };
}

async function runCodexWithSdk(repoPath, prompt, executionMode = "read") {
  const { Codex } = await loadCodexSdk();
  const codex = new Codex();

  console.log(buildThreadOptions(repoPath, executionMode));

  const thread = codex.startThread(buildThreadOptions(repoPath, executionMode));
  const result = await thread.run(buildAugmentedPrompt(prompt));
  const summary = parseChangeSummary(result.finalResponse || "");

  return {
    code: 0,
    stdout: summary.responseText,
    stderr: "",
    executedCommand: null,
    spawnCommand: null,
    statusBefore: "Not captured when using @openai/codex-sdk.",
    statusAfter: "Not captured when using @openai/codex-sdk.",
    usageDelta: formatUsageSummary(result.usage),
    creditsRemaining: null,
    executionMode,
    changeTitle: summary.changeTitle,
    changeDescription: summary.changeDescription,
    promptWithInstructions: buildAugmentedPrompt(prompt)
  };
}

async function runCodexWithUsage(repoPath, prompt, executionMode = "read") {
  return runCodexWithSdk(repoPath, prompt, executionMode);
}

module.exports = {
  runCodexWithUsage,
  EXECUTION_MODE_OPTIONS,
  buildThreadOptions,
  buildAugmentedPrompt,
  formatUsageSummary,
  normalizePrompt,
  parseChangeSummary,
  PROMPT_SUFFIX
};
