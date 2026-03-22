const projectSelect = document.getElementById("projectSelect");
const promptInput = document.getElementById("promptInput");
const runButton = document.getElementById("runButton");
const runsList = document.getElementById("runsList");
const runDetail = document.getElementById("runDetail");
const promptDetail = document.getElementById("promptDetail");
const stderrDetail = document.getElementById("stderrDetail");
const statusBox = document.getElementById("statusBox");
const runSearchInput = document.getElementById("runSearchInput");

let allRuns = [];

const creditsBox = document.getElementById("creditsBox");

function renderStatus(run) {
  if (run.error) {
    statusBox.textContent = `Request failed: ${run.error}`;
    return;
  }

  if (typeof run.code !== "number") {
    statusBox.textContent = "Run failed: invalid server response.";
    return;
  }

  if (run.code === 0) {
    statusBox.textContent = "Run completed successfully.";
    return;
  }

  const stderr = run.stderr || "";
  if (stderr.includes("401 Unauthorized")) {
    statusBox.textContent = "Run failed: missing or invalid OpenAI API key.";
    return;
  }

  statusBox.textContent = `Run failed with exit code ${run.code}.`;
}

function cleanOutput(text) {
  if (!text) return "";

  // Remove codex header noise if present
  if (text.includes("--------")) {
    return text.split("--------").pop().trim();
  }

  return text.trim();
}

function renderRun(run) {
  promptDetail.textContent = run.prompt || "(none)";

  const parts = [
    `Run ID: ${run.id ?? run.runId ?? ""}`,
    `Project: ${run.project_name ?? run.projectName ?? ""}`,
    run.credits_remaining !== undefined
        ? `Credits Remaining: ${run.credits_remaining}`
        : "",
    `Exit Code: ${run.code ?? ""}`,
    run.created_at ? `Created: ${run.created_at}` : "",
    run.usage_delta ? `Usage: ${run.usage_delta}` : "Usage: (not calculated)",
    "",
    "Response",
    "--------",
    cleanOutput(run.stdout) || "(none)"
  ];

  runDetail.textContent = parts.filter(Boolean).join("\n");
  stderrDetail.textContent = run.stderr || "(none)";
}

function renderRunsList(runs) {
  runsList.innerHTML = "";

  if (!runs.length) {
    const li = document.createElement("li");
    li.textContent = "No matching runs.";
    runsList.appendChild(li);
    return;
  }

  for (const run of runs) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    const promptPreview = (run.prompt || "").replace(/\s+/g, " ").slice(0, 80);
    button.textContent = `#${run.id} - ${run.project_name} - ${promptPreview || "(no prompt)"}`;
    button.onclick = () => loadRunDetail(run.id);
    li.appendChild(button);
    runsList.appendChild(li);
  }
}

function filterRuns() {
  const query = runSearchInput.value.trim().toLowerCase();

  if (!query) {
    renderRunsList(allRuns);
    return;
  }

  const filtered = allRuns.filter((run) => {
    const project = (run.project_name || "").toLowerCase();
    const prompt = (run.prompt || "").toLowerCase();
    return project.includes(query) || prompt.includes(query);
  });

  renderRunsList(filtered);
}

async function loadProjects() {
  const res = await fetch("/api/projects");
  const projects = await res.json();

  projectSelect.innerHTML = "";
  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.name;
    option.textContent = project.name;
    projectSelect.appendChild(option);
  }
}

async function loadRuns() {
  const res = await fetch("/api/runs");
  allRuns = await res.json();
  filterRuns();
}

async function loadRunDetail(id) {
  const res = await fetch(`/api/runs/${id}`);
  const run = await res.json();
  renderRun(run);
  renderStatus(run);

  if (run.credits_remaining !== undefined) {
    creditsBox.textContent = `Credits Remaining: ${run.credits_remaining}`;
  }
}

runButton.addEventListener("click", async () => {
  const projectName = projectSelect.value;
  const prompt = promptInput.value.trim();

  if (!projectName || !prompt) return;

  runButton.disabled = true;
  runButton.textContent = "Running...";
  statusBox.textContent = "Running...";

  try {
    const res = await fetch("/api/run-test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ projectName, prompt })
    });

    const result = await res.json();

    if (!res.ok) {
      renderStatus(result);
      runDetail.textContent = "";
      stderrDetail.textContent = result.error || "(none)";
      promptDetail.textContent = prompt;
      return;
    }

    renderRun({
      runId: result.runId,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      projectName,
      prompt
    });

    if (result.creditsRemaining !== undefined) {
       creditsBox.textContent = `Credits Remaining: ${result.creditsRemaining}`;
    }

    renderStatus(result);
    promptInput.value = "";
    await loadRuns();
  } catch (err) {
    statusBox.textContent = `Request failed: ${err.message}`;
  } finally {
    runButton.disabled = false;
    runButton.textContent = "Run";
  }
});

runSearchInput.addEventListener("input", filterRuns);

loadProjects();
loadRuns();