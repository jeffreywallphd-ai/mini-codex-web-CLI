require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const { runCodexWithUsage, EXECUTION_MODE_OPTIONS } = require("./codexRunner");
const {
  saveRun,
  getRuns,
  getRunById,
  updateRunMerge,
  createFeatureTree,
  getFeaturesTree,
  getStoryAutomationContext,
  attachRunToStory,
  syncStoryCompletionFromRun,
  createAutomationRun,
  updateAutomationRunMetadata,
  recordAutomationStoryExecution,
  getCompletionEligibleRuns,
  setRunArchived,
  deleteRunById,
  dbReady
} = require("./db");
const { buildStoryAutomationPrompt } = require("./storyAutomationPrompt");
const { createCodexBranch, getGitSnapshot, listLocalBranches, mergeBranch, pullRepository } = require("./git");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, "../web")));

const PORT = process.env.PORT || 3000;
const PROJECTS_DIR = path.resolve(__dirname, process.env.PROJECTS_DIR);

const runningProjects = new Set();
const runEventStreams = new Map();
let activeFeatureAutomation = null;

function getRunStreamConnections(streamId) {
  if (!streamId) return null;
  let connections = runEventStreams.get(streamId);
  if (!connections) {
    connections = new Set();
    runEventStreams.set(streamId, connections);
  }
  return connections;
}

function publishRunEvent(streamId, event) {
  if (!streamId) return;
  const connections = runEventStreams.get(streamId);
  if (!connections || connections.size === 0) return;

  const payload = JSON.stringify({
    ...event,
    at: new Date().toISOString()
  });

  for (const connection of connections) {
    connection.write(`data: ${payload}\n\n`);
  }
}

function closeRunStream(streamId) {
  if (!streamId) return;
  const connections = runEventStreams.get(streamId);
  if (!connections) return;

  for (const connection of connections) {
    connection.end();
  }

  runEventStreams.delete(streamId);
}

function getErrorMessage(error) {
  if (!error) return "Unknown error";

  if (typeof error.message === "string" && error.message.trim()) {
    if (error.cause?.message && error.cause.message !== error.message) {
      return `${error.message} (cause: ${error.cause.message})`;
    }
    return error.message;
  }

  return String(error);
}

function getFeatureAutomationLock() {
  if (!activeFeatureAutomation) {
    return {
      isActive: false,
      source: null
    };
  }

  return {
    isActive: true,
    source: "feature_automation",
    projectName: activeFeatureAutomation.projectName,
    baseBranch: activeFeatureAutomation.baseBranch,
    storyId: activeFeatureAutomation.storyId,
    startedAt: activeFeatureAutomation.startedAt
  };
}

function normalizeCompletionStatus(status) {
  if (status === "complete" || status === "incomplete") {
    return status;
  }
  return "unknown";
}

function isValidProject(name) {
  const fullPath = path.join(PROJECTS_DIR, name);
  return fs.existsSync(fullPath);
}

function getRepoPath(projectName) {
  return path.join(PROJECTS_DIR, projectName);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value ?? JSON.stringify(fallback));
  } catch (error) {
    return fallback;
  }
}

function getNormalizedTitle(node) {
  if (!node || typeof node !== "object") return "";

  const title = typeof node.title === "string" ? node.title.trim() : "";
  if (title) return title;

  const name = typeof node.name === "string" ? node.name.trim() : "";
  if (name) return name;

  return "";
}

function getNormalizedDescription(node) {
  if (!node || typeof node !== "object") return "";

  if (typeof node.description === "string") {
    return node.description.trim();
  }

  return "";
}

