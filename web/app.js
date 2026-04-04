const projectSelect = document.getElementById("projectSelect");
const baseBranchSelect = document.getElementById("baseBranchSelect");
const branchHint = document.getElementById("branchHint");
const pullButton = document.getElementById("pullButton");
const executionModeSelect = document.getElementById("executionModeSelect");
const promptInput = document.getElementById("promptInput");
const contextBundleSelect = document.getElementById("contextBundleSelect");
const contextBundleHint = document.getElementById("contextBundleHint");
const runButton = document.getElementById("runButton");
const pasteClipboardButton = document.getElementById("pasteClipboardButton");
const clearStateButton = document.getElementById("clearStateButton");
const runTimer = document.getElementById("runTimer");
const runningProjectHint = document.getElementById("runningProjectHint");
const runsList = document.getElementById("runsList");
const statusBox = document.getElementById("statusBox");
const runSearchInput = document.getElementById("runSearchInput");
const runStatusFilterSelect = document.getElementById("runStatusFilterSelect");
const creditsBox = document.getElementById("creditsBox");
const errorCard = document.getElementById("errorCard");
const errorCardMessage = document.getElementById("errorCardMessage");
const manageFeaturesLink = document.getElementById("manageFeaturesLink");
const indexLockHint = document.getElementById("indexLockHint");

const EDITOR_STATE_KEY = "mini-codex-editor-state";
let allRuns = [];
let runningProjects = new Set();
let isRunningRequestInFlight = false;
let isPullRequestInFlight = false;
let activeRunStream = null;
let activeRunStartedAt = null;
let runTimerInterval = null;
let lastBranchLoadRequestId = 0;
let loadRunsRequestId = 0;
let loadContextBundlesRequestId = 0;
let activeAutomationLock = null;

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

function formatRunDuration(durationMs) {
  if (typeof durationMs !== "number" || durationMs < 0) {
    return "unknown";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  const totalSeconds = Math.round(durationMs / 100) / 10;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

function normalizeCompletionStatus(status) {
  if (status === "complete" || status === "incomplete") {
    return status;
  }
  return "unknown";
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
    baseBranch: baseBranchSelect.value || "",
    executionMode: executionModeSelect.value || "read",
    prompt: promptInput.value,
    contextBundleId: contextBundleSelect.value || ""
  };
}

function saveEditorState() {
  localStorage.setItem(EDITOR_STATE_KEY, JSON.stringify(getEditorState()));
  updateManageFeaturesLink();
}

function clearBranchOptions() {
  baseBranchSelect.innerHTML = "";
  baseBranchSelect.disabled = true;
}

function clearEditorState() {
  localStorage.removeItem(EDITOR_STATE_KEY);
  promptInput.value = "";
  executionModeSelect.value = "read";
  contextBundleSelect.value = "";
  if (projectSelect.options.length > 0) {
    projectSelect.selectedIndex = 0;
  }
  clearBranchOptions();
  branchHint.textContent = "";
  updateManageFeaturesLink();
}

function getSavedEditorState() {
  const rawState = localStorage.getItem(EDITOR_STATE_KEY);
  if (!rawState) return null;

  try {
    return JSON.parse(rawState);
  } catch (error) {
    console.warn("Unable to restore editor state", error);
    return null;
  }
}

function restoreEditorState(projects) {
  const state = getSavedEditorState();
  if (!state) return null;

  if (state.executionMode) {
    executionModeSelect.value = state.executionMode;
  }

  if (state.prompt) {
    promptInput.value = state.prompt;
  }

  if (state.projectName && projects.some((project) => project.name === state.projectName)) {
    projectSelect.value = state.projectName;
  }

  return state;
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

function pickDefaultBranch(branches, currentBranch, preferredBranch) {
  if (preferredBranch && branches.includes(preferredBranch)) {
    return preferredBranch;
  }

  if (currentBranch && branches.includes(currentBranch)) {
    return currentBranch;
  }

  if (branches.includes("main")) {
    return "main";
  }

  return branches[0] || "";
}

function getScopeFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    projectName: (params.get("projectName") || "").trim(),
    baseBranch: (params.get("baseBranch") || "").trim()
  };
}

