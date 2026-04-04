const express = require("express");

const { defineAutomationExecutionPlan } = require("./automationQueue");
const { runSequentialStoryQueue } = require("./automationRunner");
const { buildStoryAutomationPrompt } = require("./storyAutomationPrompt");

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function normalizeCompletionStatus(status) {
  if (status === "complete" || status === "incomplete") {
    return status;
  }
  return "unknown";
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

function parseTargetId(targetIdRaw) {
  const targetId = Number.parseInt(targetIdRaw, 10);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return null;
  }
  return targetId;
}

function toStatusApiAutomationRun(automationRun) {
  return {
    id: automationRun.id,
    automationType: automationRun.automation_type,
    targetId: automationRun.target_id,
    stopOnIncomplete: automationRun.stop_on_incomplete === 1,
    stopFlag: automationRun.stop_flag === 1,
    currentPosition: automationRun.current_position,
    status: automationRun.automation_status,
    stopReason: automationRun.stop_reason,
    createdAt: automationRun.created_at,
    updatedAt: automationRun.updated_at
  };
}

function toStatusApiExecutionSummary(execution = {}) {
  return {
    id: execution.id ?? null,
    storyId: execution.story_id ?? null,
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

function resolveFinalCurrentPosition(runnerResult, stories, finalState) {
  const totalStories = Array.isArray(stories) ? stories.length : 0;
  const processedStories = Number.isInteger(runnerResult?.processedStories)
    ? runnerResult.processedStories
    : 0;

  if (totalStories <= 0) {
    return 1;
  }

  if (finalState.automationStatus === "completed") {
    return totalStories;
  }

  if (finalState.stopReason === "manual_stop") {
    return Math.min(totalStories, Math.max(1, processedStories + 1));
  }

  if (finalState.automationStatus === "failed") {
    return Math.min(totalStories, Math.max(1, processedStories));
  }

  return Math.min(totalStories, Math.max(1, processedStories));
}

function createAutomationStartRouter(deps = {}) {
  const {
    isValidProject,
    listLocalBranches,
    getRepoPath,
    getFeaturesTree,
    createAutomationRun,
    updateAutomationRunMetadata,
    recordAutomationStoryExecution,
    getStoryAutomationContext,
    attachRunToStory,
    executeRunFlow,
    getAutomationRunById,
    getAutomationStoryExecutionsByRunId,
    getAutomationQueueStoriesByTarget,
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
  if (typeof updateAutomationRunMetadata !== "function") throw new Error("updateAutomationRunMetadata dependency is required.");
  if (typeof recordAutomationStoryExecution !== "function") throw new Error("recordAutomationStoryExecution dependency is required.");
  if (typeof getStoryAutomationContext !== "function") throw new Error("getStoryAutomationContext dependency is required.");
  if (typeof attachRunToStory !== "function") throw new Error("attachRunToStory dependency is required.");
  if (typeof executeRunFlow !== "function") throw new Error("executeRunFlow dependency is required.");
  if (typeof getAutomationRunById !== "function") throw new Error("getAutomationRunById dependency is required.");
  if (typeof getAutomationStoryExecutionsByRunId !== "function") throw new Error("getAutomationStoryExecutionsByRunId dependency is required.");
  if (typeof getAutomationQueueStoriesByTarget !== "function") throw new Error("getAutomationQueueStoriesByTarget dependency is required.");
  if (typeof getErrorMessage !== "function") throw new Error("getErrorMessage dependency is required.");
  if (!runningProjects || typeof runningProjects.has !== "function") throw new Error("runningProjects dependency is required.");
  if (typeof getActiveAutomation !== "function") throw new Error("getActiveAutomation dependency is required.");
  if (typeof setActiveAutomation !== "function") throw new Error("setActiveAutomation dependency is required.");

  const router = express.Router();

  async function executeAutomationInBackground({
    automationRun,
    projectName,
    baseBranch,
    automationType,
    targetId,
    stories,
    stopOnIncompleteStory
  }) {
    try {
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
          const storyId = Number.parseInt(storyQueueItem?.storyId, 10);
          if (!Number.isInteger(storyId) || storyId <= 0) {
            throw new Error("Invalid story id in automation queue.");
          }

          const storyContext = await getStoryAutomationContext(storyId, { projectName, baseBranch });
          if (!storyContext) {
            throw new Error(`Story #${storyId} was not found in project scope '${projectName}:${baseBranch}'.`);
          }

          const prompt = buildStoryAutomationPrompt(storyContext);
          const { runId, responsePayload } = await executeRunFlow({
            projectName,
            prompt,
            executionMode: "write",
            baseBranch
          });

          await attachRunToStory(storyId, runId);

          return {
            runId,
            completionStatus: responsePayload?.completion_status,
            completionWork: responsePayload?.completion_work ?? null
          };
        },
        onProgress: async (snapshot) => {
          try {
            const totalStories = Number.isInteger(snapshot?.totalStories) ? snapshot.totalStories : stories.length;
            const processedStories = Number.isInteger(snapshot?.processedStories) ? snapshot.processedStories : 0;
            const nextPosition = totalStories > 0
              ? Math.min(totalStories, Math.max(1, processedStories + 1))
              : 1;

            await updateAutomationRunMetadata(automationRun.id, {
              currentPosition: nextPosition
            });
          } catch (error) {
            logger.error("automation progress update failed:", error);
          }
        },
        onStoryResult: async (storyResult) => {
          try {
            await recordAutomationStoryExecution({
              automationRunId: automationRun.id,
              storyId: storyResult.storyId,
              positionInQueue: storyResult.positionInQueue,
              executionStatus: storyResult.status === "failed" ? "failed" : "completed",
              queueAction: storyResult.queueAction,
              runId: storyResult.runId ?? null,
              completionStatus: normalizeCompletionStatus(storyResult.completionStatus),
              completionWork: storyResult.completionWork ?? null,
              error: storyResult.error ?? null
            });
          } catch (error) {
            logger.error("automation story execution persistence failed:", error);
          }
        }
      });

      const finalState = mapFinalAutomationState(runnerResult);
      await updateAutomationRunMetadata(automationRun.id, {
        stopFlag: finalState.stopFlag,
        currentPosition: resolveFinalCurrentPosition(runnerResult, stories, finalState),
        automationStatus: finalState.automationStatus,
        stopReason: finalState.stopReason
      });
    } catch (error) {
      try {
        await updateAutomationRunMetadata(automationRun.id, {
          stopFlag: true,
          automationStatus: "failed",
          stopReason: "execution_failed"
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
    } finally {
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

    if (!targetId) {
      return res.status(400).json({ error: `Invalid ${automationType} id.` });
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

    const active = getActiveAutomation();
    if (active) {
      return res.status(423).json({
        error: `Automation is already running for ${active.projectName} (${active.baseBranch}).`
      });
    }

    try {
      const branchResult = await listLocalBranches(getRepoPath(projectName));
      if (!branchResult.branches.includes(baseBranch)) {
        return res.status(400).json({ error: `Invalid base branch '${baseBranch}' for project '${projectName}'.` });
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

        return res.status(409).json({
          error: plan?.queueStatus?.message || "No runnable stories were found for the selected automation target."
        });
      }

      const queuedStories = Array.isArray(plan.stories) ? plan.stories : [];
      const automationRun = await createAutomationRun({
        automationType,
        targetId,
        stopFlag: false,
        stopOnIncomplete: stopOnIncompleteStory,
        automationStatus: "running",
        currentPosition: 1,
        stopReason: null
      });

      runningProjects.add(projectName);
      setActiveAutomation({
        automationRunId: automationRun.id,
        automationType,
        targetId,
        projectName,
        baseBranch,
        storyId: automationType === "story" ? targetId : null,
        startedAt: new Date().toISOString()
      });

      runDetached(() => executeAutomationInBackground({
        automationRun,
        projectName,
        baseBranch,
        automationType,
        targetId,
        stories: queuedStories,
        stopOnIncompleteStory
      }), logger);

      return res.status(202).json({
        automationRun: {
          id: automationRun.id,
          automationType: automationRun.automation_type,
          targetId: automationRun.target_id,
          stopOnIncomplete: automationRun.stop_on_incomplete === 1,
          stopFlag: automationRun.stop_flag === 1,
          currentPosition: automationRun.current_position,
          status: automationRun.automation_status,
          stopReason: automationRun.stop_reason,
          createdAt: automationRun.created_at,
          updatedAt: automationRun.updated_at
        },
        queue: {
          totalStories: queuedStories.length,
          storyIds: queuedStories.map((story) => story.storyId),
          queueStatus: plan.queueStatus
        },
        projectName,
        baseBranch
      });
    } catch (error) {
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
        getAutomationQueueStoriesByTarget(automationRun.automation_type, automationRun.target_id),
        getAutomationStoryExecutionsByRunId(automationRun.id)
      ]);

      const completedExecutions = storyExecutions.filter((execution) => execution.execution_status === "completed");
      const failedExecutions = storyExecutions.filter((execution) => execution.execution_status === "failed");
      const stoppedExecutions = storyExecutions.filter((execution) => execution.queue_action === "stopped");
      const processedStories = storyExecutions.length;
      const totalStories = queueStories.length;
      const currentStory = automationRun.automation_status === "running"
        ? (queueStories[automationRun.current_position - 1] || null)
        : null;

      return res.json({
        automationRun: toStatusApiAutomationRun(automationRun),
        queue: {
          totalStories,
          processedStories,
          remainingStories: Math.max(0, totalStories - processedStories),
          currentPosition: automationRun.current_position,
          currentItem: currentStory
        },
        summary: {
          completedCount: completedExecutions.length,
          failedCount: failedExecutions.length,
          stoppedCount: stoppedExecutions.length
        },
        completedSteps: completedExecutions.map((execution) => toStatusApiExecutionSummary(execution)),
        failedSteps: failedExecutions.map((execution) => toStatusApiExecutionSummary(execution)),
        finalResult: automationRun.automation_status === "running"
          ? null
          : {
            status: automationRun.automation_status,
            stopReason: automationRun.stop_reason ?? null
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
