const {
  AUTOMATION_STOP_REASON,
  evaluateAutomationStopCondition,
  normalizeCompletionStatus
} = require("./automationQueue");
const { sortByPosition, toPositiveInteger } = require("./automationQueuePosition");

const DEFAULT_MAX_RUN_DURATION_MS = 600 * 60 * 1000;
const DEFAULT_STORY_SOFT_TIMEOUT_MS = 16 * 60 * 1000;
const DEFAULT_STORY_HARD_TIMEOUT_MS = 20 * 60 * 1000;

function normalizeStories(stories) {
  if (!Array.isArray(stories)) {
    throw new TypeError("stories must be an array");
  }

  const storiesWithPosition = stories.map((story, index) => {
    const normalizedPosition = toPositiveInteger(story?.positionInQueue) ?? index + 1;
    return {
      ...story,
      positionInQueue: normalizedPosition
    };
  });

  return sortByPosition(storiesWithPosition, (story) => story?.positionInQueue);
}

function getStoryCompletionStatus(executionResult = {}) {
  return normalizeCompletionStatus({
    completion_status: executionResult.completionStatus
      ?? executionResult.completion_status
      ?? executionResult?.run?.completion_status,
    COMPLETION_STATUS: executionResult.COMPLETION_STATUS,
    run_completion_status: executionResult.run_completion_status,
    is_complete: executionResult.isComplete
  });
}

function getStoryCompletionWork(executionResult = {}) {
  return executionResult?.completionWork
    ?? executionResult?.completion_work
    ?? executionResult?.run?.completion_work
    ?? null;
}

function summarizeExecutionFailure(error) {
  if (!error) {
    return "Unknown error";
  }

  const message = typeof error?.message === "string" && error.message.trim()
    ? error.message.trim()
    : String(error);
  const causeMessage = typeof error?.cause?.message === "string" && error.cause.message.trim()
    ? error.cause.message.trim()
    : "";

  if (!causeMessage || causeMessage === message) {
    return message;
  }

  return `${message} (cause: ${causeMessage})`;
}

function createProgressSnapshot({
  totalStories,
  processedStories,
  currentStory,
  lastResult
}) {
  return {
    totalStories,
    processedStories,
    remainingStories: Math.max(0, totalStories - processedStories),
    currentPosition: processedStories + 1,
    lastProcessedStoryId: currentStory?.storyId ?? null,
    lastResult: lastResult ?? null
  };
}

async function notifyProgress(onProgress, snapshot) {
  if (typeof onProgress === "function") {
    await onProgress(snapshot);
  }
}

async function evaluateManualStop(shouldStop) {
  if (typeof shouldStop !== "function") {
    return null;
  }

  const stopRequested = await shouldStop();
  if (!stopRequested) {
    return null;
  }

  const stopEvaluation = evaluateAutomationStopCondition({ type: "manual_stop" });
  if (!stopEvaluation.shouldStop) {
    return null;
  }

  return stopEvaluation;
}