function getSelectedScope() {
  return {
    projectName: projectSelect.value || "",
    baseBranch: baseBranchSelect.value || ""
  };
}

function isIndexLockedByFeatureAutomation() {
  return Boolean(activeAutomationLock?.isActive);
}

function updateManageFeaturesLink() {
  const { projectName, baseBranch } = getSelectedScope();
  const query = new URLSearchParams();
  if (projectName) {
    query.set("projectName", projectName);
  }
  if (baseBranch) {
    query.set("baseBranch", baseBranch);
  }

  const queryString = query.toString();
  manageFeaturesLink.href = queryString ? `/features.html?${queryString}` : "/features.html";
}

function updateProjectActionState() {
  const projectName = projectSelect.value;
  const branchName = baseBranchSelect.value;
  const isProjectRunning = projectName && runningProjects.has(projectName);
  const isLockedByFeatureAutomation = isIndexLockedByFeatureAutomation();
  const isRunActive = isRunningRequestInFlight || isProjectRunning;
  const hasValidBranch = Boolean(projectName && branchName);
  const isEditorFrozen = isLockedByFeatureAutomation;

  runningProjectHint.textContent = isProjectRunning && !isLockedByFeatureAutomation
    ? `"${projectName}" is currently running. Wait for it to finish.`
    : "";

  if (isLockedByFeatureAutomation) {
    const lockProject = activeAutomationLock.projectName || "unknown project";
    const lockBranch = activeAutomationLock.baseBranch || "unknown branch";
    indexLockHint.textContent = `Feature automation is in progress on ${lockProject} (${lockBranch}). Wait for it to finish before editing on this page.`;
    indexLockHint.classList.remove("hidden");
  } else {
    indexLockHint.textContent = "";
    indexLockHint.classList.add("hidden");
  }

  projectSelect.disabled = isEditorFrozen;
  baseBranchSelect.disabled = isEditorFrozen || !projectName || baseBranchSelect.options.length === 0;
  executionModeSelect.disabled = isEditorFrozen;
  promptInput.disabled = isEditorFrozen;
  contextBundleSelect.disabled = isEditorFrozen;
  pasteClipboardButton.disabled = isEditorFrozen;
  clearStateButton.disabled = isEditorFrozen;
  manageFeaturesLink.classList.toggle("is-disabled-link", isEditorFrozen);
  manageFeaturesLink.setAttribute("aria-disabled", isEditorFrozen ? "true" : "false");

  runButton.disabled = isEditorFrozen || !projectName || !hasValidBranch || isRunActive;
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
    pullButton.disabled = isEditorFrozen || !projectName || isProjectRunning;
  }

  updateManageFeaturesLink();
}

function formatContextBundleOption(bundle) {
  const title = String(bundle?.title || "").trim() || "Untitled Bundle";
  const intendedUse = String(bundle?.intended_use || "").trim();
  const summary = String(bundle?.summary || "").trim();

  const meta = [intendedUse, summary].filter(Boolean).join(" | ");
  return meta ? `${title} - ${meta}` : title;
}

