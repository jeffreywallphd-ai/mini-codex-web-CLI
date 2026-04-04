const projectSelect = document.getElementById("projectSelect");
const pullButton = document.getElementById("pullButton");
const executionModeSelect = document.getElementById("executionModeSelect");
const promptInput = document.getElementById("promptInput");
const runButton = document.getElementById("runButton");
const muteToggleButton = document.getElementById("muteToggleButton");
const pasteClipboardButton = document.getElementById("pasteClipboardButton");
const clearStateButton = document.getElementById("clearStateButton");
const runTimer = document.getElementById("runTimer");
const runningProjectHint = document.getElementById("runningProjectHint");
const runsList = document.getElementById("runsList");
const statusBox = document.getElementById("statusBox");
const runSearchInput = document.getElementById("runSearchInput");
const creditsBox = document.getElementById("creditsBox");
const errorCard = document.getElementById("errorCard");
const errorCardMessage = document.getElementById("errorCardMessage");

const EDITOR_STATE_KEY = "mini-codex-editor-state";
const TTS_MUTED_KEY = "mini-codex-tts-muted";
let allRuns = [];
let runningProjects = new Set();
let isRunningRequestInFlight = false;
let isPullRequestInFlight = false;
let activeRunStream = null;
let activeRunStartedAt = null;
let runTimerInterval = null;
let isTtsMuted = false;

function loadMutedState() {
  isTtsMuted = localStorage.getItem(TTS_MUTED_KEY) === "true";
}

function renderMuteToggle() {
  if (!muteToggleButton) return;
  muteToggleButton.textContent = isTtsMuted ? "Unmute TTS" : "Mute TTS";
  muteToggleButton.setAttribute("aria-pressed", isTtsMuted ? "true" : "false");
}

function setTtsMuted(nextMuted) {
  isTtsMuted = Boolean(nextMuted);
  localStorage.setItem(TTS_MUTED_KEY, String(isTtsMuted));
  if (isTtsMuted && typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  renderMuteToggle();
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderRunTimer() {
  if (!activeRunStartedAt) {
    runTimer.textContent = "";
    runTimer.classList.add("hidden");
    return;
  }

  runTimer.textContent = `Running for ${formatElapsed(Date.now() - activeRunStartedAt)}`;
  runTimer.classList.remove("hidden");
}

function startRunTimer() {
  if (!activeRunStartedAt) return;
  renderRunTimer();
  if (runTimerInterval) {
    clearInterval(runTimerInterval);
  }
  runTimerInterval = setInterval(renderRunTimer, 1000);
}

function stopRunTimer() {
  activeRunStartedAt = null;
  if (runTimerInterval) {
    clearInterval(runTimerInterval);
    runTimerInterval = null;
  }
  renderRunTimer();
}

function announceRunComplete() {
  if (isTtsMuted) {
    return;
  }

  const supportsTts = typeof window !== "undefined"
    && typeof window.speechSynthesis !== "undefined"
    && typeof window.SpeechSynthesisUtterance !== "undefined";
  const looksLikeChrome = typeof navigator !== "undefined"
    && /Chrome/i.test(navigator.userAgent || "")
    && !/Edg|OPR|Brave/i.test(navigator.userAgent || "");

  if (!supportsTts || !looksLikeChrome) {
    return;
  }

  const speak = () => {
    const utterance = new SpeechSynthesisUtterance("Your current run is complete");
    window.speechSynthesis.speak(utterance);
  };

  speak();
  window.setTimeout(speak, 2000);
}

function createRunStreamId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function closeRunStream() {
  if (activeRunStream?.eventSource) {
    activeRunStream.eventSource.close();
  }
  activeRunStream = null;
}

function startRunStream(streamId) {
  closeRunStream();

  const eventSource = new EventSource(`/api/run-test/stream/${encodeURIComponent(streamId)}`);
  activeRunStream = {
    streamId,
    eventSource
  };

  eventSource.onmessage = (event) => {
    if (!activeRunStream || activeRunStream.streamId !== streamId) {
      return;
    }

    try {
      const payload = JSON.parse(event.data || "{}");
      if (payload?.message) {
        statusBox.textContent = payload.message;
      }
    } catch (error) {
      console.warn("Failed to parse run stream event", error);
    }
  };

  eventSource.onerror = () => {
    if (!activeRunStream || activeRunStream.streamId !== streamId) {
      return;
    }

    if (isRunningRequestInFlight) {
      statusBox.textContent = "Live status disconnected; waiting for final run result...";
    }
  };
}

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

function clearEditorState() {
  localStorage.removeItem(EDITOR_STATE_KEY);
  promptInput.value = "";
  executionModeSelect.value = "read";
  if (projectSelect.options.length > 0) {
    projectSelect.selectedIndex = 0;
  }
  updateProjectActionState();
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

function hideErrorCard() {
  errorCard.classList.add("hidden");
  errorCardMessage.textContent = "";
}

function showErrorCard(message) {
  const normalizedMessage = typeof message === "string" && message.trim()
    ? message.trim()
    : "Unknown error.";

  errorCardMessage.textContent = normalizedMessage;
  errorCard.classList.remove("hidden");
}

async function parseJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch (error) {
      return {
        error: `Could not parse JSON response: ${error.message}`
      };
    }
  }

  const text = await response.text();
  return {
    error: text || `Unexpected ${response.status} response from server.`
  };
}

function buildErrorMessage(context, result, fallback) {
  const resultError = result?.error || result?.stderr;
  if (resultError) {
    return `${context}: ${resultError}`;
  }

  return `${context}: ${fallback}`;
}

function updateProjectActionState() {
  const projectName = projectSelect.value;
  const isProjectRunning = projectName && runningProjects.has(projectName);
  const isRunActive = isRunningRequestInFlight || isProjectRunning;

  runningProjectHint.textContent = isProjectRunning
    ? `"${projectName}" is currently running. Wait for it to finish.`
    : "";

  runButton.disabled = !projectName || isRunActive;
  runButton.textContent = isRunActive ? "Running..." : "Run";
  runButton.classList.toggle("running-button", isRunActive);

  if (isRunActive) {
    if (!activeRunStartedAt) {
      activeRunStartedAt = Date.now();
      startRunTimer();
    } else {
      renderRunTimer();
    }
  } else {
    stopRunTimer();
  }

  if (!isPullRequestInFlight) {
    pullButton.disabled = !projectName || isProjectRunning;
  }
}

async function loadRunningProjects() {
  const response = await fetch("/api/running-projects");
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(buildErrorMessage("Could not load running project cache", result, "Request failed"));
  }

  runningProjects = new Set((result.projects || []).map((entry) => entry.name));
  updateProjectActionState();
}