async function runSequentialStoryQueue(input = {}) {
  const stories = normalizeStories(input.stories);
  const executeStory = input.executeStory;
  const stopOnIncompleteStory = Boolean(input.stopOnIncompleteStory);
  const onProgress = input.onProgress;
  const onStoryStart = input.onStoryStart;
  const onStoryResult = input.onStoryResult;
  const onStoryTimeout = input.onStoryTimeout;
  const onStoryAbortRequested = input.onStoryAbortRequested;
  const shouldStop = input.shouldStop;
  const now = typeof input.now === "function" ? input.now : () => Date.now();
  const maxRunDurationMs = Number.isFinite(input.maxRunDurationMs) && input.maxRunDurationMs >= 0
    ? input.maxRunDurationMs
    : DEFAULT_MAX_RUN_DURATION_MS;
  const storySoftTimeoutMs = Number.isFinite(input.storySoftTimeoutMs) && input.storySoftTimeoutMs >= 0
    ? input.storySoftTimeoutMs
    : DEFAULT_STORY_SOFT_TIMEOUT_MS;
  const storyHardTimeoutMs = Number.isFinite(input.storyHardTimeoutMs) && input.storyHardTimeoutMs >= 0
    ? input.storyHardTimeoutMs
    : DEFAULT_STORY_HARD_TIMEOUT_MS;

  if (typeof executeStory !== "function") {
    throw new TypeError("executeStory must be a function");
  }

  const result = {
    status: "running",
    stopReason: null,
    totalStories: stories.length,
    processedStories: 0,
    storyResults: []
  };

  if (stories.length === 0) {
    result.status = "completed";
    result.stopReason = AUTOMATION_STOP_REASON.ALL_WORK_COMPLETE;
    return result;
  }

  const queueStartedAt = now();
  let queueTimeLimitReached = false;
  let queueTimeoutHandle = null;

  if (maxRunDurationMs > 0) {
    queueTimeoutHandle = setTimeout(() => {
      queueTimeLimitReached = true;
    }, maxRunDurationMs);
  }

  try {
    for (const story of stories) {
      const elapsedRunMs = now() - queueStartedAt;
      if (queueTimeLimitReached || (maxRunDurationMs > 0 && elapsedRunMs >= maxRunDurationMs)) {
        result.status = "stopped";
        result.stopReason = "run_time_limit_reached";
        return result;
      }

      const stopBeforeStory = await evaluateManualStop(shouldStop);
      if (stopBeforeStory) {
        result.status = "stopped";
        result.stopReason = stopBeforeStory.reason;
        return result;
      }

      let storySoftLimitReached = false;
      let storyHardLimitReached = false;
      let storySoftTimeoutHandle = null;
      let storyHardTimeoutHandle = null;
      let hardAbortRequestIssued = false;
      const storyStartedAt = now();
      const timeoutReason = () => (
        queueTimeLimitReached || (maxRunDurationMs > 0 && (now() - queueStartedAt) >= maxRunDurationMs)
          ? "run_time_limit_reached"
          : (storySoftLimitReached || storyHardLimitReached ? "story_time_limit_reached" : null)
      );

      try {
        if (storySoftTimeoutMs > 0) {
          storySoftTimeoutHandle = setTimeout(() => {
            storySoftLimitReached = true;
            if (typeof onStoryTimeout === "function") {
              void Promise.resolve(onStoryTimeout({
                storyId: story.storyId ?? null,
                positionInQueue: story.positionInQueue,
                phase: "soft_limit_reached",
                elapsedMs: now() - storyStartedAt,
                softTimeoutMs: storySoftTimeoutMs,
                hardTimeoutMs: storyHardTimeoutMs
              }));
            }
          }, storySoftTimeoutMs);
        }

        if (storyHardTimeoutMs > 0) {
          storyHardTimeoutHandle = setTimeout(() => {
            storyHardLimitReached = true;
            if (typeof onStoryTimeout === "function") {
              void Promise.resolve(onStoryTimeout({
                storyId: story.storyId ?? null,
                positionInQueue: story.positionInQueue,
                phase: "hard_limit_reached",
                elapsedMs: now() - storyStartedAt,
                softTimeoutMs: storySoftTimeoutMs,
                hardTimeoutMs: storyHardTimeoutMs
              }));
            }
            if (typeof onStoryAbortRequested === "function" && !hardAbortRequestIssued) {
              hardAbortRequestIssued = true;
              void Promise.resolve(onStoryAbortRequested({
                storyId: story.storyId ?? null,
                positionInQueue: story.positionInQueue,
                elapsedMs: now() - storyStartedAt,
                timeoutMs: storyHardTimeoutMs
              }));
            }
          }, storyHardTimeoutMs);
        }

        if (typeof onStoryStart === "function") {
          await onStoryStart({
            storyId: story.storyId ?? null,
            storyTitle: typeof story?.storyTitle === "string" && story.storyTitle.trim()
              ? story.storyTitle.trim()
              : null,
            positionInQueue: story.positionInQueue,
            totalStories: result.totalStories
          });
        }

        const executionResult = await executeStory(story);
        const completionStatus = getStoryCompletionStatus(executionResult);
        const storyResult = {
          storyId: story.storyId ?? null,
          positionInQueue: story.positionInQueue,
          status: "completed",
          completionStatus,
          completionWork: getStoryCompletionWork(executionResult),
          queueAction: "advanced",
          runId: executionResult?.runId ?? executionResult?.run?.runId ?? null
        };

        result.storyResults.push(storyResult);
        result.processedStories += 1;

        await notifyProgress(
          onProgress,
          createProgressSnapshot({
            totalStories: result.totalStories,
            processedStories: result.processedStories,
            currentStory: story,
            lastResult: storyResult
          })
        );

        const timeoutStopReason = timeoutReason();
        if (timeoutStopReason) {
          storyResult.queueAction = "stopped";
          result.status = "stopped";
          result.stopReason = timeoutStopReason;
          if (typeof onStoryResult === "function") {
            await onStoryResult(storyResult, result);
          }
          return result;
        }

        const stopEvaluation = evaluateAutomationStopCondition(
          { type: "story_completed", completionStatus },
          {
            stopConditions: {
              stopOnIncompleteStory
            }
          }
        );

        if (stopEvaluation.shouldStop) {
          storyResult.queueAction = "stopped";
          result.status = "stopped";
          result.stopReason = stopEvaluation.reason;
          if (typeof onStoryResult === "function") {
            await onStoryResult(storyResult, result);
          }
          return result;
        }

        const stopAfterStory = await evaluateManualStop(shouldStop);
        if (stopAfterStory) {
          storyResult.queueAction = "stopped";
          result.status = "stopped";
          result.stopReason = stopAfterStory.reason;
          if (typeof onStoryResult === "function") {
            await onStoryResult(storyResult, result);
          }
          return result;
        }

        if (typeof onStoryResult === "function") {
          await onStoryResult(storyResult, result);
        }
      } catch (error) {
        const failureMessage = summarizeExecutionFailure(error);
        const normalizedErrorCode = String(error?.code || "").trim().toLowerCase();
        const storyResult = {
          storyId: story.storyId ?? null,
          storyTitle: typeof story?.storyTitle === "string" && story.storyTitle.trim()
            ? story.storyTitle.trim()
            : null,
          positionInQueue: story.positionInQueue,
          status: "failed",
          completionStatus: "unknown",
          completionWork: null,
          queueAction: "failed",
          error: failureMessage
        };

        result.storyResults.push(storyResult);
        result.processedStories += 1;

        await notifyProgress(
          onProgress,
          createProgressSnapshot({
            totalStories: result.totalStories,
            processedStories: result.processedStories,
            currentStory: story,
            lastResult: storyResult
          })
        );

        const timeoutStopReason = timeoutReason();
        if (timeoutStopReason) {
          storyResult.queueAction = "stopped";
          result.status = "stopped";
          result.stopReason = timeoutStopReason;
          if (typeof onStoryResult === "function") {
            await onStoryResult(storyResult, result);
          }
          return result;
        }

        const stopEvaluation = evaluateAutomationStopCondition({ type: "execution_failed" });
        result.status = stopEvaluation.shouldStop ? "failed" : "running";
        result.stopReason = normalizedErrorCode === "merge_failed"
          ? "merge_failed"
          : stopEvaluation.reason;
        if (typeof onStoryResult === "function") {
          await onStoryResult(storyResult, result);
        }
        return result;
      } finally {
        if (storySoftTimeoutHandle) {
          clearTimeout(storySoftTimeoutHandle);
        }
        if (storyHardTimeoutHandle) {
          clearTimeout(storyHardTimeoutHandle);
        }
      }
    }

    const queueCompleteEvaluation = evaluateAutomationStopCondition({ type: "queue_complete" });
    result.status = "completed";
    result.stopReason = queueCompleteEvaluation.reason;
    return result;
  } finally {
    if (queueTimeoutHandle) {
      clearTimeout(queueTimeoutHandle);
    }
  }
}

module.exports = {
  runSequentialStoryQueue
};