async function loadContextBundles() {
  const requestId = ++loadContextBundlesRequestId;

  contextBundleHint.textContent = "Loading context bundles...";
  contextBundleSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "No context bundle";
  contextBundleSelect.appendChild(defaultOption);

  try {
    const response = await fetch("/api/context-bundles?includeParts=false");
    const result = await parseJsonResponse(response);

    if (requestId !== loadContextBundlesRequestId) {
      return;
    }

    if (!response.ok) {
      throw new Error(buildErrorMessage("Could not load context bundles", result, "Request failed"));
    }

    const bundles = Array.isArray(result) ? result : [];

    for (const bundle of bundles) {
      const bundleId = Number.parseInt(bundle?.id, 10);
      if (!Number.isInteger(bundleId) || bundleId <= 0) {
        continue;
      }

      const option = document.createElement("option");
      option.value = String(bundleId);
      option.textContent = formatContextBundleOption(bundle);
      contextBundleSelect.appendChild(option);
    }

    const savedState = getSavedEditorState();
    const savedContextBundleId = String(savedState?.contextBundleId || "").trim();
    if (savedContextBundleId && [...contextBundleSelect.options].some((option) => option.value === savedContextBundleId)) {
      contextBundleSelect.value = savedContextBundleId;
    } else {
      contextBundleSelect.value = "";
    }

    contextBundleHint.textContent = bundles.length > 0
      ? "Choose one saved bundle to prepend reusable context, or leave unselected."
      : "No saved bundles yet. Runs will proceed without bundle context.";
  } catch (error) {
    if (requestId !== loadContextBundlesRequestId) {
      return;
    }

    contextBundleSelect.value = "";
    contextBundleHint.textContent = "Context bundles are unavailable. Runs can continue without one.";
    statusBox.textContent = `Context bundle load failed: ${error.message}`;
    showErrorCard(`Context bundle load failed: ${error.message}`);
  } finally {
    if (requestId === loadContextBundlesRequestId) {
      updateProjectActionState();
      saveEditorState();
    }
  }
}

