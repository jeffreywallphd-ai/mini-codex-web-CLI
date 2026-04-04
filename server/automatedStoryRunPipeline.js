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
    const projectName = String(input.projectName || "").trim();
    const baseBranch = String(input.baseBranch || "").trim();
    const executionMode = String(input.executionMode || "write").trim() || "write";
    const streamId = input.streamId ?? null;

    if (!Number.isInteger(storyId) || storyId <= 0) {
      throw new Error("Invalid story id in automation queue.");
    }
    if (!projectName) {
      throw new Error("Project name is required.");
    }
    if (!baseBranch) {
      throw new Error("Base branch is required.");
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
      baseBranch,
      streamId
    });

    await attachRunToStory(storyId, runId);

    return {
      storyContext,
      prompt,
      runId,
      responsePayload,
      completionStatus: responsePayload?.completion_status ?? null,
      completionWork: responsePayload?.completion_work ?? null
    };
  };
}

module.exports = {
  createAutomatedStoryRunExecutor
};
