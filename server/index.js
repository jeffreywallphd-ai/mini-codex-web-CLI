require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const { runCodexWithUsage } = require("./codexRunner");
const { saveRun, getRuns, getRunById } = require("./db");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, "../web")));

const PORT = process.env.PORT || 3000;
const PROJECTS_DIR = path.resolve(__dirname, process.env.PROJECTS_DIR);

let runningProjects = new Set();

function isValidProject(name) {
  const fullPath = path.join(PROJECTS_DIR, name);
  return fs.existsSync(fullPath);
}

app.get("/api/projects", (req, res) => {
  const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({ name: d.name }));

  res.json(dirs);
});

app.post("/api/run-test", async (req, res) => {
  try {
    const { projectName, prompt } = req.body;

    if (!isValidProject(projectName)) {
      return res.status(400).json({ error: "Invalid project" });
    }

    if (runningProjects.has(projectName)) {
      return res.status(400).json({ error: "Project already running" });
    }

    runningProjects.add(projectName);

    const repoPath = path.join(PROJECTS_DIR, projectName);

    const result = await runCodexWithUsage(repoPath, prompt);

    const runId = await saveRun({
      projectName,
      prompt,
      ...result
    });

    runningProjects.delete(projectName);

    res.json({
      runId,
      ...result,
      creditsRemaining: result.creditsRemaining
    });

  } catch (err) {
    console.error("run-test failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/runs", async (req, res) => {
  res.json(await getRuns());
});

app.get("/api/runs/:id", async (req, res) => {
  const run = await getRunById(req.params.id);
  if (!run) return res.status(404).json({ error: "Not found" });
  res.json(run);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});