async function loadBranchesForSelectedProject(preferredBranch = "") {
  const projectName = projectSelect.value;
  const requestId = ++lastBranchLoadRequestId;

  if (!projectName) {
    clearBranchOptions();
    branchHint.textContent = "Select a project to choose a base branch.";
    updateProjectActionState();
    return;
  }

  branchHint.textContent = "Loading branches...";
  clearBranchOptions();
  updateProjectActionState();

  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectName)}/branches`);
    const result = await parseJsonResponse(response);

    if (requestId !== lastBranchLoadRequestId) {
      return;
    }

    if (!response.ok) {
      throw new Error(buildErrorMessage("Could not load branches", result, "Request failed"));
    }

    const branches = (result.branches || [])
      .map((entry) => entry?.name)
      .filter((name) => typeof name === "string" && name.trim())
      .map((name) => name.trim());

    if (!branches.length) {
      throw new Error(`No local branches found for ${projectName}.`);
    }

    baseBranchSelect.innerHTML = "";
    for (const branchName of branches) {
      const option = document.createElement("option");
      option.value = branchName;
      option.textContent = branchName;
      baseBranchSelect.appendChild(option);
    }

    const selectedBranch = pickDefaultBranch(branches, result.currentBranch || "", preferredBranch);
    baseBranchSelect.value = selectedBranch;
    baseBranchSelect.disabled = false;
    branchHint.textContent = "";
  } catch (error) {
    if (requestId !== lastBranchLoadRequestId) {
      return;
    }

    clearBranchOptions();
    branchHint.textContent = `Could not load branches for ${projectName}.`;
    statusBox.textContent = `Branch load failed: ${error.message}`;
    showErrorCard(`Branch load failed: ${error.message}`);
  } finally {
    if (requestId === lastBranchLoadRequestId) {
      updateProjectActionState();
      saveEditorState();
    }
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

async function loadAutomationLock() {
  const response = await fetch("/api/automation-lock");
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(buildErrorMessage("Could not load automation lock", result, "Request failed"));
  }

  activeAutomationLock = result;
  updateProjectActionState();
  renderRunsList(allRuns);
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
  const isFrozen = isIndexLockedByFeatureAutomation();

  if (!runs.length) {
    const li = document.createElement("li");
    li.textContent = "No matching runs.";
    runsList.appendChild(li);
    return;
  }

  for (const run of runs) {
    const li = document.createElement("li");
    li.className = "run-card";

    const openButton = document.createElement("button");
    openButton.className = "run-card__open-button";
    const promptPreview = `${(run.prompt || "").replace(/\s+/g, " ").slice(0, 120)}${(run.prompt || "").length > 120 ? "..." : ""}`;
    const mergeBadgeHtml = run.merged_at
      ? '<span class="merge-badge merge-badge--merged">merged</span>'
      : '<span class="merge-badge merge-badge--not-merged">not merged</span>';
    const executionMode = run.execution_mode === "write" ? "Write Mode" : "Read Mode";
    const title = run.change_title ? run.change_title.trim() : "";
    const branchName = run.branch_name || run.branchName || "(no branch)";

    const completionStatus = normalizeCompletionStatus(run.completion_status);
    const duration = formatRunDuration(run.duration_ms);

    openButton.classList.toggle("run-item-unmerged", !run.merged_at);
    openButton.innerHTML = `
      <div>#${escapeHtml(run.id)} | ${escapeHtml(run.project_name)} | ${escapeHtml(executionMode)} | ${escapeHtml(branchName)} | ${mergeBadgeHtml}</div>
      <div>Completion: ${escapeHtml(completionStatus)} | Duration: ${escapeHtml(duration)}</div>
      <div>${escapeHtml(title || "(no title)")}</div>
      <div>${escapeHtml(promptPreview || "(no prompt)")}</div>
    `;
    openButton.onclick = () => {
      saveEditorState();
      window.location.href = `/run-details.html?id=${run.id}`;
    };

    const actions = document.createElement("div");
    actions.className = "run-card__actions";

    const archiveButton = document.createElement("button");
    archiveButton.type = "button";
    archiveButton.className = "secondary-button";
    archiveButton.textContent = run.archived ? "Unarchive" : "Archive";
    archiveButton.disabled = isFrozen;
    archiveButton.onclick = async () => {
      if (isFrozen) return;
      const endpoint = run.archived ? "unarchive" : "archive";
      archiveButton.disabled = true;
      deleteButton.disabled = true;
      hideErrorCard();

      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}/${endpoint}`, {
          method: "POST"
        });
        const result = await parseJsonResponse(response);

        if (!response.ok) {
          throw new Error(buildErrorMessage(`Could not ${endpoint} run`, result, "Request failed"));
        }

        statusBox.textContent = `Run #${run.id} ${run.archived ? "unarchived" : "archived"}.`;
        await loadRuns();
      } catch (error) {
        const message = `${run.archived ? "Unarchive" : "Archive"} failed: ${error.message}`;
        statusBox.textContent = message;
        showErrorCard(message);
      } finally {
        archiveButton.disabled = false;
        deleteButton.disabled = false;
      }
    };

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger-button";
    deleteButton.textContent = "Delete";
    deleteButton.disabled = isFrozen;
    deleteButton.onclick = async () => {
      if (isFrozen) return;
      const confirmation = window.prompt(`Type "Delete" to delete run #${run.id}.`);
      if (confirmation !== "Delete") {
        statusBox.textContent = `Delete canceled for run #${run.id}.`;
        return;
      }

      archiveButton.disabled = true;
      deleteButton.disabled = true;
      hideErrorCard();

      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}`, {
          method: "DELETE"
        });
        const result = await parseJsonResponse(response);

        if (!response.ok) {
          throw new Error(buildErrorMessage("Could not delete run", result, "Request failed"));
        }

        statusBox.textContent = `Run #${run.id} deleted.`;
        await loadRuns();
      } catch (error) {
        const message = `Delete failed: ${error.message}`;
        statusBox.textContent = message;
        showErrorCard(message);
      } finally {
        archiveButton.disabled = false;
        deleteButton.disabled = false;
      }
    };

    actions.appendChild(archiveButton);
    actions.appendChild(deleteButton);

    li.appendChild(openButton);
    li.appendChild(actions);
    runsList.appendChild(li);
  }
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

  const restoredState = restoreEditorState(projects);
  const queryScope = getScopeFromQuery();
  if (queryScope.projectName && projects.some((project) => project.name === queryScope.projectName)) {
    projectSelect.value = queryScope.projectName;
  }

  const preferredBranch = queryScope.baseBranch || restoredState?.baseBranch || "";
  await loadBranchesForSelectedProject(preferredBranch);
  updateProjectActionState();
}