async function refreshRunningProjects() {
  try {
    const response = await fetch("/api/running-projects/refresh", {
      method: "POST"
    });
    const result = await parseJsonResponse(response);

    if (!response.ok) {
      throw new Error(buildErrorMessage("Could not refresh running-project cache", result, "Request failed"));
    }

    statusBox.textContent = `Refreshed running-project cache. Cleared ${result.clearedCount || 0} stale entr${result.clearedCount === 1 ? "y" : "ies"}.`;
    await loadRunningProjects();
  } catch (error) {
    const message = `Cache refresh failed: ${error.message}`;
    statusBox.textContent = message;
    showErrorCard(message);
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
    const mergeBadgeHtml = run.merged_at
      ? '<span class="merge-badge merge-badge--merged">merged</span>'
      : '<span class="merge-badge merge-badge--not-merged">not merged</span>';
    const executionMode = run.execution_mode === "write" ? "Write Mode" : "Read Mode";
    const title = run.change_title ? `\nTitle: ${run.change_title}` : "";
    button.classList.toggle("run-item-unmerged", !run.merged_at);
    button.innerHTML = `
      <div>#${escapeHtml(run.id)} · ${escapeHtml(run.project_name)} · ${escapeHtml(executionMode)} · ${escapeHtml(run.branch_name || "(no branch)")} · ${mergeBadgeHtml}</div>
      <div>${escapeHtml(title ? title.trim() : "")}</div>
      <div>${escapeHtml(promptPreview || "(no prompt)")}</div>
    `;
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
  const projects = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(buildErrorMessage("Could not load projects", projects, "Request failed"));
  }

  projectSelect.innerHTML = "";
  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.name;
    option.textContent = project.name;
    projectSelect.appendChild(option);
  }

  restoreEditorState(projects);
  updateProjectActionState();
}

