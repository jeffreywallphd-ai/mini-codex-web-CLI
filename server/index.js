require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const { runCodexWithUsage, EXECUTION_MODE_OPTIONS } = require("./codexRunner");
const { saveRun, getRuns, getRunById, updateRunMerge, dbReady } = require("./db");
const { createCodexBranch, getGitSnapshot, mergeBranch, pullRepository } = require("./git");

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

  const repoPath = getRepoPath(projectName);
  runningProjects.add(projectName);
  const runStartTime = Date.now();

  try {
    publishRunEvent(streamId, { type: "branch.creating", message: "Creating branch from base..." });
    const branchInfo = await createCodexBranch(repoPath);
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

app.get("/api/runs", async (req, res) => {
  const runs = await getRuns();
  res.json(runs.map((run) => hydrateRun(run)));
});

app.get("/api/runs/:id", async (req, res) => {
  const run = hydrateRun(await getRunById(req.params.id));
  if (!run) return res.status(404).json({ error: "Not found" });
  res.json(run);
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
