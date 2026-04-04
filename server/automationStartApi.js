const express = require("express");

const { defineAutomationExecutionPlan, normalizeCompletionStatus } = require("./automationQueue");
const { sortByPosition, toPositiveInteger } = require("./automationQueuePosition");
const { runSequentialStoryQueue } = require("./automationRunner");

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function normalizeStoryCompletionStatus(status) {
  return normalizeCompletionStatus({ completion_status: status });
}

function mapFinalAutomationState(result) {
  if (result?.status === "completed") {
    return {
      automationStatus: "completed",
      stopFlag: false,
      stopReason: result.stopReason || "all_work_complete"
    };
  }

  if (result?.status === "stopped") {
    return {
      automationStatus: "stopped",
      stopFlag: true,
      stopReason: result.stopReason || "story_incomplete"
    };
  }

  return {
    automationStatus: "failed",
    stopFlag: true,
    stopReason: result?.stopReason || "execution_failed"
  };
}

function defaultDetachedExecutor(task, logger) {
  setImmediate(() => {
    task().catch((error) => {
      logger?.error?.("automation background execution failed:", error);
    });
  });
}

function logAutomationLifecycle(logger, eventType, details = {}) {
  logger?.info?.("automation.lifecycle", {
    eventType,
    at: new Date().toISOString(),
    ...details
  });
}

function parseTargetId(targetIdRaw) {
  return parseStrictPositiveInteger(targetIdRaw);
}

