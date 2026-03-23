const projectSelect = document.getElementById("projectSelect");
const pullButton = document.getElementById("pullButton");
const executionModeSelect = document.getElementById("executionModeSelect");
const promptInput = document.getElementById("promptInput");
const runButton = document.getElementById("runButton");
const runsList = document.getElementById("runsList");
const statusBox = document.getElementById("statusBox");
const runSearchInput = document.getElementById("runSearchInput");
const creditsBox = document.getElementById("creditsBox");

const EDITOR_STATE_KEY = "mini-codex-editor-state";
let allRuns = [];

function getEditorState() {
  return {
    projectName: projectSelect.value || "",
    executionMode: executionModeSelect.value || "read",
    prompt: promptInput.value
  };
}

function saveEditorState() {
  localStorage.setItem(EDITOR_STATE_KEY, JSON.stringify(getEditorState()));
}

function restoreEditorState(projects) {
  const rawState = localStorage.getItem(EDITOR_STATE_KEY);
  if (!rawState) return;

  try {
    const state = JSON.parse(rawState);
    if (state.executionMode) {
      executionModeSelect.value = state.executionMode;
    }

    if (state.prompt) {
      promptInput.value = state.prompt;
    }

    if (state.projectName && projects.some((project) => project.name === state.projectName)) {
      projectSelect.value = state.projectName;
    }
  } catch (error) {
    console.warn("Unable to restore editor state", error);
  }
}

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
    const title = run.changeTitle || run.change_title;
    statusBox.textContent = title
      ? `Run completed on ${run.branchName || run.branch_name || "new branch"}: ${title}.`
      : `Run completed on ${run.branchName || run.branch_name || "new branch"}.`;
    return;
  }

  const stderr = run.stderr || "";
  if (stderr.includes("401 Unauthorized")) {
    statusBox.textContent = "Run failed: missing or invalid OpenAI API key.";
    return;
  }

  statusBox.textContent = `Run failed with exit code ${run.code}.`;
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
    const promptPreview = `${(run.prompt || "").replace(/\s+/g, " ").slice(0, 120)}${(run.prompt || "").length > 120 ? "..." : ""}`;
    const mergeBadge = run.merged_at ? " · merged" : "";
    const executionMode = run.execution_mode === "write" ? "Write Mode" : "Read Mode";
    const title = run.change_title ? `\nTitle: ${run.change_title}` : "";
    button.textContent = `#${run.id} · ${run.project_name} · ${executionMode} · ${run.branch_name || "(no branch)"}${mergeBadge}${title}\n${promptPreview || "(no prompt)"}`;
    button.onclick = () => {
      saveEditorState();
      window.location.href = `/run-details.html?id=${run.id}`;
    };
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
    const branch = (run.branch_name || "").toLowerCase();
    return project.includes(query) || prompt.includes(query) || branch.includes(query);
  });

  renderRunsList(filtered);
}

async function loadProjects() {
  const response = await fetch("/api/projects");
  const projects = await response.json();

  projectSelect.innerHTML = "";
  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.name;
    option.textContent = project.name;
    projectSelect.appendChild(option);
  }

  restoreEditorState(projects);
}

async function loadRuns() {
  const response = await fetch("/api/runs");
  allRuns = await response.json();
  filterRuns();
}

async function pullSelectedRepository() {
  const projectName = projectSelect.value;

  if (!projectName) {
    statusBox.textContent = "Select a repository before pulling.";
    return;
  }

  saveEditorState();
  pullButton.disabled = true;
  runButton.disabled = true;
  pullButton.textContent = "Pulling...";
  statusBox.textContent = `Pulling latest changes for ${projectName}...`;

  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectName)}/pull`, {
      method: "POST"
    });
    const result = await response.json();

    if (!response.ok) {
      statusBox.textContent = `Git pull failed: ${result.error || "Unknown error."}`;
      return;
    }

    const summary = (result.stdout || "Git pull finished.").trim().split("\n").find(Boolean);
    const branchStatus = (result.gitStatus || "").split("\n").find(Boolean);
    statusBox.textContent = [summary, branchStatus].filter(Boolean).join(" ");
  } catch (error) {
    statusBox.textContent = `Git pull failed: ${error.message}`;
  } finally {
    pullButton.disabled = false;
    runButton.disabled = false;
    pullButton.textContent = "Git Pull Selected Repo";
  }
}

runButton.addEventListener("click", async () => {
  const projectName = projectSelect.value;
  const prompt = promptInput.value.trim();
  const executionMode = executionModeSelect.value;

  if (!projectName || !prompt) return;

  saveEditorState();
  runButton.disabled = true;
  runButton.textContent = "Running...";
  statusBox.textContent = "Creating branch from main and starting Codex...";

  try {
    const response = await fetch("/api/run-test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ projectName, prompt, executionMode })
    });

    const result = await response.json();

    if (!response.ok) {
      renderStatus(result);
      return;
    }

    if (result.creditsRemaining !== undefined) {
      creditsBox.textContent = `Credits Remaining: ${result.creditsRemaining}`;
    }

    renderStatus(result);
    await loadRuns();
  } catch (error) {
    statusBox.textContent = `Request failed: ${error.message}`;
  } finally {
    runButton.disabled = false;
    runButton.textContent = "Run";
  }
});

pullButton.addEventListener("click", pullSelectedRepository);

[projectSelect, executionModeSelect, promptInput].forEach((element) => {
  element.addEventListener("change", saveEditorState);
  element.addEventListener("input", saveEditorState);
});

runSearchInput.addEventListener("input", filterRuns);

loadProjects();
loadRuns();
