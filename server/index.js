require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const { runCodexWithUsage, EXECUTION_MODE_OPTIONS } = require("./codexRunner");
const { saveRun, getRuns, getRunById, updateRunMerge } = require("./db");
const { createCodexBranch, getGitSnapshot, mergeBranch, pullRepository } = require("./git");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, "../web")));

const PORT = process.env.PORT || 3000;
const PROJECTS_DIR = path.resolve(__dirname, process.env.PROJECTS_DIR);

const runningProjects = new Set();

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

  return {
    ...run,
    git_status_files: parseJson(run.git_status_files, []),
    git_diff_map: parseJson(run.git_diff_map, {})
  };
}

app.get("/api/projects", (req, res) => {
  const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => ({ name: dirent.name }));

  res.json(dirs);
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

app.post("/api/run-test", async (req, res) => {
  const { projectName, prompt, executionMode = "read" } = req.body;

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

  try {
    const branchInfo = await createCodexBranch(repoPath);
    const result = await runCodexWithUsage(repoPath, prompt, executionMode);
    const gitSnapshot = await getGitSnapshot(repoPath);

    const runId = await saveRun({
      projectName,
      prompt,
      ...branchInfo,
      ...result,
      gitStatus: gitSnapshot.gitStatus,
      gitStatusFiles: gitSnapshot.files,
      gitDiffMap: gitSnapshot.diffs
    });

    res.json({
      runId,
      projectName,
      prompt,
      ...branchInfo,
      ...result,
      gitStatus: gitSnapshot.gitStatus,
      gitStatusFiles: gitSnapshot.files,
      gitDiffMap: gitSnapshot.diffs,
      creditsRemaining: result.creditsRemaining
    });
  } catch (err) {
    console.error("run-test failed:", err);
    res.status(500).json({ error: getErrorMessage(err) });
  } finally {
    runningProjects.delete(projectName);
  }
});

app.get("/api/runs", async (req, res) => {
  res.json(await getRuns());
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
