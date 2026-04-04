const { buildStoryAutomationPrompt } = require("./storyAutomationPrompt");

function defaultErrorMessage(error) {
  if (!error) return "Unknown error";
  if (typeof error.message === "string" && error.message.trim()) {
    if (error.cause?.message && error.cause.message !== error.message) {
      return `${error.message} (cause: ${error.cause.message})`;
    }
    return error.message;
  }
  return String(error);
}

function createAutomatedStoryRunExecutor(deps = {}) {
  const {
    getStoryAutomationContext,
    executeRunFlow,
    attachRunToStory,
    getErrorMessage = defaultErrorMessage
  } = deps;

  if (typeof getStoryAutomationContext !== "function") {
    throw new Error("getStoryAutomationContext dependency is required.");
  }
  if (typeof executeRunFlow !== "function") {
    throw new Error("executeRunFlow dependency is required.");
  }
  if (typeof attachRunToStory !== "function") {
    throw new Error("attachRunToStory dependency is required.");
  }

  return async function executeAutomatedStoryRun(input = {}) {
    const storyId = Number.parseInt(input.storyId, 10);
    const rawAutomationType = String(input.automationType || "").trim().toLowerCase();
    const automationType = rawAutomationType || "story";
    const targetId = input.targetId === null || input.targetId === undefined || input.targetId === ""
      ? storyId
      : Number.parseInt(input.targetId, 10);
    const automationRunId = input.automationRunId === null || input.automationRunId === undefined || input.automationRunId === ""
      ? null
      : Number.parseInt(input.automationRunId, 10);
    const projectName = String(input.projectName || "").trim();
    const baseBranch = String(input.baseBranch || "").trim();
    const executionMode = String(input.executionMode || "write").trim() || "write";
    const contextBundleId = input.contextBundleId === null || input.contextBundleId === undefined || input.contextBundleId === ""
      ? null
      : Number.parseInt(input.contextBundleId, 10);
    const streamId = input.streamId ?? null;
    const onProgressEvent = typeof input.onProgressEvent === "function"
      ? input.onProgressEvent
      : null;

    if (!Number.isInteger(storyId) || storyId <= 0) {
      throw new Error("Invalid story id in automation queue.");
    }
    if (!projectName) {
      throw new Error("Project name is required.");
    }
    if (!baseBranch) {
      throw new Error("Base branch is required.");
    }
    if (!["feature", "epic", "story"].includes(automationType)) {
      throw new Error("Automation type must be feature, epic, or story.");
    }
    if (!Number.isInteger(targetId) || targetId <= 0) {
      throw new Error("Automation target id must be a positive integer.");
    }
    if (automationRunId !== null && (!Number.isInteger(automationRunId) || automationRunId <= 0)) {
      throw new Error("Automation run id must be a positive integer when provided.");
    }
    if (contextBundleId !== null && (!Number.isInteger(contextBundleId) || contextBundleId <= 0)) {
      throw new Error("Context bundle id must be a positive integer when provided.");
    }

    const storyContext = await getStoryAutomationContext(storyId, {
      projectName,
      baseBranch
    });
    if (!storyContext) {
      throw new Error(`Story #${storyId} was not found in project scope '${projectName}:${baseBranch}'.`);
    }

    let prompt = "";
    try {
      prompt = buildStoryAutomationPrompt(storyContext);
    } catch (promptError) {
      const wrappedPromptError = new Error(getErrorMessage(promptError));
      wrappedPromptError.code = "prompt_generation_failed";
      wrappedPromptError.cause = promptError;
      throw wrappedPromptError;
    }

    const { runId, responsePayload } = await executeRunFlow({
      projectName,
      prompt,
      executionMode,
      contextBundleId,
      baseBranch,
      streamId,
      onProgressEvent,
      runOrigin: {
        automationType,
        targetId,
        automationRunId
      }
    });

    await attachRunToStory(storyId, runId);

    return {
      storyContext,
      prompt,
      runId,
      responsePayload,
      runOrigin: {
        automationType,
        targetId,
        automationRunId
      },
      completionStatus: responsePayload?.completion_status ?? null,
      completionWork: responsePayload?.completion_work ?? null
    };
  };
}

module.exports = {
  createAutomatedStoryRunExecutor
};
