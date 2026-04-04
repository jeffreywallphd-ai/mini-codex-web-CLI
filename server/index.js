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
  getCompletionEligibleRuns,
  setRunArchived,
  deleteRunById,
  dbReady
} = require("./db");
const { buildStoryAutomationPrompt } = require("./storyAutomationPrompt");
const { saveRun, getRuns, getRunById, updateRunMerge, setRunArchived, deleteRunById } = require("./db");
const { createCodexBranch, getGitSnapshot, listLocalBranches, mergeBranch, pullRepository } = require("./git");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, "../web")));

const PORT = process.env.PORT || 3000;
const PROJECTS_DIR = path.resolve(__dirname, process.env.PROJECTS_DIR);

const runningProjects = new Set();
const runEventStreams = new Map();

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


  runningProjects.add(projectName);

  try {
    const { responsePayload } = await executeRunFlow({

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
    publishRunEvent(streamId, { type: "branch.creating", message: "Creating branch from base..." });
    const branchInfo = await createCodexBranch(repoPath, selectedBaseBranch);
    publishRunEvent(streamId, { type: "branch.created", message: `Branch created: ${branchInfo.branchName || "unknown"}.` });
    const result = await runCodexWithUsage(repoPath, prompt, executionMode, (event) => {
      publishRunEvent(streamId, event);
    });
    publishRunEvent(streamId, { type: "snapshot.collecting", message: "Collecting git snapshot..." });
    const gitSnapshot = await getGitSnapshot(repoPath);
    publishRunEvent(streamId, { type: "run.persisting", message: "Saving run record..." });

    const runId = await saveRun({
>>>>>>> 5c75d70ceae9268293cbb063f80fcb3e8205efb7
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
  const executionMode = "write";

  if (!Number.isInteger(storyId) || storyId <= 0) {
    return res.status(400).json({ error: "Invalid story id." });
  }

  if (!projectName || !isValidProject(projectName)) {
    return res.status(400).json({ error: "A valid project name is required." });
  }

  if (runningProjects.has(projectName)) {
    return res.status(400).json({ error: "Project already running" });
  }

  try {
    const storyContext = await getStoryAutomationContext(storyId);
    if (!storyContext) {
      return res.status(404).json({ error: "Story not found." });
    }

    const prompt = buildStoryAutomationPrompt(storyContext);
    runningProjects.add(projectName);

    const { runId, responsePayload } = await executeRunFlow({
      projectName,
      prompt,
      executionMode
    });

    await attachRunToStory(storyId, runId);
    const updatedFeatures = await getFeaturesTree();

    res.json({
      storyId,
      runId,
      prompt,
      run: responsePayload,
      features: updatedFeatures
    });
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  } finally {
    runningProjects.delete(projectName);
  }
});

app.get("/api/runs", async (req, res) => {
<<<<<<< HEAD
=======
<<<<<<< HEAD
  const runs = await getRuns();
  res.json(runs.map((run) => hydrateRun(run)));
=======
>>>>>>> 5c75d70ceae9268293cbb063f80fcb3e8205efb7
  const { search = "", status = "active" } = req.query;
  const normalizedStatus = String(status || "active").toLowerCase();

  if (!["active", "archived", "all"].includes(normalizedStatus)) {
    return res.status(400).json({ error: "Invalid status filter" });
  }

<<<<<<< HEAD
  const runs = await getRuns({ search, status: normalizedStatus });
  res.json(runs.map((run) => hydrateRun(run)));
=======
  res.json(await getRuns({ search, status: normalizedStatus }));
>>>>>>> main
>>>>>>> 5c75d70ceae9268293cbb063f80fcb3e8205efb7
});

app.get("/api/runs/:id", async (req, res) => {
  const run = hydrateRun(await getRunById(req.params.id));
  if (!run) return res.status(404).json({ error: "Not found" });
  res.json(run);
});

app.get("/api/features/tree", async (req, res) => {
  try {
    const features = await getFeaturesTree();
    res.json(features);
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post("/api/features/tree", async (req, res) => {
  const draft = req.body || {};

  if (typeof draft.name !== "string" || !draft.name.trim()) {
    return res.status(400).json({ error: "Feature name is required." });
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
    await createFeatureTree(draft);
    const features = await getFeaturesTree();
    res.status(201).json(features);
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