function normalizeStoryDraft(storyNode, index) {
  if (typeof storyNode === "string") {
    const storyName = storyNode.trim();
    if (!storyName) {
      throw new Error(`Story #${index + 1} is missing a title.`);
    }
    return { name: storyName, description: "" };
  }

  if (!storyNode || typeof storyNode !== "object" || Array.isArray(storyNode)) {
    throw new Error(`Story #${index + 1} must be an object with title/description.`);
  }

  const storyName = getNormalizedTitle(storyNode);
  if (storyName) {
    return {
      name: storyName,
      description: getNormalizedDescription(storyNode)
    };
  }

  const entries = Object.entries(storyNode);
  if (entries.length === 1) {
    const [entryTitle, entryDescription] = entries[0];
    const normalizedTitle = String(entryTitle || "").trim();
    if (!normalizedTitle) {
      throw new Error(`Story #${index + 1} is missing a title.`);
    }

    return {
      name: normalizedTitle,
      description: typeof entryDescription === "string" ? entryDescription.trim() : ""
    };
  }

  throw new Error(`Story #${index + 1} is missing title/description fields.`);
}

function normalizeManifestToFeatureDrafts(manifest) {
  const root = manifest && typeof manifest === "object" ? manifest : null;
  const featuresRaw = Array.isArray(root?.features)
    ? root.features
    : (Array.isArray(manifest) ? manifest : null);

  if (!featuresRaw || featuresRaw.length === 0) {
    throw new Error("Manifest must include a non-empty 'features' array.");
  }

  return featuresRaw.map((featureNode, featureIndex) => {
    if (!featureNode || typeof featureNode !== "object" || Array.isArray(featureNode)) {
      throw new Error(`Feature #${featureIndex + 1} must be an object.`);
    }

    const featureName = getNormalizedTitle(featureNode);
    if (!featureName) {
      throw new Error(`Feature #${featureIndex + 1} is missing a title.`);
    }

    const epicsRaw = Array.isArray(featureNode.epics) ? featureNode.epics : [];
    const epics = epicsRaw.map((epicNode, epicIndex) => {
      if (!epicNode || typeof epicNode !== "object" || Array.isArray(epicNode)) {
        throw new Error(`Feature #${featureIndex + 1}, epic #${epicIndex + 1} must be an object.`);
      }

      const epicName = getNormalizedTitle(epicNode);
      if (!epicName) {
        throw new Error(`Feature #${featureIndex + 1}, epic #${epicIndex + 1} is missing a title.`);
      }

      const storiesRaw = Array.isArray(epicNode.stories) ? epicNode.stories : [];
      const stories = storiesRaw.map((storyNode, storyIndex) => normalizeStoryDraft(
        storyNode,
        storyIndex
      ));

      return {
        name: epicName,
        description: getNormalizedDescription(epicNode),
        stories
      };
    });

    return {
      name: featureName,
      description: getNormalizedDescription(featureNode),
      epics
    };
  });
}

function hydrateRun(run) {
  if (!run) return run;

  const startTime = Number(run.run_start_time);
  const endTime = Number(run.run_end_time);
  const hasStart = Number.isFinite(startTime);
  const hasEnd = Number.isFinite(endTime);
  const durationMs = hasStart && hasEnd && endTime >= startTime
    ? endTime - startTime
    : null;

  return {
    ...run,
    run_start_time: hasStart ? startTime : null,
    run_end_time: hasEnd ? endTime : null,
    git_status_files: parseJson(run.git_status_files, []),
    git_diff_map: parseJson(run.git_diff_map, {}),
    duration_ms: durationMs
  };
}