async function loadRuns() {
  const requestId = ++loadRunsRequestId;
  const search = runSearchInput.value.trim();
  const status = runStatusFilterSelect.value || "active";
  const query = new URLSearchParams();

  if (search) {
    query.set("search", search);
  }
  query.set("status", status);

  const response = await fetch(`/api/runs?${query.toString()}`);
  const runs = await parseJsonResponse(response);

  if (requestId !== loadRunsRequestId) {
    return;
  }

  if (!response.ok) {
    throw new Error(buildErrorMessage("Could not load recent runs", runs, "Request failed"));
  }

  allRuns = runs;
  renderRunsList(allRuns);
}

async function pullSelectedRepository() {
  const projectName = projectSelect.value;
  if (isIndexLockedByFeatureAutomation()) {
    statusBox.textContent = "Editor is locked while feature automation is running.";
    return;
  }

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
  if (isIndexLockedByFeatureAutomation()) {
    statusBox.textContent = "Editor is locked while feature automation is running.";
    return;
  }

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
  if (isIndexLockedByFeatureAutomation()) {
    statusBox.textContent = "Editor is locked while feature automation is running.";
    return;
  }

  const projectName = projectSelect.value;
  const baseBranch = baseBranchSelect.value;
  const prompt = promptInput.value.trim();
  const executionMode = executionModeSelect.value;
  const contextBundleId = Number.parseInt(contextBundleSelect.value, 10);
  const selectedContextBundleId = Number.isInteger(contextBundleId) && contextBundleId > 0
    ? contextBundleId
    : null;

  if (!projectName || !baseBranch || !prompt || runButton.disabled) return;

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
      body: JSON.stringify({
        projectName,
        baseBranch,
        prompt,
        executionMode,
        contextBundleId: selectedContextBundleId,
        streamId
      })
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
manageFeaturesLink.addEventListener("click", (event) => {
  if (isIndexLockedByFeatureAutomation()) {
    event.preventDefault();
    statusBox.textContent = "Feature automation is in progress. Wait for completion before navigating.";
    return;
  }

  saveEditorState();
  updateManageFeaturesLink();
});
clearStateButton.addEventListener("click", async () => {
  clearEditorState();
  await loadBranchesForSelectedProject();
  await refreshRunningProjects();
  statusBox.textContent = "Saved form state cleared and running-project cache refreshed.";
});

[projectSelect, baseBranchSelect, executionModeSelect, promptInput, contextBundleSelect].forEach((element) => {
  element.addEventListener("change", saveEditorState);
  element.addEventListener("input", saveEditorState);
});

projectSelect.addEventListener("change", async () => {
  hideErrorCard();
  await loadBranchesForSelectedProject();
  updateProjectActionState();
});

baseBranchSelect.addEventListener("change", updateProjectActionState);
runSearchInput.addEventListener("input", () => {
  loadRuns().catch((error) => {
    const message = `Run search failed: ${error.message}`;
    statusBox.textContent = message;
    showErrorCard(message);
  });
});
runStatusFilterSelect.addEventListener("change", () => {
  loadRuns().catch((error) => {
    const message = `Run filter failed: ${error.message}`;
    statusBox.textContent = message;
    showErrorCard(message);
  });
});

setInterval(() => {
  loadAutomationLock().catch((error) => {
    const message = `Automation lock refresh failed: ${error.message}`;
    statusBox.textContent = message;
    showErrorCard(message);
  });
}, 3000);

(async () => {
  try {
    await Promise.all([loadProjects(), loadContextBundles(), loadRuns(), loadRunningProjects(), loadAutomationLock()]);
  } catch (error) {
    const message = `Initial page load failed: ${error.message}`;
    statusBox.textContent = message;
    showErrorCard(message);
  }
})();

