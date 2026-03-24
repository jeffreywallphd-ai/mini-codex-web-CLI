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

function formatEventMessage(message, fallback) {
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }
  return fallback;
}

function mapThreadEventToProgressEvent(event) {
  if (!event || typeof event !== "object") return null;

  if (event.type === "turn.started") {
    return {
      type: "codex.started",
      message: "Codex started."
    };
  }

  if (event.type === "turn.completed") {
    return {
      type: "codex.turn_completed",
      message: "Codex turn completed."
    };
  }

  if (event.type === "turn.failed") {
    return {
      type: "codex.failed",
      message: `Codex failed: ${formatEventMessage(event.error?.message, "Unknown error.")}`
    };
  }

  if (event.type === "error") {
    return {
      type: "codex.error",
      message: `Execution error: ${formatEventMessage(event.message, "Unknown error.")}`
    };
  }

  if (event.type !== "item.started" && event.type !== "item.completed") {
    return null;
  }

  const phase = event.type === "item.started" ? "started" : "completed";
  const item = event.item || {};

  if (item.type === "command_execution") {
    return {
      type: "codex.command",
      message: phase === "started"
        ? `Running command: ${item.command || "(unknown command)"}`
        : `Command finished: ${item.command || "(unknown command)"}`
    };
  }

  if (item.type === "mcp_tool_call") {
    const toolName = [item.server, item.tool].filter(Boolean).join("/");
    return {
      type: "codex.tool_call",
      message: phase === "started"
        ? `Running tool: ${toolName || "MCP tool"}`
        : `Tool finished: ${toolName || "MCP tool"}`
    };
  }

  if (item.type === "file_change" && phase === "completed") {
    return {
      type: "codex.file_change",
      message: `File changes detected (${Array.isArray(item.changes) ? item.changes.length : 0} files).`
    };
  }

  if (item.type === "web_search" && phase === "started") {
    return {
      type: "codex.web_search",
      message: `Running web search: ${item.query || "(no query)"}`
    };
  }

  if (item.type === "agent_message" && phase === "completed") {
    return {
      type: "codex.agent_message",
      message: "Codex produced a response."
    };
  }

  if (item.type === "error") {
    return {
      type: "codex.item_error",
      message: `Execution warning: ${formatEventMessage(item.message, "Unknown error.")}`
    };
  }

  return null;
}

async function runCodexWithSdk(repoPath, prompt, executionMode = "read", onProgressEvent = null) {
  const { Codex } = await loadCodexSdk();
  const codex = new Codex();

  console.log(buildThreadOptions(repoPath, executionMode));

  const thread = codex.startThread(buildThreadOptions(repoPath, executionMode));
  const streamedResult = await thread.runStreamed(buildAugmentedPrompt(prompt));
  let finalResponse = "";
  let usage = null;
  let turnFailure = null;

  for await (const event of streamedResult.events) {
    const progressEvent = mapThreadEventToProgressEvent(event);
    if (progressEvent && typeof onProgressEvent === "function") {
      onProgressEvent(progressEvent);
    }

    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      finalResponse = event.item.text || "";
    } else if (event.type === "turn.completed") {
      usage = event.usage;
    } else if (event.type === "turn.failed") {
      turnFailure = event.error;
    } else if (event.type === "error") {
      turnFailure = { message: event.message || "Unknown error." };
    }
  }

  if (turnFailure) {
    throw new Error(turnFailure.message || "Codex execution failed.");
  }

  const summary = parseChangeSummary(finalResponse || "");

  return {
    code: 0,
    stdout: summary.responseText,
    stderr: "",
    executedCommand: null,
    spawnCommand: null,
    statusBefore: "Not captured when using @openai/codex-sdk.",
    statusAfter: "Not captured when using @openai/codex-sdk.",
    usageDelta: formatUsageSummary(usage),
    creditsRemaining: null,
    executionMode,
    changeTitle: summary.changeTitle,
    changeDescription: summary.changeDescription,
    promptWithInstructions: buildAugmentedPrompt(prompt)
  };
}

async function runCodexWithUsage(repoPath, prompt, executionMode = "read", onProgressEvent = null) {
  return runCodexWithSdk(repoPath, prompt, executionMode, onProgressEvent);
}

module.exports = {
  runCodexWithUsage,
  EXECUTION_MODE_OPTIONS,
  buildThreadOptions,
  buildAugmentedPrompt,
  formatUsageSummary,
  normalizePrompt,
  parseChangeSummary,
  mapThreadEventToProgressEvent,
  PROMPT_SUFFIX
};