async function executeRunFlow({
  projectName,
  prompt,
  executionMode = "read",
  baseBranch = "main",
  streamId = null
}) {
  const repoPath = getRepoPath(projectName);
  const runStartTime = Date.now();

  publishRunEvent(streamId, { type: "branch.creating", message: "Creating branch from base..." });
  const branchInfo = await createCodexBranch(repoPath, baseBranch);
  publishRunEvent(streamId, { type: "branch.created", message: `Branch created: ${branchInfo.branchName || "unknown"}.` });

  const result = await runCodexWithUsage(repoPath, prompt, executionMode, (event) => {
    publishRunEvent(streamId, event);
  });

  publishRunEvent(streamId, { type: "snapshot.collecting", message: "Collecting git snapshot..." });
  const gitSnapshot = await getGitSnapshot(repoPath);
  publishRunEvent(streamId, { type: "run.persisting", message: "Saving run record..." });
  const runEndTime = Date.now();

  const runId = await saveRun({
    projectName,
    prompt,
    ...branchInfo,
    ...result,
    runStartTime,
    runEndTime,
    gitStatus: gitSnapshot.gitStatus,
    gitStatusFiles: gitSnapshot.files,
    gitDiffMap: gitSnapshot.diffs
  });

  publishRunEvent(streamId, { type: "run.completed", message: `Run completed and saved (#${runId}).` });

  const responsePayload = hydrateRun({
    runId,
    projectName,
    prompt,
    ...branchInfo,
    ...result,
    run_start_time: runStartTime,
    run_end_time: runEndTime,
    gitStatus: gitSnapshot.gitStatus,
    gitStatusFiles: gitSnapshot.files,
    gitDiffMap: gitSnapshot.diffs,
    creditsRemaining: result.creditsRemaining
  });
  responsePayload.gitStatusFiles = gitSnapshot.files;
  responsePayload.gitDiffMap = gitSnapshot.diffs;
  responsePayload.completion_status = result.completionStatus ?? null;
  responsePayload.completion_work = result.completionWork ?? null;

  return {
    runId,
    responsePayload
  };
}

app.get("/api/projects", (req, res) => {
  const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => ({ name: dirent.name }));

  res.json(dirs);
});

app.get("/api/running-projects", (req, res) => {
  res.json({
    projects: [...runningProjects].map((name) => ({ name }))
  });
});

app.get("/api/automation-lock", (req, res) => {
  res.json(getFeatureAutomationLock());
});

app.post("/api/running-projects/refresh", (req, res) => {
  const clearedCount = runningProjects.size;
  runningProjects.clear();

  res.json({
    clearedCount,
    projects: []
  });
});

app.post("/api/projects/:projectName/pull", async (req, res) => {
  const { projectName } = req.params;

  if (!isValidProject(projectName)) {
    return res.status(400).json({ error: "Invalid project" });
  }

  if (runningProjects.has(projectName)) {
    return res.status(400).json({ error: "Project already running" });
  }
  if (activeFeatureAutomation) {
    return res.status(423).json({
      error: `Feature automation is currently running for ${activeFeatureAutomation.projectName} (${activeFeatureAutomation.baseBranch}).`
    });
  }

  runningProjects.add(projectName);

  try {
    const result = await pullRepository(getRepoPath(projectName));
    res.json({
      projectName,
      ...result
    });
  } catch (err) {
    console.error("project pull failed:", err);
    res.status(500).json({ error: getErrorMessage(err) });
  } finally {
    runningProjects.delete(projectName);
  }
});

app.get("/api/projects/:projectName/branches", async (req, res) => {
  const { projectName } = req.params;

  if (!isValidProject(projectName)) {
    return res.status(400).json({ error: "Invalid project" });
  }

  try {
    const branchResult = await listLocalBranches(getRepoPath(projectName));
    res.json({
      projectName,
      branches: branchResult.branches.map((name) => ({ name })),
      currentBranch: branchResult.currentBranch
    });
  } catch (err) {
    console.error("project branch list failed:", err);
    res.status(500).json({ error: getErrorMessage(err) });
  }
});

