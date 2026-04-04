const {
  AUTOMATION_STOP_REASON,
  evaluateAutomationStopCondition,
  normalizeCompletionStatus
} = require("./automationQueue");

function normalizeStories(stories) {
  if (!Array.isArray(stories)) {
    throw new TypeError("stories must be an array");
  }

  return stories.map((story, index) => ({
    ...story,
    positionInQueue: Number.isInteger(story?.positionInQueue) && story.positionInQueue > 0
      ? story.positionInQueue
      : index + 1
  }));
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

async function runSequentialStoryQueue(input = {}) {
  const stories = normalizeStories(input.stories);
  const executeStory = input.executeStory;
  const stopOnIncompleteStory = Boolean(input.stopOnIncompleteStory);
  const onProgress = input.onProgress;
  const onStoryResult = input.onStoryResult;

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

  for (const story of stories) {
    try {
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
      if (typeof onStoryResult === "function") {
        await onStoryResult(storyResult, result);
      }
    } catch (error) {
      const failureMessage = error?.message ? String(error.message) : String(error);
      const storyResult = {
        storyId: story.storyId ?? null,
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

      const stopEvaluation = evaluateAutomationStopCondition({ type: "execution_failed" });
      result.status = stopEvaluation.shouldStop ? "failed" : "running";
      result.stopReason = stopEvaluation.reason;
      if (typeof onStoryResult === "function") {
        await onStoryResult(storyResult, result);
      }
      return result;
    }
  }

  const queueCompleteEvaluation = evaluateAutomationStopCondition({ type: "queue_complete" });
  result.status = "completed";
  result.stopReason = queueCompleteEvaluation.reason;
  return result;
}

module.exports = {
  runSequentialStoryQueue
};