async function loadRuns() {
  const response = await fetch("/api/runs");
  const runs = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(buildErrorMessage("Could not load recent runs", runs, "Request failed"));
  }

  allRuns = runs;
  filterRuns();
}

async function pullSelectedRepository() {
  const projectName = projectSelect.value;

  if (!projectName) {
    statusBox.textContent = "Select a repository before pulling.";
    return;
  }

  hideErrorCard();
  saveEditorState();
  isPullRequestInFlight = true;
  pullButton.disabled = true;
  runButton.disabled = true;
  pullButton.textContent = "Pulling...";
  statusBox.textContent = `Pulling latest changes for ${projectName}...`;

  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectName)}/pull`, {
      method: "POST"
    });
    const result = await parseJsonResponse(response);

    if (!response.ok) {
      const message = buildErrorMessage("Git pull failed", result, "Unknown error.");
      statusBox.textContent = message;
      showErrorCard(message);
      return;
    }

    const summary = (result.stdout || "Git pull finished.").trim().split("\n").find(Boolean);
    const branchStatus = (result.gitStatus || "").split("\n").find(Boolean);
    statusBox.textContent = [summary, branchStatus].filter(Boolean).join(" ");
  } catch (error) {
    const message = `Git pull failed: ${error.message}`;
    statusBox.textContent = message;
    showErrorCard(message);
  } finally {
    isPullRequestInFlight = false;
    pullButton.textContent = "Git Pull Selected Repo";
    await loadRunningProjects();
  }
}

async function pastePromptFromClipboard() {
  try {
    const clipboardText = await navigator.clipboard.readText();
    promptInput.value = clipboardText;
    saveEditorState();
    statusBox.textContent = "Prompt replaced with clipboard contents.";
  } catch (error) {
    const message = `Clipboard paste failed: ${error.message}`;
    statusBox.textContent = message;
    showErrorCard(message);
  }
}

runButton.addEventListener("click", async () => {
  const projectName = projectSelect.value;
  const prompt = promptInput.value.trim();
  const executionMode = executionModeSelect.value;

  if (!projectName || !prompt || runButton.disabled) return;

  hideErrorCard();
  saveEditorState();
  isRunningRequestInFlight = true;
  activeRunStartedAt = Date.now();
  startRunTimer();
  updateProjectActionState();
  statusBox.textContent = "Preparing run...";
  const streamId = createRunStreamId();
  startRunStream(streamId);

  try {
    const response = await fetch("/api/run-test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ projectName, prompt, executionMode, streamId })
    });

    const result = await parseJsonResponse(response);

    if (!response.ok) {
      renderStatus(result);
      showErrorCard(buildErrorMessage("Run failed", result, "Unknown server error."));
      return;
    }

    if (result.creditsRemaining !== undefined) {
      creditsBox.textContent = `Credits Remaining: ${result.creditsRemaining}`;
    }

    renderStatus(result);
    await loadRuns();
  } catch (error) {
    const message = `Request failed: ${error.message}`;
    statusBox.textContent = message;
    showErrorCard(message);
  } finally {
    isRunningRequestInFlight = false;
    closeRunStream();
    stopRunTimer();
    announceRunComplete();
    await loadRunningProjects();
  }
});

pullButton.addEventListener("click", pullSelectedRepository);
pasteClipboardButton.addEventListener("click", pastePromptFromClipboard);
clearStateButton.addEventListener("click", async () => {
  clearEditorState();
  await refreshRunningProjects();
  statusBox.textContent = "Saved form state cleared and running-project cache refreshed.";
});
muteToggleButton.addEventListener("click", () => {
  setTtsMuted(!isTtsMuted);
  statusBox.textContent = isTtsMuted ? "TTS muted." : "TTS unmuted.";
});

[projectSelect, executionModeSelect, promptInput].forEach((element) => {
  element.addEventListener("change", saveEditorState);
  element.addEventListener("input", saveEditorState);
});

projectSelect.addEventListener("change", updateProjectActionState);
runSearchInput.addEventListener("input", filterRuns);

(async () => {
  try {
    loadMutedState();
    renderMuteToggle();
    await Promise.all([loadProjects(), loadRuns(), loadRunningProjects()]);
  } catch (error) {
    const message = `Initial page load failed: ${error.message}`;
    statusBox.textContent = message;
    showErrorCard(message);
  }
})();