app.get("/api/run-test/stream/:streamId", (req, res) => {
  const { streamId } = req.params;

  if (!streamId) {
    return res.status(400).json({ error: "Missing stream id" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const connections = getRunStreamConnections(streamId);
  connections.add(res);

  res.write(`data: ${JSON.stringify({ type: "stream.connected", message: "Connected to live run stream.", at: new Date().toISOString() })}\n\n`);

  req.on("close", () => {
    connections.delete(res);
    if (connections.size === 0) {
      runEventStreams.delete(streamId);
    }
  });
});

app.post("/api/run-test", async (req, res) => {
  const {
    projectName,
    baseBranch = "main",
    prompt,
    executionMode = "read",
    streamId = null
  } = req.body;

  if (!EXECUTION_MODE_OPTIONS[executionMode]) {
    return res.status(400).json({ error: "Invalid execution mode" });
  }

  if (!isValidProject(projectName)) {
    return res.status(400).json({ error: "Invalid project" });
  }

  if (runningProjects.has(projectName)) {
    return res.status(400).json({ error: "Project already running" });
  }
  if (activeFeatureAutomation) {
    return res.status(423).json({
      error: `Feature automation is currently running for ${activeFeatureAutomation.projectName} (${activeFeatureAutomation.baseBranch}).`
    });
  }

  const repoPath = getRepoPath(projectName);
  const selectedBaseBranch = typeof baseBranch === "string" && baseBranch.trim()
    ? baseBranch.trim()
    : "main";
  runningProjects.add(projectName);

  try {
    const branchResult = await listLocalBranches(repoPath);
    if (!branchResult.branches.includes(selectedBaseBranch)) {
      return res.status(400).json({ error: `Invalid base branch '${selectedBaseBranch}' for project '${projectName}'.` });
    }

    const { responsePayload } = await executeRunFlow({
      projectName,
      prompt,
      executionMode,
      baseBranch: selectedBaseBranch,
      streamId
    });

    res.json(responsePayload);
  } catch (err) {
    console.error("run-test failed:", err);
    publishRunEvent(streamId, { type: "run.failed", message: `Run failed: ${getErrorMessage(err)}` });
    res.status(500).json({ error: getErrorMessage(err) });
  } finally {
    runningProjects.delete(projectName);
    closeRunStream(streamId);
  }
});

app.post("/api/stories/:storyId/complete-with-automation", async (req, res) => {
  const storyId = Number.parseInt(req.params.storyId, 10);
  const projectName = String(req.body?.projectName || "").trim();
  const baseBranch = String(req.body?.baseBranch || "").trim();
  const streamId = String(req.body?.streamId || "").trim() || null;
  const stopMergeIfStoryImplementationIncomplete = Boolean(req.body?.stopMergeIfStoryImplementationIncomplete);
  const executionMode = "write";
  let automationRunRecord = null;
  let executionRecordInput = null;

  if (!Number.isInteger(storyId) || storyId <= 0) {
    return res.status(400).json({ error: "Invalid story id." });
  }

  if (!projectName || !isValidProject(projectName)) {
    return res.status(400).json({ error: "A valid project name is required." });
  }
  if (!baseBranch) {
    return res.status(400).json({ error: "A base branch is required." });
  }
  if (activeFeatureAutomation) {
    return res.status(423).json({
      error: `Feature automation is already running for story #${activeFeatureAutomation.storyId}.`
    });
  }

  if (runningProjects.has(projectName)) {
    return res.status(400).json({ error: "Project already running" });
  }

  try {
    const branchResult = await listLocalBranches(getRepoPath(projectName));
    if (!branchResult.branches.includes(baseBranch)) {
      return res.status(400).json({ error: `Invalid base branch '${baseBranch}' for project '${projectName}'.` });
    }

    const storyContext = await getStoryAutomationContext(storyId, { projectName, baseBranch });
    if (!storyContext) {
      return res.status(404).json({ error: "Story not found." });
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

    runningProjects.add(projectName);
    activeFeatureAutomation = {
      projectName,
      baseBranch,
      storyId,
      startedAt: new Date().toISOString()
    };
    automationRunRecord = await createAutomationRun({
      automationType: "story",
      targetId: storyId,
      stopFlag: false,
      stopOnIncomplete: stopMergeIfStoryImplementationIncomplete,
      automationStatus: "running",
      currentPosition: 1,
      stopReason: null
    });
    publishRunEvent(streamId, { type: "automation.started", message: `Story automation started for #${storyId}.` });

    const { runId, responsePayload } = await executeRunFlow({
      projectName,
      prompt,
      executionMode,
      baseBranch,
      streamId
    });

    await attachRunToStory(storyId, runId);
    const runCompletionStatus = normalizeCompletionStatus(responsePayload.completion_status);
    executionRecordInput = {
      automationRunId: automationRunRecord?.id,
      storyId,
      positionInQueue: 1,
      executionStatus: "completed",
      queueAction: "advanced",
      runId,
      completionStatus: runCompletionStatus,
      completionWork: responsePayload.completion_work ?? null
    };
    const shouldSkipAutoMerge = stopMergeIfStoryImplementationIncomplete && runCompletionStatus !== "complete";
    let autoMerge = {
      status: "not_attempted",
      reason: "No merge outcome available."
    };

    if (shouldSkipAutoMerge) {
      if (automationRunRecord?.id) {
        await updateAutomationRunMetadata(automationRunRecord.id, {
          stopFlag: true,
          automationStatus: "stopped",
          stopReason: "story_incomplete"
        });
      }
      executionRecordInput.queueAction = "stopped";
      autoMerge = {
        status: "skipped",
        reason: `Run completion status was '${runCompletionStatus}'.`
      };
      publishRunEvent(streamId, {
        type: "merge.skipped",
        message: `Auto-merge skipped for story #${storyId}: ${autoMerge.reason}`
      });
    } else {
      publishRunEvent(streamId, {
        type: "merge.started",
        message: `Auto-merging run #${runId} into '${baseBranch}' and pushing to origin...`
      });

      try {
        const mergeResult = await mergeBranch(
          getRepoPath(projectName),
          responsePayload.branchName,
          baseBranch,
          responsePayload.changeTitle || "Codex changes",
          responsePayload.changeDescription || ""
        );
        await updateRunMerge(runId, mergeResult);
        if (automationRunRecord?.id) {
          await updateAutomationRunMetadata(automationRunRecord.id, {
            stopFlag: false,
            automationStatus: "completed",
            stopReason: "all_work_complete"
          });
        }
        autoMerge = {
          status: "merged",
          reason: `Merged '${responsePayload.branchName}' into '${baseBranch}' and pushed to origin.`
        };
        publishRunEvent(streamId, {
          type: "merge.completed",
          message: autoMerge.reason
        });
      } catch (mergeError) {
        const wrappedMergeError = new Error(getErrorMessage(mergeError));
        wrappedMergeError.code = "merge_failed";
        publishRunEvent(streamId, {
          type: "merge.failed",
          message: `Auto-merge failed: ${wrappedMergeError.message}`
        });
        throw wrappedMergeError;
      }
    }

    if (automationRunRecord?.id) {
      await recordAutomationStoryExecution(executionRecordInput);
    }

    const updatedFeatures = await getFeaturesTree({ projectName, baseBranch });
    publishRunEvent(streamId, { type: "automation.completed", message: `Story automation completed for #${storyId}.` });

    res.json({
      storyId,
      runId,
      prompt,
      run: responsePayload,
      autoMerge,
      features: updatedFeatures,
      projectName,
      baseBranch
    });
  } catch (error) {
    if (automationRunRecord?.id) {
      const failureExecutionRecord = executionRecordInput || {
        automationRunId: automationRunRecord.id,
        storyId,
        positionInQueue: 1,
        executionStatus: "failed",
        queueAction: "failed",
        runId: null,
        completionStatus: null,
        completionWork: null,
        error: getErrorMessage(error)
      };

      try {
        await recordAutomationStoryExecution({
          ...failureExecutionRecord,
          executionStatus: "failed",
          queueAction: "failed",
          error: getErrorMessage(error)
        });
      } catch (persistError) {
        console.error("automation story execution persistence failed:", persistError);
      }
    }

    if (automationRunRecord?.id) {
      try {
        await updateAutomationRunMetadata(automationRunRecord.id, {
          stopFlag: true,
          automationStatus: "failed",
          stopReason: error?.code === "merge_failed" ? "merge_failed" : "execution_failed"
        });
      } catch (updateError) {
        console.error("automation metadata update failed:", updateError);
      }
    }
    publishRunEvent(streamId, { type: "automation.failed", message: `Story automation failed: ${getErrorMessage(error)}` });
    res.status(500).json({
      error: getErrorMessage(error),
      errorType: error?.code === "merge_failed"
        ? "merge_failed"
        : error?.code === "prompt_generation_failed"
          ? "prompt_generation_failed"
          : "execution_failed"
    });
  } finally {
    runningProjects.delete(projectName);
    activeFeatureAutomation = null;
    closeRunStream(streamId);
  }
});

app.get("/api/runs", async (req, res) => {
  const { search = "", status = "active" } = req.query;
  const normalizedStatus = String(status || "active").toLowerCase();

  if (!["active", "archived", "all"].includes(normalizedStatus)) {
    return res.status(400).json({ error: "Invalid status filter" });
  }

  const runs = await getRuns({ search, status: normalizedStatus });
  res.json(runs.map((run) => hydrateRun(run)));
});

app.get("/api/runs/:id", async (req, res) => {
  const run = hydrateRun(await getRunById(req.params.id));
  if (!run) return res.status(404).json({ error: "Not found" });
  res.json(run);
});

app.get("/api/features/tree", async (req, res) => {
  const projectName = String(req.query?.projectName || "").trim();
  const baseBranch = String(req.query?.baseBranch || "").trim();

  if (!projectName || !baseBranch) {
    return res.status(400).json({ error: "projectName and baseBranch are required." });
  }

  try {
    const features = await getFeaturesTree({ projectName, baseBranch });
    res.json(features);
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post("/api/features/tree", async (req, res) => {
  const draft = req.body || {};
  const projectName = String(draft.projectName || "").trim();
  const baseBranch = String(draft.baseBranch || "").trim();

  if (typeof draft.name !== "string" || !draft.name.trim()) {
    return res.status(400).json({ error: "Feature name is required." });
  }
  if (!projectName || !isValidProject(projectName)) {
    return res.status(400).json({ error: "A valid project name is required." });
  }
  if (!baseBranch) {
    return res.status(400).json({ error: "Base branch is required." });
  }

  const epics = Array.isArray(draft.epics) ? draft.epics : [];
  for (const epic of epics) {
    if (typeof epic?.name !== "string" || !epic.name.trim()) {
      return res.status(400).json({ error: "Each epic requires a name." });
    }

    const stories = Array.isArray(epic.stories) ? epic.stories : [];
    for (const story of stories) {
      if (typeof story?.name !== "string" || !story.name.trim()) {
        return res.status(400).json({ error: "Each story requires a name." });
      }
    }
  }

  try {
    await createFeatureTree(draft, { projectName, baseBranch });
    const features = await getFeaturesTree({ projectName, baseBranch });
    res.status(201).json(features);
  } catch (error) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.post("/api/features/tree/from-manifest", async (req, res) => {
  const projectName = String(req.body?.projectName || "").trim();
  const baseBranch = String(req.body?.baseBranch || "").trim();
  const manifestJson = String(req.body?.manifestJson || "").trim();

  if (!projectName || !isValidProject(projectName)) {
    return res.status(400).json({ error: "A valid project name is required." });
  }
  if (!baseBranch) {
    return res.status(400).json({ error: "Base branch is required." });
  }
  if (!manifestJson) {
    return res.status(400).json({ error: "manifestJson is required." });
  }

  let parsedManifest;
  try {
    parsedManifest = JSON.parse(manifestJson);
  } catch (error) {
    return res.status(400).json({ error: "manifestJson must be valid JSON." });
  }

  let featureDrafts = [];
  try {
    featureDrafts = normalizeManifestToFeatureDrafts(parsedManifest);
  } catch (error) {
    return res.status(400).json({ error: getErrorMessage(error) });
  }

  try {
    for (const featureDraft of featureDrafts) {
      await createFeatureTree(featureDraft, { projectName, baseBranch });
    }

    const features = await getFeaturesTree({ projectName, baseBranch });
    res.status(201).json({
      createdFeatureCount: featureDrafts.length,
      features
    });
  } catch (error) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.get("/api/features/completion-runs", async (req, res) => {
  try {
    const runs = await getCompletionEligibleRuns();
    res.json(runs.map((run) => ({
      ...run,
      completion_status: normalizeCompletionStatus(run.completion_status)
    })));
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post("/api/stories/:storyId/sync-completion", async (req, res) => {
  const storyId = Number.parseInt(req.params.storyId, 10);
  const runId = Number.parseInt(req.body?.runId, 10);

  if (!Number.isInteger(storyId) || storyId <= 0) {
    return res.status(400).json({ error: "Invalid story id." });
  }

  if (!Number.isInteger(runId) || runId <= 0) {
    return res.status(400).json({ error: "Invalid run id." });
  }

  try {
    const result = await syncStoryCompletionFromRun(storyId, runId);
    res.json(result);
  } catch (error) {
    const message = getErrorMessage(error);
    if (message.includes("not found")) {
      return res.status(404).json({ error: message });
    }
    res.status(400).json({ error: message });
  }
});

app.get("/api/runs/:id/diff", async (req, res) => {
  const run = hydrateRun(await getRunById(req.params.id));

  if (!run) {
    return res.status(404).json({ error: "Run not found" });
  }

  const filePath = req.query.file;

  if (!filePath) {
    return res.status(400).json({ error: "Missing file path" });
  }

  const diff = run.git_diff_map?.[filePath];

  if (typeof diff !== "string") {
    return res.status(404).json({ error: "Diff not found" });
  }

  res.json({
    file: filePath,
    diff
  });
});

app.post("/api/runs/:id/merge", async (req, res) => {
  const run = await getRunById(req.params.id);

  if (!run) {
    return res.status(404).json({ error: "Run not found" });
  }

  if (run.merged_at) {
    return res.status(400).json({ error: "Run already merged" });
  }

  if (!isValidProject(run.project_name)) {
    return res.status(400).json({ error: "Invalid project" });
  }

  try {
    const mergeResult = await mergeBranch(
      getRepoPath(run.project_name),
      run.branch_name,
      run.base_branch || "main",
      run.change_title || "Codex changes",
      run.change_description || ""
    );

    await updateRunMerge(run.id, mergeResult);

    const updatedRun = hydrateRun(await getRunById(run.id));
    res.json(updatedRun);
  } catch (err) {
    console.error("merge failed:", err);
    res.status(500).json({ error: getErrorMessage(err) });
  }
});

app.post("/api/runs/:id/archive", async (req, res) => {
  const run = await getRunById(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found" });

  const changes = await setRunArchived(run.id, true);
  if (changes < 1) {
    return res.status(500).json({ error: "Archive update failed" });
  }

  const updatedRun = hydrateRun(await getRunById(run.id));
  return res.json(updatedRun);
});

app.post("/api/runs/:id/unarchive", async (req, res) => {
  const run = await getRunById(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found" });

  const changes = await setRunArchived(run.id, false);
  if (changes < 1) {
    return res.status(500).json({ error: "Unarchive update failed" });
  }

  const updatedRun = hydrateRun(await getRunById(run.id));
  return res.json(updatedRun);
});

app.delete("/api/runs/:id", async (req, res) => {
  const run = await getRunById(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found" });

  const changes = await deleteRunById(run.id);
  if (changes < 1) {
    return res.status(500).json({ error: "Delete failed" });
  }

  return res.json({ deleted: true, id: Number(req.params.id) });
});

dbReady
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database migration failed:", error);
    process.exit(1);
  });