function parseStrictPositiveInteger(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalTargetId(value) {
  if (value === null || value === undefined || value === "") {
    return {
      provided: false,
      targetId: null,
      invalid: false
    };
  }

  const targetId = parseTargetId(value);
  return {
    provided: true,
    targetId,
    invalid: targetId === null
  };
}

function parseOptionalPositiveId(value) {
  if (value === null || value === undefined || value === "") {
    return {
      provided: false,
      value: null,
      invalid: false
    };
  }

  const parsed = parseStrictPositiveInteger(value);
  return {
    provided: true,
    value: Number.isInteger(parsed) && parsed > 0 ? parsed : null,
    invalid: !(Number.isInteger(parsed) && parsed > 0)
  };
}

function parseContextBundleSelection(body = {}) {
  const pluralContextBundleFields = ["contextBundleIds", "context_bundle_ids", "contextBundles"];
  for (const fieldName of pluralContextBundleFields) {
    if (!Object.prototype.hasOwnProperty.call(body, fieldName)) {
      continue;
    }

    const value = body[fieldName];
    const normalizedValues = Array.isArray(value)
      ? value.filter((item) => !(item === null || item === undefined || item === ""))
      : [];

    if (Array.isArray(value) && normalizedValues.length > 1) {
      return {
        invalid: true,
        message: "Multiple context bundle references are not allowed. Provide only one contextBundleId."
      };
    }

    return {
      invalid: true,
      message: "Use contextBundleId to select a single context bundle."
    };
  }

  if (!Object.prototype.hasOwnProperty.call(body, "contextBundleId")) {
    return {
      invalid: false,
      provided: false,
      contextBundleId: null
    };
  }

  const rawContextBundleId = body.contextBundleId;
  if (Array.isArray(rawContextBundleId)) {
    const normalizedValues = rawContextBundleId.filter((item) => !(item === null || item === undefined || item === ""));
    if (normalizedValues.length > 1) {
      return {
        invalid: true,
        message: "Multiple context bundle references are not allowed. Provide only one contextBundleId."
      };
    }

    return {
      invalid: true,
      message: "contextBundleId must be a single positive integer when provided."
    };
  }

  const parsedContextBundle = parseOptionalPositiveId(rawContextBundleId);
  if (parsedContextBundle.invalid) {
    return {
      invalid: true,
      message: "Invalid context bundle id in request body."
    };
  }

  return {
    invalid: false,
    provided: parsedContextBundle.provided,
    contextBundleId: parsedContextBundle.value
  };
}

function toStatusApiAutomationRun(automationRun) {
  const contextBundleId = Number.parseInt(automationRun.context_bundle_id, 10);
  const contextBundleTitle = typeof automationRun?.context_bundle_title === "string"
    ? automationRun.context_bundle_title.trim()
    : "";
  return {
    id: automationRun.id,
    automationType: automationRun.automation_type,
    targetId: automationRun.target_id,
    projectName: automationRun.project_name ?? null,
    baseBranch: automationRun.base_branch ?? null,
    stopOnIncomplete: automationRun.stop_on_incomplete === 1,
    stopFlag: automationRun.stop_flag === 1,
    currentPosition: automationRun.current_position,
    status: automationRun.automation_status,
    stopReason: automationRun.stop_reason,
    contextBundleId: Number.isInteger(contextBundleId) && contextBundleId > 0 ? contextBundleId : null,
    contextBundleTitle: contextBundleTitle || null,
    failedStoryId: automationRun.failed_story_id ?? null,
    failureSummary: automationRun.failure_summary ?? null,
    createdAt: automationRun.created_at,
    updatedAt: automationRun.updated_at
  };
}

function toStatusApiExecutionSummary(execution = {}, queueContext = {}) {
  const storyTitle = typeof queueContext?.storyTitle === "string" && queueContext.storyTitle.trim()
    ? queueContext.storyTitle.trim()
    : null;

  return {
    id: execution.id ?? null,
    storyId: execution.story_id ?? null,
    storyTitle,
    positionInQueue: execution.position_in_queue ?? null,
    executionStatus: execution.execution_status ?? null,
    queueAction: execution.queue_action ?? null,
    runId: execution.run_id ?? null,
    completionStatus: execution.completion_status ?? null,
    completionWork: execution.completion_work ?? null,
    error: execution.error ?? null,
    createdAt: execution.created_at ?? null
  };
}

function sortQueueStoriesByPosition(queueStories = []) {
  return sortByPosition(queueStories, (story) => story?.positionInQueue);
}

function sortExecutionsByPosition(storyExecutions = []) {
  return sortByPosition(
    storyExecutions,
    (execution) => execution?.position_in_queue,
    (execution) => execution?.id
  );
}

function getLatestExecutionsByPosition(storyExecutions = []) {
  const orderedExecutions = sortExecutionsByPosition(storyExecutions);
  const latestByPosition = new Map();

  for (const execution of orderedExecutions) {
    const positionInQueue = toPositiveInteger(execution?.position_in_queue);
    if (positionInQueue === null) {
      continue;
    }

    latestByPosition.set(positionInQueue, execution);
  }

  return latestByPosition;
}

function getCompletedQueuePositions(storyExecutions = []) {
  return new Set(
    [...getLatestExecutionsByPosition(storyExecutions).values()]
      .filter((execution) => execution.execution_status === "completed")
      .map((execution) => Number.parseInt(execution.position_in_queue, 10))
      .filter((position) => Number.isInteger(position) && position > 0)
  );
}

function getRemainingQueueStories(persistedQueueStories = [], storyExecutions = []) {
  const orderedQueueStories = sortQueueStoriesByPosition(persistedQueueStories);
  const completedPositions = getCompletedQueuePositions(storyExecutions);
  return orderedQueueStories.filter((story) => {
    const positionInQueue = toPositiveInteger(story?.positionInQueue);
    return positionInQueue !== null && !completedPositions.has(positionInQueue);
  });
}

function resolveStoryProgressPosition({
  storyResult,
  queueState,
  totalStoriesInRunQueue,
  fallbackPosition
}) {
  const normalizedTotalStories = Number.isInteger(totalStoriesInRunQueue) && totalStoriesInRunQueue > 0
    ? totalStoriesInRunQueue
    : 0;
  const normalizedFallback = Number.isInteger(fallbackPosition) && fallbackPosition > 0
    ? fallbackPosition
    : 1;
  const storyPosition = Number.parseInt(storyResult?.positionInQueue, 10);
  const hasStoryPosition = Number.isInteger(storyPosition) && storyPosition > 0;
  const queueAction = String(storyResult?.queueAction || "").trim().toLowerCase();
  const stopReason = String(queueState?.stopReason || "").trim().toLowerCase();

  if (normalizedTotalStories <= 0) {
    return 1;
  }

  if (!hasStoryPosition) {
    return Math.min(normalizedTotalStories, normalizedFallback);
  }

  if (queueAction === "advanced") {
    return Math.min(normalizedTotalStories, Math.max(1, storyPosition + 1));
  }

  if (queueAction === "failed") {
    return Math.min(normalizedTotalStories, Math.max(1, storyPosition));
  }

  if (queueAction === "stopped") {
    if (stopReason === "manual_stop") {
      return Math.min(normalizedTotalStories, Math.max(1, storyPosition + 1));
    }

    return Math.min(normalizedTotalStories, Math.max(1, storyPosition));
  }

  return Math.min(normalizedTotalStories, Math.max(1, storyPosition));
}

function getActiveAutomationConflictPayload(activeAutomation) {
  if (!activeAutomation) {
    return null;
  }

  return {
    status: 423,
    payload: {
      error: `Automation is already running for ${activeAutomation.projectName} (${activeAutomation.baseBranch}).`
    }
  };
}

async function validateBranchExists({ projectName, baseBranch, listLocalBranches, getRepoPath }) {
  const branchResult = await listLocalBranches(getRepoPath(projectName));
  if (!branchResult.branches.includes(baseBranch)) {
    return {
      status: 400,
      payload: {
        error: `Invalid base branch '${baseBranch}' for project '${projectName}'.`
      }
    };
  }

  return null;
}

function toLaunchAcceptedResponse({
  launchMode,
  automationRun,
  queuedStories,
  queueExtras = null,
  projectName,
  baseBranch,
  queueStatus = null
}) {
  const orderedQueuedStories = sortQueueStoriesByPosition(queuedStories);
  const queue = {
    totalStories: orderedQueuedStories.length,
    storyIds: orderedQueuedStories.map((story) => story.storyId)
  };

  if (queueStatus) {
    queue.queueStatus = queueStatus;
  }

  if (queueExtras && typeof queueExtras === "object") {
    Object.assign(queue, queueExtras);
  }

  return {
    launchMode,
    automationRun: toStatusApiAutomationRun(automationRun),
    queue,
    projectName,
    baseBranch
  };
}

function activateAutomationLock({
  runningProjects,
  setActiveAutomation,
  automationRun,
  projectName,
  baseBranch
}) {
  runningProjects.add(projectName);
  setActiveAutomation({
    automationRunId: automationRun.id,
    automationType: automationRun.automation_type,
    targetId: automationRun.target_id,
    projectName,
    baseBranch,
    storyId: automationRun.automation_type === "story" ? automationRun.target_id : null,
    startedAt: new Date().toISOString()
  });
}

function launchAutomation({
  runDetached,
  executeAutomationInBackground,
  logger,
  launchMode,
  automationRun,
  automationType,
  targetId,
  projectName,
  baseBranch,
  stopOnIncompleteStory,
  stories,
  totalStoriesInRunQueue,
  initialPosition,
  contextBundleId = null
}) {
  runDetached(() => executeAutomationInBackground({
    automationRun,
    projectName,
    baseBranch,
    automationType,
    targetId,
    stories,
    stopOnIncompleteStory,
    totalStoriesInRunQueue,
    initialPosition,
    contextBundleId
  }), logger);

  const lifecyclePayload = {
    launchMode,
    automationRunId: automationRun.id,
    automationType,
    targetId,
    projectName,
    baseBranch,
    stopOnIncompleteStory,
    queuedStories: stories.length
  };

  if (launchMode === "resume" && Number.isInteger(totalStoriesInRunQueue) && totalStoriesInRunQueue > 0) {
    lifecyclePayload.totalStoriesInRunQueue = totalStoriesInRunQueue;
    lifecyclePayload.skippedCompletedStories = totalStoriesInRunQueue - stories.length;
  }
  if (Number.isInteger(contextBundleId) && contextBundleId > 0) {
    lifecyclePayload.contextBundleId = contextBundleId;
  }

  logAutomationLifecycle(logger, "automation_launch_accepted", lifecyclePayload);
}

function resolveFinalCurrentPosition(runnerResult, totalStories, finalState, initialPosition = 1) {
  const normalizedTotalStories = Number.isInteger(totalStories) && totalStories > 0
    ? totalStories
    : 0;
  const normalizedInitialPosition = Number.isInteger(initialPosition) && initialPosition > 0
    ? initialPosition
    : 1;

  const lastStoryResult = Array.isArray(runnerResult?.storyResults) && runnerResult.storyResults.length > 0
    ? runnerResult.storyResults[runnerResult.storyResults.length - 1]
    : null;
  const lastPosition = Number.parseInt(lastStoryResult?.positionInQueue, 10);
  const hasLastPosition = Number.isInteger(lastPosition) && lastPosition > 0;

  if (normalizedTotalStories <= 0) {
    return 1;
  }

  if (finalState.automationStatus === "completed") {
    return normalizedTotalStories;
  }

  if (finalState.stopReason === "manual_stop") {
    if (hasLastPosition) {
      return Math.min(normalizedTotalStories, Math.max(1, lastPosition + 1));
    }
    return Math.min(normalizedTotalStories, normalizedInitialPosition);
  }

  if (finalState.automationStatus === "failed") {
    if (hasLastPosition) {
      return Math.min(normalizedTotalStories, Math.max(1, lastPosition));
    }
    return Math.min(normalizedTotalStories, normalizedInitialPosition);
  }

  if (hasLastPosition) {
    return Math.min(normalizedTotalStories, Math.max(1, lastPosition));
  }

  return Math.min(normalizedTotalStories, normalizedInitialPosition);
}

function buildAutomationConflictResponse(conflictingRun) {
  const automationType = String(conflictingRun?.automation_type || "").trim().toLowerCase();
  const targetId = Number.parseInt(conflictingRun?.target_id, 10);
  const projectName = String(conflictingRun?.project_name || "").trim();
  const baseBranch = String(conflictingRun?.base_branch || "").trim();
  const automationRunId = Number.parseInt(conflictingRun?.id, 10);
  const targetLabel = automationType && Number.isInteger(targetId)
    ? `${automationType} #${targetId}`
    : "the selected target";
  const runLabel = Number.isInteger(automationRunId) ? ` (run #${automationRunId})` : "";
  const scopeLabel = projectName && baseBranch ? ` for ${projectName} (${baseBranch})` : "";

  return {
    error: `Automation is already running for ${targetLabel}${scopeLabel}${runLabel}.`,
    errorType: "automation_target_conflict",
    conflict: {
      automationRunId: Number.isInteger(automationRunId) ? automationRunId : null,
      automationType: automationType || null,
      targetId: Number.isInteger(targetId) ? targetId : null,
      projectName: projectName || null,
      baseBranch: baseBranch || null,
      contextBundleId: Number.isInteger(Number.parseInt(conflictingRun?.context_bundle_id, 10))
        ? Number.parseInt(conflictingRun.context_bundle_id, 10)
        : null,
      contextBundleTitle: typeof conflictingRun?.context_bundle_title === "string"
        && conflictingRun.context_bundle_title.trim()
        ? conflictingRun.context_bundle_title.trim()
        : null,
      status: String(conflictingRun?.automation_status || "").trim().toLowerCase() || null
    }
  };
}

function isAutomationTargetConflictError(error) {
  const normalizedCode = String(error?.code || "").trim().toLowerCase();
  if (normalizedCode === "automation_target_conflict") {
    return true;
  }

  if (normalizedCode !== "sqlite_constraint" && normalizedCode !== "sqlite_constraint_unique") {
    return false;
  }

  const normalizedMessage = String(error?.message || "").trim().toLowerCase();
  return normalizedMessage.includes("automation_runs.automation_type")
    && normalizedMessage.includes("automation_runs.target_id");
}

function buildFallbackAutomationConflict({
  automationType,
  targetId,
  projectName,
  baseBranch
}) {
  return {
    automation_type: automationType,
    target_id: targetId,
    project_name: projectName,
    base_branch: baseBranch,
    context_bundle_id: null,
    context_bundle_title: null,
    automation_status: "running"
  };
}

function getLatestFailedStoryResult(runnerResult) {
  const storyResults = Array.isArray(runnerResult?.storyResults)
    ? runnerResult.storyResults
    : [];

  for (let index = storyResults.length - 1; index >= 0; index -= 1) {
    const storyResult = storyResults[index];
    if (String(storyResult?.status || "").trim().toLowerCase() === "failed") {
      return storyResult;
    }
  }

  return null;
}

function createAutomationStartRouter(deps = {}) {
  const {
    isValidProject,
    listLocalBranches,
    getRepoPath,
    getFeaturesTree,
    createAutomationRun,
    findRunningAutomationByScope,
    updateAutomationRunMetadata,
    recordAutomationRunQueueItems,
    recordAutomationStoryExecution,
    executeAutomatedStoryRun,
    getAutomationRunById,
    getAutomationStoryExecutionsByRunId,
    getAutomationRunQueueItemsByRunId,
    getAutomationQueueStoriesByTarget,
    mergeAutomationStoryRun,
    getErrorMessage,
    runningProjects,
    getActiveAutomation,
    setActiveAutomation,
    logger = console,
    runDetached = defaultDetachedExecutor
  } = deps;

  if (typeof isValidProject !== "function") throw new Error("isValidProject dependency is required.");
  if (typeof listLocalBranches !== "function") throw new Error("listLocalBranches dependency is required.");
  if (typeof getRepoPath !== "function") throw new Error("getRepoPath dependency is required.");
  if (typeof getFeaturesTree !== "function") throw new Error("getFeaturesTree dependency is required.");
  if (typeof createAutomationRun !== "function") throw new Error("createAutomationRun dependency is required.");
  if (typeof findRunningAutomationByScope !== "function") throw new Error("findRunningAutomationByScope dependency is required.");
  if (typeof updateAutomationRunMetadata !== "function") throw new Error("updateAutomationRunMetadata dependency is required.");
  if (typeof recordAutomationRunQueueItems !== "function") throw new Error("recordAutomationRunQueueItems dependency is required.");
  if (typeof recordAutomationStoryExecution !== "function") throw new Error("recordAutomationStoryExecution dependency is required.");
  if (typeof executeAutomatedStoryRun !== "function") throw new Error("executeAutomatedStoryRun dependency is required.");
  if (typeof getAutomationRunById !== "function") throw new Error("getAutomationRunById dependency is required.");
  if (typeof getAutomationStoryExecutionsByRunId !== "function") throw new Error("getAutomationStoryExecutionsByRunId dependency is required.");
  if (typeof getAutomationRunQueueItemsByRunId !== "function") throw new Error("getAutomationRunQueueItemsByRunId dependency is required.");
  if (typeof getAutomationQueueStoriesByTarget !== "function") throw new Error("getAutomationQueueStoriesByTarget dependency is required.");
  if (typeof mergeAutomationStoryRun !== "function") throw new Error("mergeAutomationStoryRun dependency is required.");
  if (typeof getErrorMessage !== "function") throw new Error("getErrorMessage dependency is required.");
  if (!runningProjects || typeof runningProjects.has !== "function") throw new Error("runningProjects dependency is required.");
  if (typeof getActiveAutomation !== "function") throw new Error("getActiveAutomation dependency is required.");
  if (typeof setActiveAutomation !== "function") throw new Error("setActiveAutomation dependency is required.");

  const router = express.Router();
  const activeStoryRuntimeByAutomationRunId = new Map();

  async function executeAutomationInBackground({
    automationRun,
    projectName,
    baseBranch,
    automationType,
    targetId,
    stories,
    stopOnIncompleteStory,
    totalStoriesInRunQueue = null,
    initialPosition = null,
    contextBundleId = null
  }) {
    const normalizedTotalStoriesInRunQueue = Number.isInteger(totalStoriesInRunQueue) && totalStoriesInRunQueue > 0
      ? totalStoriesInRunQueue
      : stories.length;
    const normalizedInitialPosition = Number.isInteger(initialPosition) && initialPosition > 0
      ? initialPosition
      : 1;

    try {
      logAutomationLifecycle(logger, "automation_started", {
        automationRunId: automationRun.id,
        automationType,
        targetId,
        projectName,
        baseBranch,
        storyCount: stories.length,
        stopOnIncompleteStory
      });

      const runnerResult = await runSequentialStoryQueue({
        stories,
        stopOnIncompleteStory,
        shouldStop: async () => {
          const latestAutomationRun = await getAutomationRunById(automationRun.id);
          if (!latestAutomationRun) {
            return false;
          }

          const isManualStopRequested = latestAutomationRun.stop_flag === 1
            && latestAutomationRun.stop_reason === "manual_stop";
          return isManualStopRequested;
        },
        executeStory: async (storyQueueItem) => {
          const storyResult = await executeAutomatedStoryRun({
            storyId: storyQueueItem?.storyId,
            projectName,
            baseBranch,
            executionMode: "write",
            contextBundleId,
            automationType,
            targetId,
            automationRunId: automationRun.id,
            onProgressEvent: (event) => {
              if (!event || typeof event !== "object") {
                return;
              }

              if (String(event.type || "").trim().toLowerCase() !== "codex.command") {
                return;
              }

              const currentRuntime = activeStoryRuntimeByAutomationRunId.get(automationRun.id) || {};
              const message = String(event.message || "").trim();
              let command = message;
              if (message.toLowerCase().startsWith("running command:")) {
                command = message.slice("running command:".length).trim();
              }
              if (!command) {
                return;
              }

              activeStoryRuntimeByAutomationRunId.set(automationRun.id, {
                ...currentRuntime,
                runningCodexCommand: command
              });
            }
          });
          const normalizedRunId = Number.parseInt(storyResult?.runId, 10);
          const runPayload = storyResult?.responsePayload || {};
          const branchName = String(runPayload?.branchName || runPayload?.branch_name || "").trim();
          const changeTitle = String(runPayload?.changeTitle || runPayload?.change_title || "").trim() || "Codex changes";
          const changeDescription = String(runPayload?.changeDescription || runPayload?.change_description || "");

          if (!Number.isInteger(normalizedRunId) || normalizedRunId <= 0) {
            const mergeContextError = new Error("Story automation did not return a valid run id for auto-merge.");
            mergeContextError.code = "merge_failed";
            throw mergeContextError;
          }

          if (!branchName) {
            const mergeContextError = new Error(`Story run #${normalizedRunId} did not include a branch name for auto-merge.`);
            mergeContextError.code = "merge_failed";
            throw mergeContextError;
          }

          try {
            await mergeAutomationStoryRun({
              projectName,
              baseBranch,
              runId: normalizedRunId,
              branchName,
              changeTitle,
              changeDescription
            });
          } catch (error) {
            const wrappedMergeError = new Error(getErrorMessage(error));
            wrappedMergeError.code = "merge_failed";
            wrappedMergeError.cause = error;
            throw wrappedMergeError;
          }

          return {
            runId: storyResult.runId,
            completionStatus: storyResult.completionStatus,
            completionWork: storyResult.completionWork
          };
        },
        onStoryStart: async (storyStart) => {
          const startedAt = new Date().toISOString();
          const runtimeState = {
            storyId: storyStart?.storyId ?? null,
            positionInQueue: storyStart?.positionInQueue ?? null,
            startedAt,
            runningCodexCommand: ""
          };
          activeStoryRuntimeByAutomationRunId.set(automationRun.id, runtimeState);
          const active = getActiveAutomation();
          if (active?.automationRunId === automationRun.id) {
            setActiveAutomation({
              ...active,
              currentStoryId: runtimeState.storyId,
              currentStoryPositionInQueue: runtimeState.positionInQueue,
              currentStoryStartedAt: runtimeState.startedAt,
              currentStoryCodexCommand: runtimeState.runningCodexCommand
            });
          }

          logAutomationLifecycle(logger, "story_queue_started", {
            automationRunId: automationRun.id,
            automationType,
            targetId,
            projectName,
            baseBranch,
            storyId: storyStart?.storyId ?? null,
            storyTitle: storyStart?.storyTitle ?? null,
            positionInQueue: storyStart?.positionInQueue ?? null,
            totalStoriesInRunQueue: storyStart?.totalStories ?? normalizedTotalStoriesInRunQueue
          });
        },
        onProgress: async (snapshot) => {
          try {
            const processedStories = Number.isInteger(snapshot?.processedStories) ? snapshot.processedStories : 0;
            const lastProcessedPosition = Number.parseInt(snapshot?.lastResult?.positionInQueue, 10);
            const nextPosition = Number.isInteger(lastProcessedPosition) && lastProcessedPosition > 0
              ? Math.min(normalizedTotalStoriesInRunQueue, Math.max(1, lastProcessedPosition + 1))
              : (
                normalizedTotalStoriesInRunQueue > 0
                  ? Math.min(normalizedTotalStoriesInRunQueue, Math.max(1, processedStories + 1))
                  : normalizedInitialPosition
              );

            await updateAutomationRunMetadata(automationRun.id, {
              currentPosition: nextPosition
            });
          } catch (error) {
            logger.error("automation progress update failed:", error);
          }
        },
        onStoryResult: async (storyResult, queueState) => {
          const runtimeState = activeStoryRuntimeByAutomationRunId.get(automationRun.id) || {};
          activeStoryRuntimeByAutomationRunId.set(automationRun.id, {
            ...runtimeState,
            runningCodexCommand: "",
            lastCompletedStoryId: storyResult?.storyId ?? runtimeState.lastCompletedStoryId ?? null
          });
          const active = getActiveAutomation();
          if (active?.automationRunId === automationRun.id) {
            setActiveAutomation({
              ...active,
              currentStoryCodexCommand: ""
            });
          }

          logAutomationLifecycle(logger, "story_execution_completed", {
            automationRunId: automationRun.id,
            automationType,
            targetId,
            projectName,
            baseBranch,
            storyId: storyResult?.storyId ?? null,
            positionInQueue: storyResult?.positionInQueue ?? null,
            executionStatus: storyResult?.status ?? null,
            queueAction: storyResult?.queueAction ?? null,
            completionStatus: normalizeStoryCompletionStatus(storyResult?.completionStatus),
            runId: storyResult?.runId ?? null,
            error: storyResult?.error ?? null
          });

          try {
            await recordAutomationStoryExecution({
              automationRunId: automationRun.id,
              storyId: storyResult.storyId,
              positionInQueue: storyResult.positionInQueue,
              executionStatus: storyResult.status === "failed" ? "failed" : "completed",
              queueAction: storyResult.queueAction,
              runId: storyResult.runId ?? null,
              completionStatus: normalizeStoryCompletionStatus(storyResult.completionStatus),
              completionWork: storyResult.completionWork ?? null,
              error: storyResult.error ?? null
            });
          } catch (error) {
            logger.error("automation story execution persistence failed:", error);
          }

          try {
            await updateAutomationRunMetadata(automationRun.id, {
              currentPosition: resolveStoryProgressPosition({
                storyResult,
                queueState,
                totalStoriesInRunQueue: normalizedTotalStoriesInRunQueue,
                fallbackPosition: normalizedInitialPosition
              })
            });
          } catch (error) {
            logger.error("automation story progress location update failed:", error);
          }
        }
      });

      const finalState = mapFinalAutomationState(runnerResult);
      const failedStoryResult = getLatestFailedStoryResult(runnerResult);
      const normalizedFailedStoryId = Number.parseInt(failedStoryResult?.storyId, 10);
      const failedStoryId = Number.isInteger(normalizedFailedStoryId) && normalizedFailedStoryId > 0
        ? normalizedFailedStoryId
        : null;
      const failureSummary = typeof failedStoryResult?.error === "string" && failedStoryResult.error.trim()
        ? failedStoryResult.error.trim()
        : null;
      logAutomationLifecycle(logger, "automation_stop_reason", {
        automationRunId: automationRun.id,
        automationType,
        targetId,
        projectName,
        baseBranch,
        stopReason: finalState.stopReason,
        failedStoryId,
        failureSummary
      });
      await updateAutomationRunMetadata(automationRun.id, {
        stopFlag: finalState.stopFlag,
        currentPosition: resolveFinalCurrentPosition(
          runnerResult,
          normalizedTotalStoriesInRunQueue,
          finalState,
          normalizedInitialPosition
        ),
        automationStatus: finalState.automationStatus,
        stopReason: finalState.stopReason,
        failedStoryId: finalState.automationStatus === "failed" ? failedStoryId : null,
        failureSummary: finalState.automationStatus === "failed" ? failureSummary : null
      });
      logAutomationLifecycle(logger, "automation_final_result", {
        automationRunId: automationRun.id,
        automationType,
        targetId,
        projectName,
        baseBranch,
        status: finalState.automationStatus,
        stopReason: finalState.stopReason,
        failedStoryId,
        failureSummary,
        processedStories: runnerResult?.processedStories ?? 0,
        totalStoriesInRunQueue: normalizedTotalStoriesInRunQueue
      });
    } catch (error) {
      const runtimeState = activeStoryRuntimeByAutomationRunId.get(automationRun.id) || {};
      const normalizedFailedStoryId = Number.parseInt(runtimeState?.storyId, 10);
      const failedStoryId = Number.isInteger(normalizedFailedStoryId) && normalizedFailedStoryId > 0
        ? normalizedFailedStoryId
        : null;
      const failureSummary = String(getErrorMessage(error) || "").trim() || null;
      try {
        await updateAutomationRunMetadata(automationRun.id, {
          stopFlag: true,
          automationStatus: "failed",
          stopReason: String(error?.code || "").trim().toLowerCase() === "merge_failed"
            ? "merge_failed"
            : "execution_failed",
          failedStoryId,
          failureSummary
        });
      } catch (metadataError) {
        logger.error("automation metadata update failed:", metadataError);
      }

      logger.error("automation execution failed:", {
        automationRunId: automationRun.id,
        projectName,
        baseBranch,
        automationType,
        targetId,
        error: getErrorMessage(error)
      });
      logAutomationLifecycle(logger, "automation_stop_reason", {
        automationRunId: automationRun.id,
        automationType,
        targetId,
        projectName,
        baseBranch,
        stopReason: String(error?.code || "").trim().toLowerCase() === "merge_failed"
          ? "merge_failed"
          : "execution_failed",
        failedStoryId,
        failureSummary
      });
      logAutomationLifecycle(logger, "automation_final_result", {
        automationRunId: automationRun.id,
        automationType,
        targetId,
        projectName,
        baseBranch,
        status: "failed",
        stopReason: String(error?.code || "").trim().toLowerCase() === "merge_failed"
          ? "merge_failed"
          : "execution_failed",
        failedStoryId,
        failureSummary,
        totalStoriesInRunQueue: normalizedTotalStoriesInRunQueue,
        error: getErrorMessage(error)
      });
    } finally {
      activeStoryRuntimeByAutomationRunId.delete(automationRun.id);
      runningProjects.delete(projectName);
      const active = getActiveAutomation();
      if (active?.automationRunId === automationRun.id) {
        setActiveAutomation(null);
      }
    }
  }

  async function startScopedAutomation(req, res, automationType, targetParamName) {
    const targetId = parseTargetId(req.params?.[targetParamName]);
    const projectName = String(req.body?.projectName || "").trim();
    const baseBranch = String(req.body?.baseBranch || "").trim();
    const stopOnIncompleteStory = normalizeBoolean(req.body?.stopOnIncompleteStory);
    const requestedAutomationType = String(req.body?.automationType || "").trim().toLowerCase();
    const requestedTargetId = parseOptionalTargetId(req.body?.targetId);
    const scopedTargetId = parseOptionalTargetId(req.body?.[targetParamName]);
    const contextBundleSelection = parseContextBundleSelection(req.body || {});

    if (!targetId) {
      return res.status(400).json({ error: `Invalid ${automationType} id.` });
    }

    if (requestedAutomationType && requestedAutomationType !== automationType) {
      return res.status(400).json({
        error: `Automation scope mismatch: expected '${automationType}' but received '${requestedAutomationType}'.`
      });
    }

    if (requestedTargetId.invalid) {
      return res.status(400).json({ error: "Invalid target id in request body." });
    }

    if (requestedTargetId.provided && requestedTargetId.targetId !== targetId) {
      return res.status(400).json({
        error: `Target mismatch: route id '${targetId}' does not match body target id '${requestedTargetId.targetId}'.`
      });
    }

    if (scopedTargetId.invalid) {
      return res.status(400).json({ error: `Invalid ${targetParamName} in request body.` });
    }

    if (scopedTargetId.provided && scopedTargetId.targetId !== targetId) {
      return res.status(400).json({
        error: `Target mismatch: route id '${targetId}' does not match body ${targetParamName} '${scopedTargetId.targetId}'.`
      });
    }
    if (contextBundleSelection.invalid) {
      return res.status(400).json({ error: contextBundleSelection.message });
    }

    if (!projectName || !isValidProject(projectName)) {
      return res.status(400).json({ error: "A valid project name is required." });
    }

    if (!baseBranch) {
      return res.status(400).json({ error: "A base branch is required." });
    }

    if (runningProjects.has(projectName)) {
      return res.status(409).json({ error: "Project already running" });
    }

    const activeConflict = getActiveAutomationConflictPayload(getActiveAutomation());
    if (activeConflict) {
      return res.status(activeConflict.status).json(activeConflict.payload);
    }

    try {
      const conflictingRun = await findRunningAutomationByScope({
        automationType,
        targetId,
        projectName,
        baseBranch
      });
      if (conflictingRun) {
        return res.status(409).json(buildAutomationConflictResponse(conflictingRun));
      }

      const branchValidationError = await validateBranchExists({
        projectName,
        baseBranch,
        listLocalBranches,
        getRepoPath
      });
      if (branchValidationError) {
        return res.status(branchValidationError.status).json(branchValidationError.payload);
      }

      const features = await getFeaturesTree({ projectName, baseBranch });
      const plan = defineAutomationExecutionPlan(features, {
        automationType,
        targetId
      });

      if (!plan?.queueStatus?.isValid) {
        if (plan?.queueStatus?.code === "target_not_found") {
          return res.status(404).json({
            error: plan.queueStatus.message
          });
        }

        if (plan?.queueStatus?.code === "target_ineligible" || plan?.queueStatus?.code === "empty_queue") {
          return res.status(422).json({
            error: plan.queueStatus.message,
            errorType: "target_ineligible",
            queueStatus: plan.queueStatus
          });
        }

        if (plan?.queueStatus?.code === "validation_failed") {
          return res.status(422).json({
            error: plan.queueStatus.message,
            errorType: "validation_failed",
            queueStatus: plan.queueStatus,
            validationErrors: Array.isArray(plan.validationErrors) ? plan.validationErrors : []
          });
        }

        return res.status(409).json({
          error: plan?.queueStatus?.message || "No runnable stories were found for the selected automation target."
        });
      }

      const queuedStories = Array.isArray(plan.stories) ? plan.stories : [];
      const automationRun = await createAutomationRun({
        automationType,
        targetId,
        projectName,
        baseBranch,
        stopFlag: false,
        stopOnIncomplete: stopOnIncompleteStory,
        automationStatus: "running",
        currentPosition: 1,
        stopReason: null,
        contextBundleId: contextBundleSelection.contextBundleId
      });
      await recordAutomationRunQueueItems({
        automationRunId: automationRun.id,
        stories: queuedStories
      });

      activateAutomationLock({
        runningProjects,
        setActiveAutomation,
        automationRun,
        projectName,
        baseBranch
      });

      launchAutomation({
        runDetached,
        executeAutomationInBackground,
        logger,
        launchMode: "start",
        automationRun,
        projectName,
        baseBranch,
        automationType,
        targetId,
        stopOnIncompleteStory,
        stories: queuedStories,
        totalStoriesInRunQueue: queuedStories.length,
        initialPosition: 1,
        contextBundleId: contextBundleSelection.contextBundleId
      });
      return res.status(202).json(
        toLaunchAcceptedResponse({
          launchMode: "start",
          automationRun,
          queuedStories,
          queueStatus: plan.queueStatus,
          projectName,
          baseBranch
        })
      );
    } catch (error) {
      if (isAutomationTargetConflictError(error)) {
        const conflictingRun = await findRunningAutomationByScope({
          automationType,
          targetId
        });
        return res.status(409).json(
          buildAutomationConflictResponse(
            conflictingRun || buildFallbackAutomationConflict({
              automationType,
              targetId,
              projectName,
              baseBranch
            })
          )
        );
      }

      return res.status(500).json({
        error: getErrorMessage(error)
      });
    }
  }

  router.post("/start/feature/:featureId", (req, res) => {
    startScopedAutomation(req, res, "feature", "featureId");
  });

  router.post("/start/epic/:epicId", (req, res) => {
    startScopedAutomation(req, res, "epic", "epicId");
  });

  router.post("/start/story/:storyId", (req, res) => {
    startScopedAutomation(req, res, "story", "storyId");
  });

  router.post("/resume/:automationRunId", async (req, res) => {
    const automationRunId = parseTargetId(req.params?.automationRunId);
    const contextBundleSelection = parseContextBundleSelection(req.body || {});
    if (!automationRunId) {
      return res.status(400).json({ error: "Invalid automation id." });
    }
    if (contextBundleSelection.invalid) {
      return res.status(400).json({ error: contextBundleSelection.message });
    }

    const activeConflict = getActiveAutomationConflictPayload(getActiveAutomation());
    if (activeConflict) {
      return res.status(activeConflict.status).json(activeConflict.payload);
    }

    let automationRun = null;

    try {
      automationRun = await getAutomationRunById(automationRunId);
      if (!automationRun) {
        return res.status(404).json({ error: "Automation run not found." });
      }

      if (automationRun.automation_status === "running") {
        return res.status(409).json({
          error: "Automation run is already running.",
          automationRun: toStatusApiAutomationRun(automationRun)
        });
      }

      if (automationRun.automation_status === "completed") {
        return res.status(409).json({
          error: "Automation run is already completed.",
          automationRun: toStatusApiAutomationRun(automationRun),
          finalResult: {
            status: automationRun.automation_status,
            stopReason: automationRun.stop_reason ?? null
          }
        });
      }

      const resumableStatuses = new Set(["stopped", "failed"]);
      if (!resumableStatuses.has(automationRun.automation_status)) {
        return res.status(409).json({
          error: `Automation run cannot be resumed from status '${automationRun.automation_status}'.`,
          automationRun: toStatusApiAutomationRun(automationRun),
          resumableStatuses: ["stopped", "failed"]
        });
      }

      if (!automationRun.project_name || !isValidProject(automationRun.project_name)) {
        return res.status(400).json({
          error: "Cannot resume automation because the persisted project is no longer available."
        });
      }

      if (!automationRun.base_branch) {
        return res.status(400).json({
          error: "Cannot resume automation because the persisted base branch is missing."
        });
      }

      const conflictingRun = await findRunningAutomationByScope({
        automationType: automationRun.automation_type,
        targetId: automationRun.target_id,
        projectName: automationRun.project_name,
        baseBranch: automationRun.base_branch,
        excludeAutomationRunId: automationRun.id
      });
      if (conflictingRun) {
        return res.status(409).json(buildAutomationConflictResponse(conflictingRun));
      }

      if (runningProjects.has(automationRun.project_name)) {
        return res.status(409).json({ error: "Project already running" });
      }

      const branchValidationError = await validateBranchExists({
        projectName: automationRun.project_name,
        baseBranch: automationRun.base_branch,
        listLocalBranches,
        getRepoPath
      });
      if (branchValidationError) {
        return res.status(branchValidationError.status).json(branchValidationError.payload);
      }

      const persistedQueueStories = sortQueueStoriesByPosition(
        await getAutomationRunQueueItemsByRunId(automationRun.id)
      );
      if (persistedQueueStories.length <= 0) {
        return res.status(409).json({
          error: "Resume unavailable: persisted automation queue snapshot is missing for this run."
        });
      }

      const storyExecutions = await getAutomationStoryExecutionsByRunId(automationRun.id);
      const remainingStories = getRemainingQueueStories(persistedQueueStories, storyExecutions);

      if (remainingStories.length <= 0) {
        return res.status(409).json({
          error: "Resume unavailable: no remaining queued stories.",
          automationRun: toStatusApiAutomationRun(automationRun),
          queue: {
            totalStories: persistedQueueStories.length,
            remainingStories: 0
          }
        });
      }

      const nextPosition = Number.parseInt(remainingStories[0]?.positionInQueue, 10) || 1;
      const resumeUpdates = {
        stopFlag: false,
        currentPosition: nextPosition,
        automationStatus: "running",
        stopReason: null
      };
      if (contextBundleSelection.provided) {
        resumeUpdates.contextBundleId = contextBundleSelection.contextBundleId;
      }
      const resumedAutomationRun = await updateAutomationRunMetadata(automationRun.id, resumeUpdates);
      const contextBundleIdForResume = contextBundleSelection.provided
        ? contextBundleSelection.contextBundleId
        : (resumedAutomationRun.context_bundle_id ?? null);

      activateAutomationLock({
        runningProjects,
        setActiveAutomation,
        automationRun: resumedAutomationRun,
        projectName: resumedAutomationRun.project_name,
        baseBranch: resumedAutomationRun.base_branch
      });

      launchAutomation({
        runDetached,
        executeAutomationInBackground,
        logger,
        launchMode: "resume",
        automationRun: resumedAutomationRun,
        projectName: resumedAutomationRun.project_name,
        baseBranch: resumedAutomationRun.base_branch,
        automationType: resumedAutomationRun.automation_type,
        targetId: resumedAutomationRun.target_id,
        stories: remainingStories,
        stopOnIncompleteStory: resumedAutomationRun.stop_on_incomplete === 1,
        totalStoriesInRunQueue: persistedQueueStories.length,
        initialPosition: nextPosition,
        contextBundleId: contextBundleIdForResume
      });

      return res.status(202).json(
        toLaunchAcceptedResponse({
          launchMode: "resume",
          automationRun: resumedAutomationRun,
          queuedStories: remainingStories,
          queueExtras: {
            totalStoriesInRunQueue: persistedQueueStories.length,
            skippedCompletedStories: persistedQueueStories.length - remainingStories.length
          },
          projectName: resumedAutomationRun.project_name,
          baseBranch: resumedAutomationRun.base_branch
        })
      );
    } catch (error) {
      if (isAutomationTargetConflictError(error)) {
        const conflictingRun = await findRunningAutomationByScope({
          automationType: automationRun?.automation_type,
          targetId: automationRun?.target_id,
          excludeAutomationRunId: automationRun?.id
        });
        return res.status(409).json(
          buildAutomationConflictResponse(
            conflictingRun || buildFallbackAutomationConflict({
              automationType: automationRun?.automation_type,
              targetId: automationRun?.target_id,
              projectName: automationRun?.project_name,
              baseBranch: automationRun?.base_branch
            })
          )
        );
      }

      return res.status(500).json({
        error: getErrorMessage(error)
      });
    }
  });

  router.get("/status/:automationRunId", async (req, res) => {
    const automationRunId = parseTargetId(req.params?.automationRunId);
    if (!automationRunId) {
      return res.status(400).json({ error: "Invalid automation id." });
    }

    try {
      const automationRun = await getAutomationRunById(automationRunId);
      if (!automationRun) {
        return res.status(404).json({ error: "Automation run not found." });
      }

      const [queueStories, storyExecutions] = await Promise.all([
        getAutomationRunQueueItemsByRunId(automationRun.id),
        getAutomationStoryExecutionsByRunId(automationRun.id)
      ]);
      const orderedPersistedQueueStories = sortQueueStoriesByPosition(queueStories);
      const hasPersistedQueue = orderedPersistedQueueStories.length > 0;
      const effectiveQueueStories = hasPersistedQueue
        ? orderedPersistedQueueStories
        : sortQueueStoriesByPosition(
          await getAutomationQueueStoriesByTarget(automationRun.automation_type, automationRun.target_id)
        );
      const queueStoriesByStoryId = new Map(
        effectiveQueueStories
          .filter((story) => Number.isInteger(Number.parseInt(story?.storyId, 10)))
          .map((story) => [Number.parseInt(story.storyId, 10), story])
      );

      const latestExecutions = [...getLatestExecutionsByPosition(storyExecutions).values()];
      const completedExecutions = latestExecutions.filter((execution) => execution.execution_status === "completed");
      const failedExecutions = latestExecutions.filter((execution) => execution.execution_status === "failed");
      const stoppedExecutions = latestExecutions.filter((execution) => execution.queue_action === "stopped");
      const processedStories = latestExecutions.length;
      const totalStories = effectiveQueueStories.length;
      const remainingQueueStories = getRemainingQueueStories(effectiveQueueStories, storyExecutions);
      const currentStory = automationRun.automation_status === "running"
        ? (effectiveQueueStories[automationRun.current_position - 1] || null)
        : null;
      const runtimeState = activeStoryRuntimeByAutomationRunId.get(automationRun.id) || null;
      const normalizedCurrentStoryId = Number.parseInt(currentStory?.storyId, 10);
      const normalizedRuntimeStoryId = Number.parseInt(runtimeState?.storyId, 10);
      const normalizedFailedStoryId = Number.parseInt(automationRun?.failed_story_id, 10);
      const failedStoryContext = Number.isInteger(normalizedFailedStoryId)
        ? queueStoriesByStoryId.get(normalizedFailedStoryId)
        : null;
      const currentItem = currentStory
        ? {
          ...currentStory,
          startedAt: Number.isInteger(normalizedCurrentStoryId)
            && Number.isInteger(normalizedRuntimeStoryId)
            && normalizedCurrentStoryId === normalizedRuntimeStoryId
            ? (runtimeState?.startedAt || null)
            : null,
          runningCodexCommand: Number.isInteger(normalizedCurrentStoryId)
            && Number.isInteger(normalizedRuntimeStoryId)
            && normalizedCurrentStoryId === normalizedRuntimeStoryId
            ? (runtimeState?.runningCodexCommand || "")
            : ""
        }
        : null;

      return res.json({
        automationRun: toStatusApiAutomationRun(automationRun),
        queue: {
          totalStories,
          processedStories,
          remainingStories: remainingQueueStories.length,
          currentPosition: automationRun.current_position,
          currentItem
        },
        summary: {
          completedCount: completedExecutions.length,
          failedCount: failedExecutions.length,
          stoppedCount: stoppedExecutions.length
        },
        completedSteps: completedExecutions.map((execution) => {
          const storyId = Number.parseInt(execution?.story_id, 10);
          const queueContext = Number.isInteger(storyId) ? queueStoriesByStoryId.get(storyId) : null;
          return toStatusApiExecutionSummary(execution, queueContext);
        }),
        failedSteps: failedExecutions.map((execution) => {
          const storyId = Number.parseInt(execution?.story_id, 10);
          const queueContext = Number.isInteger(storyId) ? queueStoriesByStoryId.get(storyId) : null;
          return toStatusApiExecutionSummary(execution, queueContext);
        }),
        finalResult: automationRun.automation_status === "running"
          ? null
          : {
            status: automationRun.automation_status,
            stopReason: automationRun.stop_reason ?? null,
            failedStoryId: automationRun.failed_story_id ?? null,
            failedStoryTitle: failedStoryContext?.storyTitle ?? null,
            failureSummary: automationRun.failure_summary ?? null
          }
      });
    } catch (error) {
      return res.status(500).json({
        error: getErrorMessage(error)
      });
    }
  });

  router.post("/stop/:automationRunId", async (req, res) => {
    const automationRunId = parseTargetId(req.params?.automationRunId);
    if (!automationRunId) {
      return res.status(400).json({ error: "Invalid automation id." });
    }

    try {
      const automationRun = await getAutomationRunById(automationRunId);
      if (!automationRun) {
        return res.status(404).json({ error: "Automation run not found." });
      }

      if (automationRun.automation_status !== "running") {
        return res.status(409).json({
          error: "Automation run is not running.",
          automationRun: toStatusApiAutomationRun(automationRun),
          finalResult: {
            status: automationRun.automation_status,
            stopReason: automationRun.stop_reason ?? null
          }
        });
      }

      const updatedAutomationRun = await updateAutomationRunMetadata(automationRunId, {
        stopFlag: true,
        automationStatus: "stopped",
        stopReason: "manual_stop"
      });

      return res.json({
        automationRun: toStatusApiAutomationRun(updatedAutomationRun),
        finalResult: {
          status: updatedAutomationRun.automation_status,
          stopReason: updatedAutomationRun.stop_reason ?? null
        },
        message: "Stop requested. Automation will not continue to the next queued story."
      });
    } catch (error) {
      return res.status(500).json({
        error: getErrorMessage(error)
      });
    }
  });

  return router;
}

module.exports = {
  createAutomationStartRouter
};
