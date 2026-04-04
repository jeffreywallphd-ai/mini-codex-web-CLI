const backButton = document.getElementById("backButton");
const createStatusBox = document.getElementById("createStatusBox");
const createFeatureCardToggle = document.getElementById("createFeatureCardToggle");
const createFeatureCardContent = document.getElementById("createFeatureCardContent");
const manifestCardToggle = document.getElementById("manifestCardToggle");
const manifestCardContent = document.getElementById("manifestCardContent");
const featureNameInput = document.getElementById("featureNameInput");
const featureDescriptionInput = document.getElementById("featureDescriptionInput");
const addEpicButton = document.getElementById("addEpicButton");
const saveFeatureButton = document.getElementById("saveFeatureButton");
const epicDraftsContainer = document.getElementById("epicDraftsContainer");
const manifestJsonInput = document.getElementById("manifestJsonInput");
const createManifestButton = document.getElementById("createManifestButton");
const incompleteSearchInput = document.getElementById("incompleteSearchInput");
const clearIncompleteSearchButton = document.getElementById("clearIncompleteSearchButton");
const featureQueueCardToggle = document.getElementById("featureQueueCardToggle");
const featureQueueCardContent = document.getElementById("featureQueueCardContent");
const featureQueueContainer = document.getElementById("featureQueueContainer");
const runFeatureQueueButton = document.getElementById("runFeatureQueueButton");
const clearFeatureQueueButton = document.getElementById("clearFeatureQueueButton");
const completeSearchInput = document.getElementById("completeSearchInput");
const clearCompleteSearchButton = document.getElementById("clearCompleteSearchButton");
const incompleteListContainer = document.getElementById("incompleteListContainer");
const completeListContainer = document.getElementById("completeListContainer");
const scopeHint = document.getElementById("scopeHint");
const EDITOR_STATE_KEY = "mini-codex-editor-state";
const AUTOMATION_UI_STATE_KEY = "mini-codex-feature-automation-ui-state";

let allFeatures = [];
const featureAutomationStartInFlight = new Set();
const epicAutomationStartInFlight = new Set();
const storyAutomationInFlight = new Set();
const openCards = new Set();
let automationScope = {
  projectName: "",
  baseBranch: ""
};
let globalAutomationLock = null;
let globalAutomationStatus = null;
let epicDraftId = 0;
let storyDraftId = 0;
const epicDrafts = [];
let automationContextBundleOptions = [];
let loadAutomationContextBundlesRequestId = 0;
const stopRunForIncompleteStoriesByFeatureId = new Map();
const stopRunForIncompleteStoriesByEpicId = new Map();
const featureAutomationQueue = [];
let isFeatureQueueRunning = false;
let activeFeatureQueueFeatureId = null;
let isFeatureQueueAdvanceInFlight = false;
let lastAutomationUiSignature = "";
let lastScrolledActiveStoryId = null;

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

function isStoryComplete(story) {
  return normalizeStoryCompletionStatus(story) === "complete";
}

function normalizeStoryCompletionStatus(story = {}) {
  const rawStatus = story?.COMPLETION_STATUS
    ?? story?.completion_status
    ?? story?.run_completion_status
    ?? null;

  if (rawStatus === "complete") {
    return "complete";
  }
  if (rawStatus === "incomplete") {
    return "incomplete";
  }

  if (story?.is_complete === true || story?.is_complete === 1) {
    return "complete";
  }
  if (story?.is_complete === false || story?.is_complete === 0) {
    return "incomplete";
  }

  return "unknown";
}

function isStoryEligibleForAutomation(story) {
  return normalizeStoryCompletionStatus(story) !== "complete";
}

function isEpicComplete(epic) {
  const stories = Array.isArray(epic?.stories) ? epic.stories : [];
  if (!stories.length) return false;
  return stories.every((story) => isStoryComplete(story));
}

function isFeatureComplete(feature) {
  const epics = Array.isArray(feature?.epics) ? feature.epics : [];
  if (!epics.length) return false;
  return epics.every((epic) => isEpicComplete(epic));
}

function getEpicStatus(epic) {
  return isEpicComplete(epic) ? "complete" : "incomplete";
}

function getFeatureStatus(feature) {
  return isFeatureComplete(feature) ? "complete" : "incomplete";
}

function getStoryStatus(story) {
  return isStoryComplete(story) ? "complete" : "incomplete";
}

function getEditorState() {
  const rawState = localStorage.getItem(EDITOR_STATE_KEY);
  if (!rawState) return {};

  try {
    return JSON.parse(rawState) || {};
  } catch (error) {
    return {};
  }
}

function getAutomationUiState() {
  const rawState = localStorage.getItem(AUTOMATION_UI_STATE_KEY);
  if (!rawState) return {};

  try {
    const parsed = JSON.parse(rawState);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (error) {
    return {};
  }
}

function saveAutomationUiState(nextState) {
  localStorage.setItem(AUTOMATION_UI_STATE_KEY, JSON.stringify(nextState || {}));
}

function getAutomationScopeKey(scope = {}) {
  const projectName = String(scope.projectName || "").trim();
  const baseBranch = String(scope.baseBranch || "").trim();
  if (!projectName || !baseBranch) {
    return "";
  }
  return `${projectName}::${baseBranch}`;
}

function readPersistedAutomationState(scope = automationScope) {
  const scopeKey = getAutomationScopeKey(scope);
  if (!scopeKey) {
    return null;
  }

  const state = getAutomationUiState();
  const value = state[scopeKey];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function persistAutomationStateSnapshot(scope = automationScope, updates = {}) {
  const scopeKey = getAutomationScopeKey(scope);
  if (!scopeKey) {
    return;
  }

  const state = getAutomationUiState();
  const currentScopeState = readPersistedAutomationState(scope) || {};
  const mergedScopeState = {
    ...currentScopeState,
    ...updates
  };

  state[scopeKey] = mergedScopeState;
  saveAutomationUiState(state);
}

function parsePersistedAutomationRunId(scope = automationScope) {
  const persistedState = readPersistedAutomationState(scope);
  const persistedRunId = Number.parseInt(persistedState?.lastAutomationRunId, 10);
  if (!Number.isInteger(persistedRunId) || persistedRunId <= 0) {
    return null;
  }
  return persistedRunId;
}

function hydrateAutomationStatusFromPersistence() {
  const persistedState = readPersistedAutomationState();
  if (!persistedState) {
    globalAutomationStatus = null;
    return;
  }

  const statusSnapshot = persistedState.lastAutomationStatus;
  if (!statusSnapshot || typeof statusSnapshot !== "object" || Array.isArray(statusSnapshot)) {
    globalAutomationStatus = null;
    return;
  }

  globalAutomationStatus = statusSnapshot;
}

function readScopeFromUrlOrState() {
  const params = new URLSearchParams(window.location.search);
  const state = getEditorState();
  const projectName = String(params.get("projectName") || state.projectName || "").trim();
  const baseBranch = String(params.get("baseBranch") || state.baseBranch || "").trim();
  return { projectName, baseBranch };
}

function syncScopeIntoEditorState(scope) {
  const state = getEditorState();
  const mergedState = {
    ...state,
    projectName: scope.projectName,
    baseBranch: scope.baseBranch
  };
  localStorage.setItem(EDITOR_STATE_KEY, JSON.stringify(mergedState));
}

function getStoryRunStatusLabel(story) {
  const runStatus = String(story?.run_status || "").toLowerCase();
  if (runStatus === "complete") {
    return "Run status: complete";
  }
  if (runStatus === "incomplete") {
    return "Run status: incomplete";
  }
  if (runStatus === "in_progress") {
    return "Run status: in progress";
  }
  return "Run status: not started";
}

function getAutomationStatusLabel(status) {
  if (status === "running") return "Running";
  if (status === "completed") return "Completed";
  if (status === "stopped") return "Stopped";
  if (status === "failed") return "Failed";
  return "Not Started";
}

function renderScopeHint() {
  if (!automationScope.projectName || !automationScope.baseBranch) {
    scopeHint.textContent = "Project and base branch are required. Return to the editor page and select them first.";
    return;
  }

  scopeHint.textContent = `Project: ${automationScope.projectName} | Base branch: ${automationScope.baseBranch}`;
}

function isAnyAutomationInFlight() {
  return featureAutomationStartInFlight.size > 0
    || epicAutomationStartInFlight.size > 0
    || storyAutomationInFlight.size > 0
    || Boolean(globalAutomationLock?.isActive);
}

function isAutomationAlreadyRunningError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("already running");
}

function matchesQuery(feature, query) {
  if (!query) return true;

  const normalizedQuery = query.toLowerCase();
  const includesText = (value) => String(value || "").toLowerCase().includes(normalizedQuery);

  if (includesText(feature.name) || includesText(feature.description)) {
    return true;
  }

  for (const epic of feature.epics || []) {
    if (includesText(epic.name) || includesText(epic.description)) {
      return true;
    }

    for (const story of epic.stories || []) {
      if (includesText(story.name) || includesText(story.description)) {
        return true;
      }
    }
  }

  return false;
}

function createTextNode(tagName, className, value) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

function createDescription(content, text, options = {}) {
  const descriptionText = String(text || "(no description)");
  const collapsible = Boolean(options?.collapsible);
  if (!collapsible) {
    content.appendChild(createTextNode("p", "card-description", descriptionText));
    return;
  }

  const description = document.createElement("p");
  description.className = "card-description card-description--collapsible is-collapsed";
  description.textContent = descriptionText;
  content.appendChild(description);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "description-toggle";
  toggle.textContent = "Show more";
  toggle.addEventListener("click", () => {
    const isCollapsed = description.classList.toggle("is-collapsed");
    toggle.textContent = isCollapsed ? "Show more" : "Show less";
  });
  content.appendChild(toggle);
}

function formatContextBundleOption(bundle) {
  const title = String(bundle?.title || "").trim() || "Untitled Bundle";
  const intendedUse = String(bundle?.intended_use || "").trim();
  const summary = String(bundle?.summary || "").trim();
  const usageCue = formatContextBundleUsageCue(bundle);
  const meta = [intendedUse, summary, usageCue].filter(Boolean).join(" | ");
  return meta ? `${title} - ${meta}` : title;
}

function formatBundleUsageCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function formatBundleLastUsedAt(value) {
  const timestamp = typeof value === "string" && value.trim()
    ? value.trim()
    : "";
  if (!timestamp) {
    return "(never)";
  }

  const parsedTimestamp = Date.parse(timestamp);
  if (!Number.isFinite(parsedTimestamp)) {
    return timestamp;
  }

  return new Date(parsedTimestamp).toLocaleString();
}

function formatContextBundleUsageCue(bundle) {
  const recentSuccessCount = formatBundleUsageCount(bundle?.usage_recent_success_count);
  const lastUsed = formatBundleLastUsedAt(bundle?.last_used_at);
  return `Last used: ${lastUsed} | Recent success (30d): ${recentSuccessCount}`;
}

function normalizeProjectAffinityValue(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/\\/g, "/").replace(/\.git$/, "");
  if (!normalized) {
    return null;
  }

  const segments = normalized.split("/").filter(Boolean);
  return {
    full: normalized,
    leaf: segments[segments.length - 1] || normalized
  };
}

function resolveContextBundleProjectAffinityWarning(bundleProjectName, selectedProjectName) {
  const bundleAffinity = normalizeProjectAffinityValue(bundleProjectName);
  const selectedProjectAffinity = normalizeProjectAffinityValue(selectedProjectName);
  if (!bundleAffinity || !selectedProjectAffinity) {
    return "";
  }

  if (bundleAffinity.full === selectedProjectAffinity.full || bundleAffinity.leaf === selectedProjectAffinity.leaf) {
    return "";
  }

  return `Warning: bundle project affinity is "${bundleProjectName}", but current project is "${selectedProjectName}". You can still proceed.`;
}

function parseSelectedContextBundleId(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function createAutomationContextBundleSelector({ idPrefix, automationLabel, disabled = false } = {}) {
  const selectorWrap = document.createElement("div");
  selectorWrap.className = "stack-gap";

  const selectId = `${idPrefix}-context-bundle-select`;
  const label = document.createElement("label");
  label.setAttribute("for", selectId);
  label.textContent = "Context Bundle (Optional)";
  selectorWrap.appendChild(label);

  const select = document.createElement("select");
  select.id = selectId;
  select.disabled = disabled;
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "No context bundle";
  select.appendChild(defaultOption);

  for (const bundle of automationContextBundleOptions) {
    const option = document.createElement("option");
    option.value = String(bundle.id);
    option.textContent = formatContextBundleOption(bundle);
    select.appendChild(option);
  }

  selectorWrap.appendChild(select);

  const hint = document.createElement("p");
  hint.className = "inline-hint";
  hint.textContent = automationContextBundleOptions.length > 0
    ? `Choose one bundle for this ${automationLabel} automation, or leave unselected.`
    : "No saved bundles yet. Automation runs will proceed without bundle context.";
  selectorWrap.appendChild(hint);

  const warning = document.createElement("p");
  warning.className = "inline-validation inline-validation--warning hidden";
  warning.textContent = "";
  selectorWrap.appendChild(warning);

  const refreshAffinityWarning = () => {
    const selectedBundleId = parseSelectedContextBundleId(select.value);
    const selectedBundle = automationContextBundleOptions.find((bundle) => bundle.id === selectedBundleId) || null;
    const bundleProjectAffinity = String(selectedBundle?.project_name || "").trim();
    const selectedProjectName = String(automationScope.projectName || "").trim();
    const message = resolveContextBundleProjectAffinityWarning(bundleProjectAffinity, selectedProjectName);

    warning.textContent = message;
    warning.classList.toggle("hidden", !message);
  };

  select.addEventListener("change", refreshAffinityWarning);
  refreshAffinityWarning();

  return { selectorWrap, select };
}

function parseRunId(value) {
  const runId = Number.parseInt(value, 10);
  if (!Number.isInteger(runId) || runId <= 0) {
    return null;
  }
  return runId;
}

function createRunDetailsLink(runId, label = "View run details") {
  const link = document.createElement("a");
  link.className = "inline-run-link";
  link.href = `/run-details.html?id=${encodeURIComponent(String(runId))}`;
  link.textContent = label;
  return link;
}

function appendRunDetailsInline(parent, runId) {
  const normalizedRunId = parseRunId(runId);
  if (!normalizedRunId) {
    const unavailable = document.createElement("span");
    unavailable.className = "inline-run-link-missing";
    unavailable.textContent = "Run details unavailable";
    parent.appendChild(unavailable);
    return;
  }

  parent.appendChild(createRunDetailsLink(normalizedRunId, `Run #${normalizedRunId}`));
}

function findStoryInFeatureTreeById(storyId) {
  const normalizedStoryId = Number.parseInt(storyId, 10);
  if (!Number.isInteger(normalizedStoryId) || normalizedStoryId <= 0) {
    return null;
  }

  for (const feature of allFeatures) {
    for (const epic of feature?.epics || []) {
      for (const story of epic?.stories || []) {
        if (Number(story?.id) === normalizedStoryId) {
          return story;
        }
      }
    }
  }

  return null;
}

function appendStoryRunLinkLine(content, story, { includeLabel = true } = {}) {
  const row = document.createElement("p");
  row.className = "inline-hint";

  if (includeLabel) {
    row.appendChild(document.createTextNode("Associated run: "));
  }

  appendRunDetailsInline(row, story?.run_id);
  content.appendChild(row);
}

function createCardHeader(name, status) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hier-card__toggle";

  const title = document.createElement("strong");
  title.textContent = name || "(untitled)";
  const statusNode = document.createElement("span");
  statusNode.className = `status-pill status-pill--${status}`;
  statusNode.textContent = status;

  button.appendChild(title);
  button.appendChild(statusNode);
  return button;
}

function createCollapsibleCard({ levelClass, cardKey, name, status, renderBody }) {
  const card = document.createElement("article");
  card.className = `hier-card ${levelClass}`;
  card.setAttribute("data-card-key", cardKey);
  const headerButton = createCardHeader(name, status);
  const content = document.createElement("div");
  content.className = "hier-card__content hidden";

  let isOpen = openCards.has(cardKey);

  const applyOpenState = () => {
    headerButton.classList.toggle("is-open", isOpen);
    content.classList.toggle("hidden", !isOpen);
    if (isOpen) {
      renderBody(content);
    } else {
      content.innerHTML = "";
    }
  };

  headerButton.addEventListener("click", () => {
    isOpen = !isOpen;
    if (isOpen) {
      openCards.add(cardKey);
    } else {
      openCards.delete(cardKey);
    }
    applyOpenState();
  });

  const header = document.createElement("header");
  header.className = "hier-card__header";
  header.appendChild(headerButton);
  card.appendChild(header);
  card.appendChild(content);
  applyOpenState();
  return card;
}

function wireStaticCardToggle(toggleButton, contentNode, { defaultOpen = false } = {}) {
  if (!toggleButton || !contentNode) return;

  let isOpen = defaultOpen;

  const applyState = () => {
    toggleButton.classList.toggle("is-open", isOpen);
    contentNode.classList.toggle("hidden", !isOpen);
    toggleButton.setAttribute("aria-expanded", String(isOpen));
  };

  toggleButton.addEventListener("click", () => {
    isOpen = !isOpen;
    applyState();
  });

  applyState();
}

async function startStoryAutomation(storyId, options = {}) {
  const projectName = automationScope.projectName;
  const baseBranch = automationScope.baseBranch;
  const contextBundleId = Number.isInteger(options?.contextBundleId) && options.contextBundleId > 0
    ? options.contextBundleId
    : null;
  if (!projectName || !baseBranch) {
    throw new Error("Select a project and branch on the editor page first, then retry automation.");
  }

  const response = await fetch(`/api/automation/start/story/${encodeURIComponent(String(storyId))}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectName,
      baseBranch,
      automationType: "story",
      targetId: storyId,
      storyId,
      contextBundleId
    })
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(formatAutomationStartError(result, "Unable to start story automation."));
  }

  return result;
}

function formatAutomationStartError(result, fallbackMessage) {
  const baseMessage = typeof result?.error === "string" && result.error.trim()
    ? result.error.trim()
    : String(fallbackMessage || "Unable to start automation.");
  const conflictRunId = parseRunId(result?.conflict?.automationRunId);
  if (result?.errorType === "automation_target_conflict" && conflictRunId) {
    return `${baseMessage} Active run #${conflictRunId}.`;
  }

  const validationErrors = Array.isArray(result?.validationErrors) ? result.validationErrors : [];
  if (!validationErrors.length) {
    return baseMessage;
  }

  const validationMessages = validationErrors
    .slice(0, 3)
    .map((item) => String(item?.message || "").trim())
    .filter(Boolean);
  if (!validationMessages.length) {
    return baseMessage;
  }

  return `${baseMessage} ${validationMessages.join(" ")}`;
}

function formatQueueCapSuffix(queue = {}) {
  const wasCapped = Boolean(queue?.wasCapped);
  if (!wasCapped) {
    return "";
  }
  const maxStories = Number.parseInt(queue?.maxStories, 10) || 125;
  const droppedStories = Number.parseInt(queue?.droppedStories, 10) || 0;
  return ` Queue capped to ${maxStories} stories; ${droppedStories} story(s) were deferred.`;
}

function assertAutomationStartScope(result, { automationType, targetId, enforceSingleStory = false } = {}) {
  const expectedType = String(automationType || "").trim().toLowerCase();
  const expectedTargetId = Number.parseInt(targetId, 10);
  const actualType = String(result?.automationRun?.automationType || "").trim().toLowerCase();
  const actualTargetId = Number.parseInt(result?.automationRun?.targetId, 10);

  if (!expectedType) {
    throw new Error("Missing expected automation type for scope validation.");
  }

  if (!Number.isInteger(expectedTargetId) || expectedTargetId <= 0) {
    throw new Error("Missing expected automation target id for scope validation.");
  }

  if (actualType !== expectedType) {
    throw new Error(`Automation scope mismatch: expected '${expectedType}' but received '${actualType || "unknown"}'.`);
  }

  if (!Number.isInteger(actualTargetId) || actualTargetId !== expectedTargetId) {
    throw new Error(`Automation target mismatch: expected '${expectedTargetId}' but received '${result?.automationRun?.targetId ?? "unknown"}'.`);
  }

  if (enforceSingleStory) {
    const totalStories = Number(result?.queue?.totalStories);
    if (totalStories !== 1) {
      throw new Error(`Story automation should queue exactly one story, but queued ${totalStories}.`);
    }
  }
}

function getIncompleteStoryCountForFeature(feature) {
  return getAutomationEligibleStorySummary(
    (feature?.epics || []).flatMap((epic) => epic?.stories || [])
  ).eligibleStoryCount;
}

function createCardKey(level, id) {
  return `${level}:${id}`;
}

function buildAutomationManagedCardKeySet(features = []) {
  const keys = new Set();
  for (const feature of Array.isArray(features) ? features : []) {
    keys.add(createCardKey("feature", feature.id));
    for (const epic of feature?.epics || []) {
      keys.add(createCardKey("epic", epic.id));
      for (const story of epic?.stories || []) {
        keys.add(createCardKey("story", story.id));
      }
    }
  }
  return keys;
}

function findFeatureById(featureId) {
  return allFeatures.find((feature) => Number(feature?.id) === Number(featureId)) || null;
}

function getAutomationEligibleStorySummary(stories = []) {
  const normalizedStories = Array.isArray(stories) ? stories : [];
  const eligibleStoryCount = normalizedStories.filter((story) => isStoryEligibleForAutomation(story)).length;

  return {
    totalStoryCount: normalizedStories.length,
    eligibleStoryCount
  };
}

function getAutomationIneligibleHint(entityType, summary = {}) {
  const normalizedEntityType = String(entityType || "item").trim().toLowerCase() || "item";
  const label = normalizedEntityType === "feature" || normalizedEntityType === "epic" || normalizedEntityType === "story"
    ? normalizedEntityType
    : "item";
  const totalStoryCount = Number.parseInt(summary.totalStoryCount, 10) || 0;

  if (totalStoryCount <= 0) {
    return `Automation unavailable: this ${label} has no stories to automate.`;
  }

  return `Automation unavailable: all stories in this ${label} are already complete.`;
}

function getFeatureAutomationStatus(feature) {
  const activeFeatureRun = Boolean(
    globalAutomationLock?.isActive
      && globalAutomationLock?.automationType === "feature"
      && Number(globalAutomationLock?.targetId) === Number(feature?.id)
  );
  if (activeFeatureRun) {
    return "running";
  }

  const rawStatus = String(feature?.feature_automation_status || "").trim().toLowerCase();
  if (rawStatus === "running") return "running";
  if (rawStatus === "completed") return "completed";
  if (rawStatus === "stopped") return "stopped";
  if (rawStatus === "failed") return "failed";

  return "not_started";
}

function getFeatureAutomationStatusLabel(status) {
  return getAutomationStatusLabel(status);
}

function getEpicAutomationStatus(epic) {
  const activeEpicRun = Boolean(
    globalAutomationLock?.isActive
      && globalAutomationLock?.automationType === "epic"
      && Number(globalAutomationLock?.targetId) === Number(epic?.id)
  );
  if (activeEpicRun) {
    return "running";
  }

  const rawStatus = String(epic?.epic_automation_status || "").trim().toLowerCase();
  if (rawStatus === "running") return "running";
  if (rawStatus === "completed") return "completed";
  if (rawStatus === "stopped") return "stopped";
  if (rawStatus === "failed") return "failed";

  return "not_started";
}

function getEpicAutomationStatusLabel(status) {
  return getAutomationStatusLabel(status);
}

function getCurrentExecutingStorySummary(automationType, targetId) {
  if (!globalAutomationLock?.isActive) {
    return null;
  }

  const activeRun = globalAutomationStatus?.automationRun;
  const currentItem = globalAutomationStatus?.queue?.currentItem;
  if (!activeRun || !currentItem) {
    return null;
  }

  if (String(activeRun.status || "").toLowerCase() !== "running") {
    return null;
  }

  if (String(activeRun.automationType || "").toLowerCase() !== String(automationType || "").toLowerCase()) {
    return null;
  }

  if (Number(activeRun.targetId) !== Number(targetId)) {
    return null;
  }

  const storyId = Number.parseInt(currentItem.storyId, 10);
  const storyTitle = String(currentItem.storyTitle || "").trim();
  if (!storyTitle && (!Number.isInteger(storyId) || storyId <= 0)) {
    return null;
  }

  return { storyId, storyTitle };
}

function getActiveQueueStoryRuntimeContext() {
  if (!globalAutomationLock?.isActive) {
    return null;
  }

  const activeRun = globalAutomationStatus?.automationRun;
  const currentItem = globalAutomationStatus?.queue?.currentItem;
  if (!activeRun || !currentItem) {
    return null;
  }

  if (String(activeRun.status || "").toLowerCase() !== "running") {
    return null;
  }

  const storyId = Number.parseInt(currentItem.storyId, 10);
  if (!Number.isInteger(storyId) || storyId <= 0) {
    return null;
  }

  return {
    automationRunId: Number.parseInt(activeRun.id, 10) || null,
    automationType: String(activeRun.automationType || "").toLowerCase(),
    targetId: Number.parseInt(activeRun.targetId, 10) || null,
    storyId,
    featureId: Number.parseInt(currentItem.featureId, 10) || null,
    epicId: Number.parseInt(currentItem.epicId, 10) || null,
    startedAt: typeof currentItem.startedAt === "string" ? currentItem.startedAt : null,
    runningCodexCommand: String(currentItem.runningCodexCommand || "").trim()
  };
}

function appendCurrentExecutingStoryLine(content, automationType, targetId) {
  const currentStory = getCurrentExecutingStorySummary(automationType, targetId);
  if (!currentStory) {
    return;
  }

  let summary = "";
  if (currentStory.storyTitle && Number.isInteger(currentStory.storyId) && currentStory.storyId > 0) {
    summary = `${currentStory.storyTitle} (#${currentStory.storyId})`;
  } else if (currentStory.storyTitle) {
    summary = currentStory.storyTitle;
  } else if (Number.isInteger(currentStory.storyId) && currentStory.storyId > 0) {
    summary = `#${currentStory.storyId}`;
  }

  if (!summary) {
    return;
  }

  const row = document.createElement("p");
  row.className = "feature-automation-status-row";
  row.textContent = `Current story: ${summary}`;

  const storyInTree = findStoryInFeatureTreeById(currentStory.storyId);
  const linkedRunId = parseRunId(storyInTree?.run_id);
  if (linkedRunId) {
    row.appendChild(document.createTextNode(" ("));
    row.appendChild(createRunDetailsLink(linkedRunId, "Run details"));
    row.appendChild(document.createTextNode(")"));
  }

  content.appendChild(row);
}

function getAutomationStopReasonSummary(stopReason) {
  const normalizedReason = String(stopReason || "").trim().toLowerCase();
  if (normalizedReason === "execution_failed") {
    return "Stopped because a story execution failed.";
  }
  if (normalizedReason === "merge_failed") {
    return "Stopped because a story auto-merge failed.";
  }
  if (normalizedReason === "story_incomplete") {
    return "Stopped because an incomplete story was found with stop-on-incomplete enabled.";
  }
  if (normalizedReason === "manual_stop") {
    return "Stopped because a manual stop was requested.";
  }
  if (normalizedReason === "run_time_limit_reached") {
    return "Stopped because the run reached the 600-minute limit.";
  }
  if (normalizedReason === "story_time_limit_reached") {
    return "Stopped because a story exceeded the 16-minute limit and hit the 20-minute hard stop window.";
  }
  return null;
}

function appendAutomationStopReasonLine(content, { status, stopReason } = {}) {
  if (status !== "stopped" && status !== "failed") {
    return;
  }

  const summary = getAutomationStopReasonSummary(stopReason);
  if (!summary) {
    return;
  }

  const row = document.createElement("p");
  row.className = "feature-automation-status-row";
  row.textContent = `Stop reason: ${summary}`;
  content.appendChild(row);
}

function normalizeAutomationBundleAssociation(contextBundleId, contextBundleTitle) {
  const normalizedId = Number.parseInt(contextBundleId, 10);
  const hasValidId = Number.isInteger(normalizedId) && normalizedId > 0;
  const normalizedTitle = typeof contextBundleTitle === "string" && contextBundleTitle.trim()
    ? contextBundleTitle.trim()
    : null;

  return {
    contextBundleId: hasValidId ? normalizedId : null,
    contextBundleTitle: normalizedTitle
  };
}

function resolveAutomationBundleAssociation(automationType, targetId, fallback = {}) {
  const fallbackAssociation = normalizeAutomationBundleAssociation(
    fallback?.contextBundleId,
    fallback?.contextBundleTitle
  );
  const activeRun = globalAutomationStatus?.automationRun;
  if (!activeRun) {
    return fallbackAssociation;
  }

  if (String(activeRun.automationType || "").toLowerCase() !== String(automationType || "").toLowerCase()) {
    return fallbackAssociation;
  }

  if (Number(activeRun.targetId) !== Number(targetId)) {
    return fallbackAssociation;
  }

  return normalizeAutomationBundleAssociation(activeRun.contextBundleId, activeRun.contextBundleTitle);
}

function appendAutomationBundleAssociationLine(content, { status, automationType, targetId, fallback } = {}) {
  if (status === "not_started") {
    return;
  }

  const association = resolveAutomationBundleAssociation(automationType, targetId, fallback);
  const row = document.createElement("p");
  row.className = "feature-automation-status-row";

  if (association.contextBundleTitle) {
    const bundleLabel = association.contextBundleId
      ? `${association.contextBundleTitle} (#${association.contextBundleId})`
      : association.contextBundleTitle;
    row.textContent = `Context bundle: ${bundleLabel}`;
  } else if (association.contextBundleId) {
    row.textContent = `Context bundle: #${association.contextBundleId}`;
  } else {
    row.textContent = "Context bundle: none";
  }

  content.appendChild(row);
}

function getStoryAutomationStatus(story) {
  const activeStoryRun = Boolean(
    globalAutomationLock?.isActive
      && globalAutomationLock?.automationType === "story"
      && Number(globalAutomationLock?.targetId) === Number(story?.id)
  );
  if (activeStoryRun) {
    return "running";
  }

  const rawStatus = String(story?.story_automation_status || "").trim().toLowerCase();
  if (rawStatus === "running") return "running";
  if (rawStatus === "completed") return "completed";
  if (rawStatus === "stopped") return "stopped";
  if (rawStatus === "failed") return "failed";

  return "not_started";
}

function getAutomationExecutionHistory(automationType, targetId) {
  const activeRun = globalAutomationStatus?.automationRun;
  if (!activeRun) {
    return [];
  }

  if (String(activeRun.automationType || "").toLowerCase() !== String(automationType || "").toLowerCase()) {
    return [];
  }

  if (Number(activeRun.targetId) !== Number(targetId)) {
    return [];
  }

  const completed = Array.isArray(globalAutomationStatus?.completedSteps)
    ? globalAutomationStatus.completedSteps
    : [];
  const failed = Array.isArray(globalAutomationStatus?.failedSteps)
    ? globalAutomationStatus.failedSteps
    : [];

  return [...completed, ...failed]
    .map((item) => ({
      storyId: Number.parseInt(item?.storyId, 10) || null,
      storyTitle: String(item?.storyTitle || "").trim() || null,
      positionInQueue: Number.parseInt(item?.positionInQueue, 10) || null,
      executionStatus: String(item?.executionStatus || "").trim().toLowerCase() || "unknown",
      runId: parseRunId(item?.runId),
      error: String(item?.error || "").trim() || null
    }))
    .sort((left, right) => {
      const leftPosition = Number.isInteger(left.positionInQueue) ? left.positionInQueue : Number.MAX_SAFE_INTEGER;
      const rightPosition = Number.isInteger(right.positionInQueue) ? right.positionInQueue : Number.MAX_SAFE_INTEGER;
      return leftPosition - rightPosition;
    });
}

function appendAutomationExecutionHistory(content, automationType, targetId) {
  const historyItems = getAutomationExecutionHistory(automationType, targetId).slice(-3);
  if (!historyItems.length) {
    return;
  }

  const heading = document.createElement("p");
  heading.className = "feature-automation-status-row";
  heading.textContent = "Recent story runs:";
  content.appendChild(heading);

  for (const item of historyItems) {
    const line = document.createElement("p");
    line.className = "feature-automation-status-row feature-automation-status-row--history";
    const storyLabel = item.storyTitle
      ? `${item.storyTitle}${Number.isInteger(item.storyId) && item.storyId > 0 ? ` (#${item.storyId})` : ""}`
      : Number.isInteger(item.storyId) && item.storyId > 0
        ? `Story #${item.storyId}`
      : "Story";
    const statusLabel = item.executionStatus || "unknown";
    line.appendChild(document.createTextNode(`${storyLabel}: ${statusLabel} - `));
    appendRunDetailsInline(line, item.runId);
    content.appendChild(line);

    if (statusLabel === "failed" && item.error) {
      const errorLine = document.createElement("p");
      errorLine.className = "feature-automation-status-row feature-automation-status-row--history";
      errorLine.textContent = `Failure reason: ${item.error}`;
      content.appendChild(errorLine);
    }
  }
}

function createFeatureAutomationStatusSummary(content, feature) {
  const status = getFeatureAutomationStatus(feature);
  const label = getFeatureAutomationStatusLabel(status);

  const row = document.createElement("p");
  row.className = "feature-automation-status-row";
  row.appendChild(document.createTextNode("Automation: "));

  const badge = document.createElement("span");
  badge.className = `automation-status-pill automation-status-pill--${status}`;
  badge.textContent = label;
  row.appendChild(badge);

  const runId = parseRunId(feature?.feature_automation_run_id);
  if (status !== "not_started") {
    row.appendChild(document.createTextNode(" ("));
    appendRunDetailsInline(row, runId);
    row.appendChild(document.createTextNode(")"));
  }

  content.appendChild(row);
  appendAutomationBundleAssociationLine(content, {
    status,
    automationType: "feature",
    targetId: feature?.id,
    fallback: {
      contextBundleId: feature?.feature_automation_context_bundle_id,
      contextBundleTitle: feature?.feature_automation_context_bundle_title
    }
  });
  appendAutomationStopReasonLine(content, {
    status,
    stopReason: feature?.feature_automation_stop_reason
  });
  appendCurrentExecutingStoryLine(content, "feature", feature?.id);
  appendAutomationExecutionHistory(content, "feature", feature?.id);
}

function createEpicAutomationStatusSummary(content, epic) {
  const status = getEpicAutomationStatus(epic);
  const label = getEpicAutomationStatusLabel(status);

  const row = document.createElement("p");
  row.className = "feature-automation-status-row";
  row.appendChild(document.createTextNode("Automation: "));

  const badge = document.createElement("span");
  badge.className = `automation-status-pill automation-status-pill--${status}`;
  badge.textContent = label;
  row.appendChild(badge);

  const runId = parseRunId(epic?.epic_automation_run_id);
  if (status !== "not_started") {
    row.appendChild(document.createTextNode(" ("));
    appendRunDetailsInline(row, runId);
    row.appendChild(document.createTextNode(")"));
  }

  content.appendChild(row);
  appendAutomationBundleAssociationLine(content, {
    status,
    automationType: "epic",
    targetId: epic?.id,
    fallback: {
      contextBundleId: epic?.epic_automation_context_bundle_id,
      contextBundleTitle: epic?.epic_automation_context_bundle_title
    }
  });
  appendAutomationStopReasonLine(content, {
    status,
    stopReason: epic?.epic_automation_stop_reason
  });
  appendCurrentExecutingStoryLine(content, "epic", epic?.id);
  appendAutomationExecutionHistory(content, "epic", epic?.id);
}

function createStoryAutomationStatusSummary(content, story) {
  const status = getStoryAutomationStatus(story);
  const label = getAutomationStatusLabel(status);

  const row = document.createElement("p");
  row.className = "feature-automation-status-row";
  row.appendChild(document.createTextNode("Automation: "));

  const badge = document.createElement("span");
  badge.className = `automation-status-pill automation-status-pill--${status}`;
  badge.textContent = label;
  row.appendChild(badge);

  const runId = parseRunId(story?.story_automation_run_id);
  if (status !== "not_started") {
    row.appendChild(document.createTextNode(" ("));
    appendRunDetailsInline(row, runId);
    row.appendChild(document.createTextNode(")"));
  }

  content.appendChild(row);
  appendAutomationBundleAssociationLine(content, {
    status,
    automationType: "story",
    targetId: story?.id,
    fallback: {
      contextBundleId: story?.story_automation_context_bundle_id,
      contextBundleTitle: story?.story_automation_context_bundle_title
    }
  });
  appendAutomationStopReasonLine(content, {
    status,
    stopReason: story?.story_automation_stop_reason
  });
  appendAutomationExecutionHistory(content, "story", story?.id);
}

async function startFeatureAutomation(featureId, options = {}) {
  const projectName = automationScope.projectName;
  const baseBranch = automationScope.baseBranch;
  const stopOnIncompleteStory = Boolean(options.stopOnIncompleteStory);
  const contextBundleId = Number.isInteger(options?.contextBundleId) && options.contextBundleId > 0
    ? options.contextBundleId
    : null;
  if (!projectName || !baseBranch) {
    throw new Error("Select a project and branch on the editor page first, then retry automation.");
  }

  const response = await fetch(`/api/automation/start/feature/${encodeURIComponent(String(featureId))}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectName,
      baseBranch,
      stopOnIncompleteStory,
      automationType: "feature",
      targetId: featureId,
      featureId,
      contextBundleId
    })
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(formatAutomationStartError(result, "Unable to start feature automation."));
  }

  return result;
}

async function startEpicAutomation(epicId, options = {}) {
  const projectName = automationScope.projectName;
  const baseBranch = automationScope.baseBranch;
  const stopOnIncompleteStory = Boolean(options.stopOnIncompleteStory);
  const contextBundleId = Number.isInteger(options?.contextBundleId) && options.contextBundleId > 0
    ? options.contextBundleId
    : null;
  if (!projectName || !baseBranch) {
    throw new Error("Select a project and branch on the editor page first, then retry automation.");
  }

  const response = await fetch(`/api/automation/start/epic/${encodeURIComponent(String(epicId))}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectName,
      baseBranch,
      stopOnIncompleteStory,
      automationType: "epic",
      targetId: epicId,
      epicId,
      contextBundleId
    })
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(formatAutomationStartError(result, "Unable to start epic automation."));
  }

  return result;
}

async function resumeAutomationRun(automationRunId, options = {}) {
  const normalizedRunId = parseRunId(automationRunId);
  const contextBundleId = Number.isInteger(options?.contextBundleId) && options.contextBundleId > 0
    ? options.contextBundleId
    : null;
  if (!normalizedRunId) {
    throw new Error("Resume requires a valid automation run id.");
  }

  const response = await fetch(`/api/automation/resume/${encodeURIComponent(String(normalizedRunId))}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contextBundleId
    })
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(formatAutomationStartError(result, "Unable to resume automation."));
  }

  return result;
}

async function abortAutomationRun(automationRunId) {
  const normalizedRunId = parseRunId(automationRunId);
  if (!normalizedRunId) {
    throw new Error("Abort requires a valid automation run id.");
  }

  const response = await fetch(`/api/automation/stop/${encodeURIComponent(String(normalizedRunId))}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      purgeRemainingQueue: true,
      abortActiveStoryIfPossible: true
    })
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result?.error || "Unable to abort automation.");
  }

  return result;
}

async function launchFeatureAutomationForFeature(feature, options = {}) {
  const featureId = Number.parseInt(feature?.id, 10);
  if (!Number.isInteger(featureId) || featureId <= 0) {
    throw new Error("Feature automation requires a valid feature id.");
  }

  const isResumeEligible = Boolean(options.isResumeEligible) && parseRunId(feature?.feature_automation_run_id);
  const stopOnIncompleteStory = Boolean(options.stopOnIncompleteStory);
  const contextBundleId = Number.isInteger(options?.contextBundleId) && options.contextBundleId > 0
    ? options.contextBundleId
    : null;
  const source = String(options.source || "").trim().toLowerCase();
  const isActiveFeatureRun = Boolean(
    globalAutomationLock?.isActive
      && globalAutomationLock?.automationType === "feature"
      && Number(globalAutomationLock?.targetId) === featureId
  );

  if (featureAutomationStartInFlight.has(featureId)) {
    throw new Error("Feature automation start is already being requested for this feature.");
  }

  if (isAnyAutomationInFlight() && !isActiveFeatureRun) {
    throw new Error("Automation is already running. Wait for completion before starting another run.");
  }

  if (isActiveFeatureRun) {
    throw new Error("Feature automation is already running for this feature.");
  }

  openCards.add(`feature:${featureId}`);
  featureAutomationStartInFlight.add(featureId);
  renderFeatureLists();

  try {
    const result = isResumeEligible
      ? await resumeAutomationRun(feature.feature_automation_run_id, {
        contextBundleId
      })
      : await startFeatureAutomation(featureId, {
        stopOnIncompleteStory,
        contextBundleId
      });
    assertAutomationStartScope(result, {
      automationType: "feature",
      targetId: featureId
    });
    const runId = result?.automationRun?.id;
    const totalStories = result?.queue?.totalStories;
    const isResumeLaunch = String(result?.launchMode || "").toLowerCase() === "resume";
    const queueCapSuffix = formatQueueCapSuffix(result?.queue);
    createStatusBox.textContent = Number.isInteger(runId)
      ? (isResumeLaunch
        ? `Feature automation resumed for feature #${featureId} (run #${runId}, ${totalStories} remaining story(s) queued).${queueCapSuffix}`
        : `Feature automation started for feature #${featureId} (run #${runId}, ${totalStories} story(s) queued).${queueCapSuffix}`)
      : (isResumeLaunch
        ? `Feature automation resumed for feature #${featureId}.${queueCapSuffix}`
        : `Feature automation started for feature #${featureId}.${queueCapSuffix}`);
    if (source === "feature_queue") {
      createStatusBox.textContent = `Feature queue: ${createStatusBox.textContent}`;
    }
    await refreshAutomationState();
    return result;
  } catch (error) {
    createStatusBox.textContent = isAutomationAlreadyRunningError(error)
      ? `Automation is already running. ${error.message}`
      : `Feature automation failed to start: ${error.message}`;
    throw error;
  } finally {
    featureAutomationStartInFlight.delete(featureId);
    renderFeatureLists();
  }
}

function createFeatureAutomationUi(content, feature) {
  if (isFeatureComplete(feature)) {
    return;
  }

  const featureEligibilitySummary = getAutomationEligibleStorySummary(
    (feature?.epics || []).flatMap((epic) => epic?.stories || [])
  );
  const incompleteStoryCount = featureEligibilitySummary.eligibleStoryCount;
  if (incompleteStoryCount <= 0) {
    content.appendChild(
      createTextNode("p", "inline-hint", getAutomationIneligibleHint("feature", featureEligibilitySummary))
    );
    return;
  }

  const isActiveFeatureRun = Boolean(
    globalAutomationLock?.isActive
      && globalAutomationLock?.automationType === "feature"
      && Number(globalAutomationLock?.targetId) === Number(feature.id)
  );
  const isFeatureStartInFlight = featureAutomationStartInFlight.has(feature.id);
  const featureAutomationStatus = getFeatureAutomationStatus(feature);
  const isResumeEligible = (featureAutomationStatus === "stopped" || featureAutomationStatus === "failed")
    && parseRunId(feature?.feature_automation_run_id);

  if (isActiveFeatureRun) {
    const runLabel = Number.isInteger(Number(globalAutomationLock?.automationRunId))
      ? `Feature automation run #${globalAutomationLock.automationRunId} is in progress.`
      : "Feature automation is in progress.";
    content.appendChild(createTextNode("p", "inline-hint", runLabel));
  } else if (isFeatureStartInFlight) {
    content.appendChild(createTextNode("p", "inline-hint", "Feature automation start request is in progress."));
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = isActiveFeatureRun || isFeatureStartInFlight
    ? "Automation Running..."
    : (isResumeEligible ? "Resume Automation" : "Complete with Automation");
  button.disabled = isFeatureStartInFlight
    || isActiveFeatureRun
    || (isAnyAutomationInFlight() && !isActiveFeatureRun);

  const actionRow = document.createElement("div");
  actionRow.className = "automation-action-row";
  actionRow.appendChild(button);

  const queueToggleButton = document.createElement("button");
  queueToggleButton.type = "button";
  queueToggleButton.className = "secondary-button";
  queueToggleButton.textContent = featureAutomationQueue.includes(feature.id)
    ? "Remove from Feature Queue"
    : "Add to Feature Queue";
  queueToggleButton.disabled = isFeatureQueueRunning;
  queueToggleButton.addEventListener("click", () => {
    toggleFeatureInQueue(feature.id);
  });
  actionRow.appendChild(queueToggleButton);

  if (isActiveFeatureRun) {
    const abortButton = document.createElement("button");
    abortButton.type = "button";
    abortButton.className = "danger-button";
    abortButton.textContent = "Abort";
    abortButton.addEventListener("click", async () => {
      clearFeatureAutomationQueue({
        preserveStatusMessage: true
      });
      const activeRunId = parseRunId(globalAutomationLock?.automationRunId || globalAutomationStatus?.automationRun?.id);
      if (!activeRunId) {
        createStatusBox.textContent = "Abort unavailable: active automation run id is missing.";
        return;
      }

      abortButton.disabled = true;
      try {
        const result = await abortAutomationRun(activeRunId);
        const removedStories = Number.parseInt(result?.queue?.removedStories, 10) || 0;
        createStatusBox.textContent = `Abort requested for feature automation run #${activeRunId}. Remaining queued stories removed: ${removedStories}. You can resume later.`;
        await refreshAutomationState();
      } catch (error) {
        createStatusBox.textContent = `Abort failed: ${error.message}`;
      } finally {
        abortButton.disabled = false;
      }
    });
    actionRow.appendChild(abortButton);
  }

  const stopOnIncompleteCheckbox = document.createElement("input");
  stopOnIncompleteCheckbox.type = "checkbox";
  stopOnIncompleteCheckbox.checked = Boolean(
    stopRunForIncompleteStoriesByFeatureId.get(feature.id)
  );
  stopOnIncompleteCheckbox.disabled = isActiveFeatureRun || isFeatureStartInFlight;
  stopOnIncompleteCheckbox.addEventListener("change", () => {
    stopRunForIncompleteStoriesByFeatureId.set(feature.id, stopOnIncompleteCheckbox.checked);
  });

  const stopOnIncompleteLabel = document.createElement("label");
  stopOnIncompleteLabel.className = "story-automation-checkbox";
  stopOnIncompleteLabel.appendChild(stopOnIncompleteCheckbox);
  stopOnIncompleteLabel.appendChild(document.createTextNode("Stop Run For Incomplete Stories"));
  content.appendChild(stopOnIncompleteLabel);
  const { selectorWrap, select: contextBundleSelect } = createAutomationContextBundleSelector({
    idPrefix: `feature-${feature.id}`,
    automationLabel: "feature",
    disabled: isActiveFeatureRun || isFeatureStartInFlight
  });
  content.appendChild(selectorWrap);

  button.addEventListener("click", async () => {
    try {
      const selectedContextBundleId = parseSelectedContextBundleId(contextBundleSelect.value);
      await launchFeatureAutomationForFeature(feature, {
        isResumeEligible,
        stopOnIncompleteStory: stopOnIncompleteCheckbox.checked,
        contextBundleId: selectedContextBundleId
      });
    } catch (_error) {}
  });

  content.appendChild(actionRow);
}

function getIncompleteStoryCountForEpic(epic) {
  return getAutomationEligibleStorySummary(epic?.stories || []).eligibleStoryCount;
}

function createEpicAutomationUi(content, epic) {
  if (isEpicComplete(epic)) {
    return;
  }

  const epicEligibilitySummary = getAutomationEligibleStorySummary(epic?.stories || []);
  const incompleteStoryCount = epicEligibilitySummary.eligibleStoryCount;
  if (incompleteStoryCount <= 0) {
    content.appendChild(
      createTextNode("p", "inline-hint", getAutomationIneligibleHint("epic", epicEligibilitySummary))
    );
    return;
  }

  const isActiveEpicRun = Boolean(
    globalAutomationLock?.isActive
      && globalAutomationLock?.automationType === "epic"
      && Number(globalAutomationLock?.targetId) === Number(epic.id)
  );
  const isEpicStartInFlight = epicAutomationStartInFlight.has(epic.id);
  const epicAutomationStatus = getEpicAutomationStatus(epic);
  const isResumeEligible = (epicAutomationStatus === "stopped" || epicAutomationStatus === "failed")
    && parseRunId(epic?.epic_automation_run_id);

  if (isActiveEpicRun) {
    const runLabel = Number.isInteger(Number(globalAutomationLock?.automationRunId))
      ? `Epic automation run #${globalAutomationLock.automationRunId} is in progress.`
      : "Epic automation is in progress.";
    content.appendChild(createTextNode("p", "inline-hint", runLabel));
  } else if (isEpicStartInFlight) {
    content.appendChild(createTextNode("p", "inline-hint", "Epic automation start request is in progress."));
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button";
  button.textContent = isActiveEpicRun || isEpicStartInFlight
    ? "Automation Running..."
    : (isResumeEligible ? "Resume Automation" : "Complete with Automation");
  button.disabled = isEpicStartInFlight
    || isActiveEpicRun
    || (isAnyAutomationInFlight() && !isActiveEpicRun);

  const actionRow = document.createElement("div");
  actionRow.className = "automation-action-row";
  actionRow.appendChild(button);

  if (isActiveEpicRun) {
    const abortButton = document.createElement("button");
    abortButton.type = "button";
    abortButton.className = "danger-button";
    abortButton.textContent = "Abort";
    abortButton.addEventListener("click", async () => {
      clearFeatureAutomationQueue({
        preserveStatusMessage: true
      });
      const activeRunId = parseRunId(globalAutomationLock?.automationRunId || globalAutomationStatus?.automationRun?.id);
      if (!activeRunId) {
        createStatusBox.textContent = "Abort unavailable: active automation run id is missing.";
        return;
      }

      abortButton.disabled = true;
      try {
        const result = await abortAutomationRun(activeRunId);
        const removedStories = Number.parseInt(result?.queue?.removedStories, 10) || 0;
        createStatusBox.textContent = `Abort requested for epic automation run #${activeRunId}. Remaining queued stories removed: ${removedStories}. You can resume later.`;
        await refreshAutomationState();
      } catch (error) {
        createStatusBox.textContent = `Abort failed: ${error.message}`;
      } finally {
        abortButton.disabled = false;
      }
    });
    actionRow.appendChild(abortButton);
  }

  const stopOnIncompleteCheckbox = document.createElement("input");
  stopOnIncompleteCheckbox.type = "checkbox";
  stopOnIncompleteCheckbox.checked = Boolean(
    stopRunForIncompleteStoriesByEpicId.get(epic.id)
  );
  stopOnIncompleteCheckbox.disabled = isActiveEpicRun || isEpicStartInFlight;
  stopOnIncompleteCheckbox.addEventListener("change", () => {
    stopRunForIncompleteStoriesByEpicId.set(epic.id, stopOnIncompleteCheckbox.checked);
  });

  const stopOnIncompleteLabel = document.createElement("label");
  stopOnIncompleteLabel.className = "story-automation-checkbox";
  stopOnIncompleteLabel.appendChild(stopOnIncompleteCheckbox);
  stopOnIncompleteLabel.appendChild(document.createTextNode("Stop Run For Incomplete Stories"));
  content.appendChild(stopOnIncompleteLabel);
  const { selectorWrap, select: contextBundleSelect } = createAutomationContextBundleSelector({
    idPrefix: `epic-${epic.id}`,
    automationLabel: "epic",
    disabled: isActiveEpicRun || isEpicStartInFlight
  });
  content.appendChild(selectorWrap);

  button.addEventListener("click", async () => {
    if (epicAutomationStartInFlight.has(epic.id)) {
      createStatusBox.textContent = "Epic automation start is already being requested for this epic.";
      return;
    }

    if (isAnyAutomationInFlight() && !isActiveEpicRun) {
      createStatusBox.textContent = "Automation is already running. Wait for completion before starting another run.";
      return;
    }

    if (isActiveEpicRun) {
      createStatusBox.textContent = "Epic automation is already running for this epic.";
      return;
    }

    openCards.add(`epic:${epic.id}`);
    epicAutomationStartInFlight.add(epic.id);
    renderFeatureLists();

    try {
      const selectedContextBundleId = parseSelectedContextBundleId(contextBundleSelect.value);
      const result = isResumeEligible
        ? await resumeAutomationRun(epic.epic_automation_run_id, {
          contextBundleId: selectedContextBundleId
        })
        : await startEpicAutomation(epic.id, {
          stopOnIncompleteStory: stopOnIncompleteCheckbox.checked,
          contextBundleId: selectedContextBundleId
        });
      assertAutomationStartScope(result, {
        automationType: "epic",
        targetId: epic.id
      });
      const runId = result?.automationRun?.id;
      const totalStories = result?.queue?.totalStories;
      const isResumeLaunch = String(result?.launchMode || "").toLowerCase() === "resume";
      const queueCapSuffix = formatQueueCapSuffix(result?.queue);
      createStatusBox.textContent = Number.isInteger(runId)
        ? (isResumeLaunch
          ? `Epic automation resumed for epic #${epic.id} (run #${runId}, ${totalStories} remaining story(s) queued).${queueCapSuffix}`
          : `Epic automation started for epic #${epic.id} (run #${runId}, ${totalStories} story(s) queued).${queueCapSuffix}`)
        : (isResumeLaunch
          ? `Epic automation resumed for epic #${epic.id}.${queueCapSuffix}`
          : `Epic automation started for epic #${epic.id}.${queueCapSuffix}`);
      await refreshAutomationState();
    } catch (error) {
      createStatusBox.textContent = isAutomationAlreadyRunningError(error)
        ? `Automation is already running. ${error.message}`
        : `Epic automation failed to start: ${error.message}`;
    } finally {
      epicAutomationStartInFlight.delete(epic.id);
      renderFeatureLists();
    }
  });

  content.appendChild(actionRow);
}

function createStoryAutomationUi(content, story) {
  const runLine = createTextNode("p", "inline-hint", getStoryRunStatusLabel(story));
  content.appendChild(runLine);

  appendStoryRunLinkLine(content, story);

  if (!isStoryEligibleForAutomation(story)) {
    content.appendChild(
      createTextNode("p", "inline-hint", "Automation unavailable: this story is already complete.")
    );
    return;
  }

  const isActiveStoryRun = Boolean(
    globalAutomationLock?.isActive
      && globalAutomationLock?.automationType === "story"
      && Number(globalAutomationLock?.targetId) === Number(story?.id)
  );
  const isStoryStartInFlight = storyAutomationInFlight.has(story.id);
  const isGlobalRunActive = isAnyAutomationInFlight();
  const storyAutomationStatus = getStoryAutomationStatus(story);
  const isResumeEligible = (storyAutomationStatus === "stopped" || storyAutomationStatus === "failed")
    && parseRunId(story?.story_automation_run_id);

  const automationButton = document.createElement("button");
  automationButton.type = "button";
  automationButton.className = "secondary-button";
  automationButton.textContent = isStoryStartInFlight || isActiveStoryRun
    ? "Automation Running..."
    : (isResumeEligible ? "Resume Automation" : "Complete with Automation");
  automationButton.disabled = isGlobalRunActive && !isStoryStartInFlight;

  const actionRow = document.createElement("div");
  actionRow.className = "automation-action-row";
  actionRow.appendChild(automationButton);

  if (isActiveStoryRun) {
    const abortButton = document.createElement("button");
    abortButton.type = "button";
    abortButton.className = "danger-button";
    abortButton.textContent = "Abort";
    abortButton.addEventListener("click", async () => {
      clearFeatureAutomationQueue({
        preserveStatusMessage: true
      });
      const activeRunId = parseRunId(globalAutomationLock?.automationRunId || globalAutomationStatus?.automationRun?.id);
      if (!activeRunId) {
        createStatusBox.textContent = "Abort unavailable: active automation run id is missing.";
        return;
      }

      abortButton.disabled = true;
      try {
        const result = await abortAutomationRun(activeRunId);
        const removedStories = Number.parseInt(result?.queue?.removedStories, 10) || 0;
        createStatusBox.textContent = `Abort requested for story automation run #${activeRunId}. Remaining queued stories removed: ${removedStories}. You can resume later.`;
        await refreshAutomationState();
      } catch (error) {
        createStatusBox.textContent = `Abort failed: ${error.message}`;
      } finally {
        abortButton.disabled = false;
      }
    });
    actionRow.appendChild(abortButton);
  }

  const { selectorWrap, select: contextBundleSelect } = createAutomationContextBundleSelector({
    idPrefix: `story-${story.id}`,
    automationLabel: "story",
    disabled: isStoryStartInFlight || isActiveStoryRun
  });
  content.appendChild(selectorWrap);

  automationButton.addEventListener("click", async () => {
    if (storyAutomationInFlight.has(story.id)) {
      createStatusBox.textContent = "Story automation start is already being requested for this story.";
      return;
    }

    if (isAnyAutomationInFlight()) {
      createStatusBox.textContent = "Automation is already running. Wait for completion before starting another run.";
      return;
    }

    openCards.add(`feature:${story.feature_id}`);
    openCards.add(`epic:${story.epic_id}`);
    openCards.add(`story:${story.id}`);
    storyAutomationInFlight.add(story.id);
    renderFeatureLists();

    try {
      const selectedContextBundleId = parseSelectedContextBundleId(contextBundleSelect.value);
      const result = isResumeEligible
        ? await resumeAutomationRun(story.story_automation_run_id, {
          contextBundleId: selectedContextBundleId
        })
        : await startStoryAutomation(story.id, {
          contextBundleId: selectedContextBundleId
        });
      assertAutomationStartScope(result, {
        automationType: "story",
        targetId: story.id,
        enforceSingleStory: true
      });
      const runId = result?.automationRun?.id;
      const totalStories = Number(result?.queue?.totalStories) || 1;
      const isResumeLaunch = String(result?.launchMode || "").toLowerCase() === "resume";
      const queueCapSuffix = formatQueueCapSuffix(result?.queue);
      createStatusBox.textContent = Number.isInteger(runId)
        ? (isResumeLaunch
          ? `Story automation resumed for story #${story.id} (run #${runId}, ${totalStories} remaining story queued).${queueCapSuffix}`
          : `Story automation started for story #${story.id} (run #${runId}, 1 story queued).${queueCapSuffix}`)
        : (isResumeLaunch
          ? `Story automation resumed for story #${story.id}.${queueCapSuffix}`
          : `Story automation started for story #${story.id} (1 story queued).${queueCapSuffix}`);
      await refreshAutomationState();
    } catch (error) {
      createStatusBox.textContent = isAutomationAlreadyRunningError(error)
        ? `Automation is already running. ${error.message}`
        : `Story automation failed to start: ${error.message}`;
    } finally {
      storyAutomationInFlight.delete(story.id);
      renderFeatureLists();
    }
  });

  content.appendChild(actionRow);
}

function appendActiveStoryRuntime(content, story) {
  const activeStory = getActiveQueueStoryRuntimeContext();
  if (!activeStory || Number(activeStory.storyId) !== Number(story?.id)) {
    return;
  }

  const startedAtMs = activeStory.startedAt ? Date.parse(activeStory.startedAt) : NaN;
  const elapsedText = Number.isFinite(startedAtMs)
    ? formatElapsed(Date.now() - startedAtMs)
    : "unknown";

  const elapsedLine = createTextNode("p", "inline-hint active-story-elapsed", `Time elapsed: ${elapsedText}`);
  content.appendChild(elapsedLine);

  const commandBox = document.createElement("pre");
  commandBox.className = "active-story-command-box";
  commandBox.textContent = activeStory.runningCodexCommand || "Waiting for command output...";
  content.appendChild(commandBox);
}

function renderStoryCard(story, options = {}) {
  return createCollapsibleCard({
    levelClass: "hier-card--story",
    cardKey: `story:${story.id}`,
    name: story.name,
    status: getStoryStatus(story),
    renderBody: (content) => {
      createDescription(content, story.description, {
        collapsible: true
      });
      createStoryAutomationStatusSummary(content, story);
      if (options.showAutomation) {
        createStoryAutomationUi(content, story);
        appendActiveStoryRuntime(content, story);
      } else {
        const runStatusLine = createTextNode("p", "inline-hint", getStoryRunStatusLabel(story));
        content.appendChild(runStatusLine);
        appendStoryRunLinkLine(content, story);
      }
    }
  });
}

function renderEpicCard(epic, options = {}) {
  return createCollapsibleCard({
    levelClass: "hier-card--epic",
    cardKey: `epic:${epic.id}`,
    name: epic.name,
    status: getEpicStatus(epic),
    renderBody: (content) => {
      createDescription(content, epic.description);
      createEpicAutomationStatusSummary(content, epic);
      if (options.showAutomation) {
        createEpicAutomationUi(content, epic);
      }
      const stories = epic.stories || [];
      if (!stories.length) {
        content.appendChild(createTextNode("p", "empty-card-copy", "No stories defined."));
        return;
      }

      const stack = document.createElement("div");
      stack.className = "hier-stack";
      for (const story of stories) {
        stack.appendChild(renderStoryCard(story, options));
      }
      content.appendChild(stack);
    }
  });
}

function renderFeatureCard(feature, options = {}) {
  return createCollapsibleCard({
    levelClass: "hier-card--feature",
    cardKey: `feature:${feature.id}`,
    name: feature.name,
    status: getFeatureStatus(feature),
    renderBody: (content) => {
      createDescription(content, feature.description);
      createFeatureAutomationStatusSummary(content, feature);
      if (options.showAutomation) {
        createFeatureAutomationUi(content, feature);
      }
      const epics = feature.epics || [];
      if (!epics.length) {
        content.appendChild(createTextNode("p", "empty-card-copy", "No epics defined."));
        return;
      }

      const stack = document.createElement("div");
      stack.className = "hier-stack";
      for (const epic of epics) {
        stack.appendChild(renderEpicCard(epic, options));
      }
      content.appendChild(stack);
    }
  });
}

function removeFeatureDescendantOpenCards(featureId) {
  const normalizedFeatureId = Number.parseInt(featureId, 10);
  if (!Number.isInteger(normalizedFeatureId) || normalizedFeatureId <= 0) {
    return;
  }

  for (const feature of allFeatures) {
    if (Number(feature?.id) !== normalizedFeatureId) {
      continue;
    }

    for (const epic of feature?.epics || []) {
      openCards.delete(`epic:${epic.id}`);
      for (const story of epic?.stories || []) {
        openCards.delete(`story:${story.id}`);
      }
    }
    break;
  }
}

function getLatestProcessedStoryIdsFromAutomation() {
  const completed = Array.isArray(globalAutomationStatus?.completedSteps)
    ? globalAutomationStatus.completedSteps
    : [];
  const failed = Array.isArray(globalAutomationStatus?.failedSteps)
    ? globalAutomationStatus.failedSteps
    : [];

  return new Set(
    [...completed, ...failed]
      .map((step) => Number.parseInt(step?.storyId, 10))
      .filter((storyId) => Number.isInteger(storyId) && storyId > 0)
  );
}

function getAutomationUiSignature() {
  const run = globalAutomationStatus?.automationRun;
  const queue = globalAutomationStatus?.queue;
  const completedSteps = Array.isArray(globalAutomationStatus?.completedSteps)
    ? globalAutomationStatus.completedSteps.length
    : 0;
  const failedSteps = Array.isArray(globalAutomationStatus?.failedSteps)
    ? globalAutomationStatus.failedSteps.length
    : 0;

  return JSON.stringify({
    runId: Number.parseInt(run?.id, 10) || null,
    runStatus: String(run?.status || "").toLowerCase() || null,
    runType: String(run?.automationType || "").toLowerCase() || null,
    runTargetId: Number.parseInt(run?.targetId, 10) || null,
    currentStoryId: Number.parseInt(queue?.currentItem?.storyId, 10) || null,
    completedSteps,
    failedSteps
  });
}

function syncAutomationDrivenCardState(incompleteFeatures = []) {
  const managedCardKeys = buildAutomationManagedCardKeySet(incompleteFeatures);
  const isManagedCard = (cardKey) => managedCardKeys.has(cardKey);
  const activeRun = globalAutomationStatus?.automationRun || null;
  const activeStory = getActiveQueueStoryRuntimeContext();
  const isRunActivelyRunning = Boolean(activeRun) && String(activeRun.status || "").toLowerCase() === "running";

  if (isRunActivelyRunning) {
    if (String(activeRun.automationType || "").toLowerCase() === "feature") {
      const featureCardKey = `feature:${activeRun.targetId}`;
      if (isManagedCard(featureCardKey)) {
        openCards.add(featureCardKey);
      }
    }
    if (activeStory?.featureId) {
      const featureCardKey = `feature:${activeStory.featureId}`;
      if (isManagedCard(featureCardKey)) {
        openCards.add(featureCardKey);
      }
    }
    if (activeStory?.epicId) {
      const epicCardKey = `epic:${activeStory.epicId}`;
      if (isManagedCard(epicCardKey)) {
        openCards.add(epicCardKey);
      }
    }
    if (activeStory?.storyId) {
      const storyCardKey = `story:${activeStory.storyId}`;
      if (isManagedCard(storyCardKey)) {
        openCards.add(storyCardKey);
      }
    }
  
    const processedStoryIds = getLatestProcessedStoryIdsFromAutomation();
    for (const storyId of processedStoryIds) {
      const storyCardKey = `story:${storyId}`;
      if (isManagedCard(storyCardKey)) {
        openCards.delete(storyCardKey);
      }
    }
  }

  if (activeRun) {
    for (const feature of incompleteFeatures) {
      for (const epic of feature?.epics || []) {
        if (isEpicComplete(epic)) {
          openCards.delete(`epic:${epic.id}`);
        }
      }
    }
  }

  if (activeRun && !isRunActivelyRunning) {
    if (String(activeRun.automationType || "").toLowerCase() === "feature") {
      const featureCardKey = `feature:${activeRun.targetId}`;
      if (isManagedCard(featureCardKey)) {
        openCards.delete(featureCardKey);
        removeFeatureDescendantOpenCards(activeRun.targetId);
      }
    }
  }
}

function maybeAlertAutomationStop() {
  const finalResult = globalAutomationStatus?.finalResult;
  if (!finalResult) {
    return;
  }

  const normalizedStopReason = String(finalResult.stopReason || "").toLowerCase();
  const runId = Number.parseInt(globalAutomationStatus?.automationRun?.id, 10);
  const runLabel = Number.isInteger(runId) ? ` (run #${runId})` : "";

  if (normalizedStopReason === "run_time_limit_reached") {
    createStatusBox.textContent = `Automation stopped after reaching the 600-minute run limit${runLabel}. The remaining queue was cleared; you can resume later.`;
    return;
  }

  if (normalizedStopReason === "story_time_limit_reached") {
    createStatusBox.textContent = `Automation stopped because a story exceeded runtime limits${runLabel}. The remaining queue was cleared; you can resume later.`;
    return;
  }

  const isMergeFailure = finalResult
    && String(finalResult.status || "").toLowerCase() === "failed"
    && normalizedStopReason === "merge_failed";
  if (!isMergeFailure) {
    return;
  }

  createStatusBox.textContent = `Automation stopped due to an auto-merge failure${runLabel}. Resolve the merge issue before restarting.`;
}

function scrollActiveStoryCardIntoView() {
  const activeStory = getActiveQueueStoryRuntimeContext();
  if (!activeStory?.storyId) {
    lastScrolledActiveStoryId = null;
    return;
  }

  if (lastScrolledActiveStoryId === activeStory.storyId) {
    return;
  }

  const card = document.querySelector(`[data-card-key="story:${activeStory.storyId}"]`);
  if (!card) {
    return;
  }

  card.scrollIntoView({ block: "start", behavior: "smooth" });
  lastScrolledActiveStoryId = activeStory.storyId;
}

function refreshActiveStoryRuntimeIndicators() {
  const activeStory = getActiveQueueStoryRuntimeContext();
  if (!activeStory?.storyId) {
    return;
  }

  const startedAtMs = activeStory.startedAt ? Date.parse(activeStory.startedAt) : NaN;
  if (!Number.isFinite(startedAtMs)) {
    return;
  }

  const card = document.querySelector(`[data-card-key="story:${activeStory.storyId}"]`);
  const elapsedLine = card?.querySelector?.(".active-story-elapsed");
  if (!elapsedLine) {
    return;
  }
  elapsedLine.textContent = `Time elapsed: ${formatElapsed(Date.now() - startedAtMs)}`;
}

function pruneFeatureAutomationQueue(incompleteFeatures = []) {
  const allowedFeatureIds = new Set(
    (Array.isArray(incompleteFeatures) ? incompleteFeatures : [])
      .map((feature) => Number.parseInt(feature?.id, 10))
      .filter((featureId) => Number.isInteger(featureId) && featureId > 0)
  );

  for (let index = featureAutomationQueue.length - 1; index >= 0; index -= 1) {
    const featureId = Number.parseInt(featureAutomationQueue[index], 10);
    if (!allowedFeatureIds.has(featureId)) {
      featureAutomationQueue.splice(index, 1);
    }
  }

  if (
    Number.isInteger(activeFeatureQueueFeatureId)
    && !allowedFeatureIds.has(activeFeatureQueueFeatureId)
  ) {
    activeFeatureQueueFeatureId = null;
  }
}

function clearFeatureAutomationQueue({ preserveStatusMessage = false } = {}) {
  featureAutomationQueue.length = 0;
  isFeatureQueueRunning = false;
  activeFeatureQueueFeatureId = null;
  isFeatureQueueAdvanceInFlight = false;
  if (!preserveStatusMessage) {
    createStatusBox.textContent = "Feature queue cleared.";
  }
  renderFeatureLists();
}

function toggleFeatureInQueue(featureId) {
  if (isFeatureQueueRunning) {
    createStatusBox.textContent = "Feature queue is running. Stop or wait for completion before editing the queue.";
    return;
  }

  const normalizedFeatureId = Number.parseInt(featureId, 10);
  if (!Number.isInteger(normalizedFeatureId) || normalizedFeatureId <= 0) {
    return;
  }

  const index = featureAutomationQueue.findIndex((id) => Number(id) === normalizedFeatureId);
  if (index >= 0) {
    featureAutomationQueue.splice(index, 1);
  } else {
    featureAutomationQueue.push(normalizedFeatureId);
  }
  renderFeatureLists();
}

function moveFeatureQueueItem(featureId, direction) {
  if (isFeatureQueueRunning) {
    createStatusBox.textContent = "Feature queue is running. Reordering is disabled until it finishes.";
    return;
  }

  const normalizedFeatureId = Number.parseInt(featureId, 10);
  if (!Number.isInteger(normalizedFeatureId) || normalizedFeatureId <= 0) {
    return;
  }
  const fromIndex = featureAutomationQueue.findIndex((id) => Number(id) === normalizedFeatureId);
  if (fromIndex < 0) {
    return;
  }

  const toIndex = fromIndex + (direction < 0 ? -1 : 1);
  if (toIndex < 0 || toIndex >= featureAutomationQueue.length) {
    return;
  }

  const [item] = featureAutomationQueue.splice(fromIndex, 1);
  featureAutomationQueue.splice(toIndex, 0, item);
  renderFeatureLists();
}

async function maybeAdvanceFeatureQueue() {
  if (!isFeatureQueueRunning || isFeatureQueueAdvanceInFlight) {
    return;
  }

  if (isAnyAutomationInFlight()) {
    return;
  }

  if (!featureAutomationQueue.length) {
    isFeatureQueueRunning = false;
    activeFeatureQueueFeatureId = null;
    createStatusBox.textContent = "Feature queue completed.";
    renderFeatureLists();
    return;
  }

  const nextFeatureId = Number.parseInt(featureAutomationQueue[0], 10);
  const nextFeature = findFeatureById(nextFeatureId);
  if (!nextFeature || isFeatureComplete(nextFeature)) {
    featureAutomationQueue.shift();
    renderFeatureLists();
    await maybeAdvanceFeatureQueue();
    return;
  }

  isFeatureQueueAdvanceInFlight = true;
  activeFeatureQueueFeatureId = nextFeatureId;
  renderFeatureLists();

  try {
    const featureAutomationStatus = getFeatureAutomationStatus(nextFeature);
    const isResumeEligible = (featureAutomationStatus === "stopped" || featureAutomationStatus === "failed")
      && parseRunId(nextFeature?.feature_automation_run_id);
    await launchFeatureAutomationForFeature(nextFeature, {
      isResumeEligible,
      stopOnIncompleteStory: Boolean(stopRunForIncompleteStoriesByFeatureId.get(nextFeatureId)),
      source: "feature_queue"
    });
  } catch (error) {
    isFeatureQueueRunning = false;
    activeFeatureQueueFeatureId = null;
  } finally {
    isFeatureQueueAdvanceInFlight = false;
    renderFeatureLists();
  }
}

function reconcileFeatureQueueProgress() {
  if (!isFeatureQueueRunning) {
    return;
  }

  if (!featureAutomationQueue.length) {
    isFeatureQueueRunning = false;
    activeFeatureQueueFeatureId = null;
    createStatusBox.textContent = "Feature queue completed.";
    return;
  }

  const activeTargetId = Number.parseInt(globalAutomationLock?.targetId, 10);
  const isFeatureRunActive = Boolean(
    globalAutomationLock?.isActive
      && String(globalAutomationLock?.automationType || "").toLowerCase() === "feature"
      && Number.isInteger(activeTargetId)
      && activeTargetId > 0
  );

  if (isFeatureRunActive && Number.isInteger(activeFeatureQueueFeatureId) && activeTargetId === activeFeatureQueueFeatureId) {
    return;
  }

  if (Number.isInteger(activeFeatureQueueFeatureId) && !isFeatureRunActive) {
    if (Number.parseInt(featureAutomationQueue[0], 10) === activeFeatureQueueFeatureId) {
      featureAutomationQueue.shift();
    }
    activeFeatureQueueFeatureId = null;
  }

  if (!isAnyAutomationInFlight()) {
    maybeAdvanceFeatureQueue().catch((error) => {
      createStatusBox.textContent = `Feature queue failed: ${error.message}`;
    });
  }
}

async function runFeatureAutomationQueue() {
  if (isFeatureQueueRunning) {
    createStatusBox.textContent = "Feature queue is already running.";
    return;
  }

  if (!featureAutomationQueue.length) {
    createStatusBox.textContent = "Add at least one incomplete feature to the feature queue first.";
    return;
  }

  if (isAnyAutomationInFlight()) {
    createStatusBox.textContent = "Automation is already running. Wait for completion before starting the feature queue.";
    return;
  }

  isFeatureQueueRunning = true;
  activeFeatureQueueFeatureId = null;
  createStatusBox.textContent = `Feature queue started with ${featureAutomationQueue.length} feature(s).`;
  renderFeatureLists();
  await maybeAdvanceFeatureQueue();
}

function renderFeatureQueue(incompleteFeatures = []) {
  if (!featureQueueContainer || !runFeatureQueueButton || !clearFeatureQueueButton) {
    return;
  }

  pruneFeatureAutomationQueue(incompleteFeatures);
  reconcileFeatureQueueProgress();
  featureQueueContainer.innerHTML = "";

  if (!featureAutomationQueue.length) {
    featureQueueContainer.appendChild(
      createTextNode("p", "empty-card-copy", "No queued features. Use 'Add to Feature Queue' in a feature card.")
    );
  } else {
    for (let index = 0; index < featureAutomationQueue.length; index += 1) {
      const featureId = Number.parseInt(featureAutomationQueue[index], 10);
      const feature = findFeatureById(featureId);
      const row = document.createElement("div");
      row.className = "feature-queue-item";

      const label = document.createElement("p");
      label.className = "feature-queue-item__label";
      const prefix = Number.isInteger(activeFeatureQueueFeatureId) && activeFeatureQueueFeatureId === featureId && isFeatureQueueRunning
        ? "Running"
        : "Queued";
      label.textContent = `${index + 1}. ${prefix}: ${feature?.name || `Feature #${featureId}`}`;
      row.appendChild(label);

      const controls = document.createElement("div");
      controls.className = "feature-queue-item__controls";

      const moveUpButton = document.createElement("button");
      moveUpButton.type = "button";
      moveUpButton.className = "secondary-button";
      moveUpButton.textContent = "Move Up";
      moveUpButton.disabled = isFeatureQueueRunning || index === 0;
      moveUpButton.addEventListener("click", () => {
        moveFeatureQueueItem(featureId, -1);
      });
      controls.appendChild(moveUpButton);

      const moveDownButton = document.createElement("button");
      moveDownButton.type = "button";
      moveDownButton.className = "secondary-button";
      moveDownButton.textContent = "Move Down";
      moveDownButton.disabled = isFeatureQueueRunning || index >= featureAutomationQueue.length - 1;
      moveDownButton.addEventListener("click", () => {
        moveFeatureQueueItem(featureId, 1);
      });
      controls.appendChild(moveDownButton);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "secondary-button";
      removeButton.textContent = "Remove";
      removeButton.disabled = isFeatureQueueRunning;
      removeButton.addEventListener("click", () => {
        toggleFeatureInQueue(featureId);
      });
      controls.appendChild(removeButton);

      row.appendChild(controls);
      featureQueueContainer.appendChild(row);
    }
  }

  runFeatureQueueButton.disabled = isFeatureQueueRunning || !featureAutomationQueue.length || isAnyAutomationInFlight();
  runFeatureQueueButton.textContent = isFeatureQueueRunning ? "Feature Queue Running..." : "Complete Queue with Automation";
  clearFeatureQueueButton.disabled = !featureAutomationQueue.length;
}

function renderSection(container, features, options = {}) {
  container.innerHTML = "";

  if (!features.length) {
    container.appendChild(createTextNode("p", "empty-card-copy", "No features found."));
    return;
  }

  for (const feature of features) {
    container.appendChild(renderFeatureCard(feature, options));
  }
}

function renderFeatureLists() {
  const incompleteQuery = incompleteSearchInput.value.trim();
  const completeQuery = completeSearchInput.value.trim();

  const incompleteFeatures = allFeatures
    .filter((feature) => !isFeatureComplete(feature))
    .filter((feature) => matchesQuery(feature, incompleteQuery));

  const completeFeatures = allFeatures
    .filter((feature) => isFeatureComplete(feature))
    .filter((feature) => matchesQuery(feature, completeQuery));

  syncAutomationDrivenCardState(incompleteFeatures);
  renderFeatureQueue(incompleteFeatures);
  renderSection(incompleteListContainer, incompleteFeatures, { showAutomation: true });
  renderSection(completeListContainer, completeFeatures, { showAutomation: false });

  const signature = getAutomationUiSignature();
  if (signature !== lastAutomationUiSignature) {
    maybeAlertAutomationStop();
    scrollActiveStoryCardIntoView();
    lastAutomationUiSignature = signature;
  }
}

function createStoryDraft() {
  return {
    id: storyDraftId++,
    name: "",
    description: ""
  };
}

function createEpicDraft() {
  return {
    id: epicDraftId++,
    name: "",
    description: "",
    stories: []
  };
}

function syncDraftFromInputs() {
  for (const epic of epicDrafts) {
    const epicNameInput = document.getElementById(`epic-name-${epic.id}`);
    const epicDescriptionInput = document.getElementById(`epic-description-${epic.id}`);
    epic.name = epicNameInput?.value || "";
    epic.description = epicDescriptionInput?.value || "";

    for (const story of epic.stories) {
      const storyNameInput = document.getElementById(`story-name-${story.id}`);
      const storyDescriptionInput = document.getElementById(`story-description-${story.id}`);
      story.name = storyNameInput?.value || "";
      story.description = storyDescriptionInput?.value || "";
    }
  }
}

function renderDrafts() {
  epicDraftsContainer.innerHTML = "";

  for (const epic of epicDrafts) {
    const epicCard = document.createElement("article");
    epicCard.className = "hier-card hier-card--epic-draft";

    const epicHeader = document.createElement("header");
    epicHeader.className = "hier-card__header";
    epicHeader.appendChild(createTextNode("strong", "", "Epic Draft"));
    epicCard.appendChild(epicHeader);

    const epicContent = document.createElement("div");
    epicContent.className = "hier-card__content";

    const epicNameLabel = createTextNode("label", "", "Epic Name");
    epicNameLabel.setAttribute("for", `epic-name-${epic.id}`);
    const epicNameInput = document.createElement("input");
    epicNameInput.id = `epic-name-${epic.id}`;
    epicNameInput.type = "text";
    epicNameInput.placeholder = "Epic name";
    epicNameInput.value = epic.name;

    const epicDescriptionLabel = createTextNode("label", "", "Epic Description");
    epicDescriptionLabel.setAttribute("for", `epic-description-${epic.id}`);
    const epicDescriptionInput = document.createElement("textarea");
    epicDescriptionInput.id = `epic-description-${epic.id}`;
    epicDescriptionInput.rows = 3;
    epicDescriptionInput.placeholder = "Epic description";
    epicDescriptionInput.value = epic.description;

    const epicButtons = document.createElement("div");
    epicButtons.className = "draft-actions";
    const addStoryButton = document.createElement("button");
    addStoryButton.type = "button";
    addStoryButton.className = "secondary-button";
    addStoryButton.textContent = "Add Story";
    addStoryButton.addEventListener("click", () => {
      syncDraftFromInputs();
      epic.stories.push(createStoryDraft());
      renderDrafts();
    });

    const removeEpicButton = document.createElement("button");
    removeEpicButton.type = "button";
    removeEpicButton.className = "secondary-button";
    removeEpicButton.textContent = "Remove Epic";
    removeEpicButton.addEventListener("click", () => {
      const index = epicDrafts.findIndex((draft) => draft.id === epic.id);
      if (index >= 0) {
        epicDrafts.splice(index, 1);
        renderDrafts();
      }
    });

    epicButtons.appendChild(addStoryButton);
    epicButtons.appendChild(removeEpicButton);

    const storyStack = document.createElement("div");
    storyStack.className = "hier-stack";

    for (const story of epic.stories) {
      const storyCard = document.createElement("article");
      storyCard.className = "hier-card hier-card--story-draft";
      const storyHeader = document.createElement("header");
      storyHeader.className = "hier-card__header";
      storyHeader.appendChild(createTextNode("strong", "", "Story Draft"));
      storyCard.appendChild(storyHeader);

      const storyContent = document.createElement("div");
      storyContent.className = "hier-card__content";

      const storyNameLabel = createTextNode("label", "", "Story Name");
      storyNameLabel.setAttribute("for", `story-name-${story.id}`);
      const storyNameInput = document.createElement("input");
      storyNameInput.id = `story-name-${story.id}`;
      storyNameInput.type = "text";
      storyNameInput.placeholder = "Story name";
      storyNameInput.value = story.name;

      const storyDescriptionLabel = createTextNode("label", "", "Story Description");
      storyDescriptionLabel.setAttribute("for", `story-description-${story.id}`);
      const storyDescriptionInput = document.createElement("textarea");
      storyDescriptionInput.id = `story-description-${story.id}`;
      storyDescriptionInput.rows = 2;
      storyDescriptionInput.placeholder = "Story description";
      storyDescriptionInput.value = story.description;

      const removeStoryButton = document.createElement("button");
      removeStoryButton.type = "button";
      removeStoryButton.className = "secondary-button";
      removeStoryButton.textContent = "Remove Story";
      removeStoryButton.addEventListener("click", () => {
        syncDraftFromInputs();
        const storyIndex = epic.stories.findIndex((draftStory) => draftStory.id === story.id);
        if (storyIndex >= 0) {
          epic.stories.splice(storyIndex, 1);
          renderDrafts();
        }
      });

      storyContent.appendChild(storyNameLabel);
      storyContent.appendChild(storyNameInput);
      storyContent.appendChild(storyDescriptionLabel);
      storyContent.appendChild(storyDescriptionInput);
      storyContent.appendChild(removeStoryButton);
      storyCard.appendChild(storyContent);
      storyStack.appendChild(storyCard);
    }

    epicContent.appendChild(epicNameLabel);
    epicContent.appendChild(epicNameInput);
    epicContent.appendChild(epicDescriptionLabel);
    epicContent.appendChild(epicDescriptionInput);
    epicContent.appendChild(epicButtons);
    epicContent.appendChild(storyStack);
    epicCard.appendChild(epicContent);
    epicDraftsContainer.appendChild(epicCard);
  }
}

function clearDraftForm() {
  featureNameInput.value = "";
  featureDescriptionInput.value = "";
  epicDrafts.length = 0;
  renderDrafts();
}

async function loadFeatures({ shouldRender = true } = {}) {
  if (!automationScope.projectName || !automationScope.baseBranch) {
    allFeatures = [];
    if (shouldRender) {
      renderFeatureLists();
    }
    return;
  }

  const query = new URLSearchParams({
    projectName: automationScope.projectName,
    baseBranch: automationScope.baseBranch
  });
  const response = await fetch(`/api/features/tree?${query.toString()}`);
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Failed to load features.");
  }

  allFeatures = result;
  if (shouldRender) {
    renderFeatureLists();
  }
}

async function loadAutomationContextBundles() {
  const requestId = ++loadAutomationContextBundlesRequestId;

  try {
    const response = await fetch("/api/context-bundles?includeParts=false");
    const result = await response.json();
    if (requestId !== loadAutomationContextBundlesRequestId) {
      return;
    }

    if (!response.ok) {
      throw new Error(result.error || "Failed to load context bundles.");
    }

    automationContextBundleOptions = (Array.isArray(result) ? result : [])
      .map((bundle) => ({
        ...bundle,
        id: Number.parseInt(bundle?.id, 10)
      }))
      .filter((bundle) => Number.isInteger(bundle.id) && bundle.id > 0);
  } catch (error) {
    if (requestId !== loadAutomationContextBundlesRequestId) {
      return;
    }

    automationContextBundleOptions = [];
    createStatusBox.textContent = `Context bundle load failed: ${error.message}`;
  } finally {
    if (requestId === loadAutomationContextBundlesRequestId) {
      renderFeatureLists();
    }
  }
}

async function reloadAllData() {
  await loadFeatures();
}

async function loadAutomationLock() {
  const response = await fetch("/api/automation-lock");
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Failed to load automation lock.");
  }

  globalAutomationLock = result;
  const activeRunId = Number.parseInt(result?.automationRunId, 10);
  if (result?.isActive && Number.isInteger(activeRunId) && activeRunId > 0) {
    persistAutomationStateSnapshot(automationScope, {
      lastAutomationRunId: activeRunId
    });
  }
}

async function loadAutomationStatus() {
  const activeRunId = Number.parseInt(globalAutomationLock?.automationRunId, 10);
  const persistedRunId = parsePersistedAutomationRunId(automationScope);
  const runId = Number.isInteger(activeRunId) && activeRunId > 0
    ? activeRunId
    : persistedRunId;

  if (!Number.isInteger(runId) || runId <= 0) {
    globalAutomationStatus = null;
    return;
  }

  const response = await fetch(`/api/automation/status/${encodeURIComponent(String(runId))}`);
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Failed to load automation status.");
  }

  globalAutomationStatus = result;
  const statusRunId = Number.parseInt(result?.automationRun?.id, 10);
  const statusScope = {
    projectName: String(result?.automationRun?.projectName || automationScope.projectName || "").trim(),
    baseBranch: String(result?.automationRun?.baseBranch || automationScope.baseBranch || "").trim()
  };
  if (Number.isInteger(statusRunId) && statusRunId > 0) {
    persistAutomationStateSnapshot(statusScope, {
      lastAutomationRunId: statusRunId,
      lastAutomationStatus: result
    });
  }
}

async function refreshAutomationState() {
  await loadAutomationLock();
  await loadAutomationStatus();
  await loadFeatures({ shouldRender: false });
  renderFeatureLists();
}

async function saveFeatureTree() {
  if (!automationScope.projectName || !automationScope.baseBranch) {
    createStatusBox.textContent = "Project and branch are required. Return to the editor page first.";
    return;
  }

  syncDraftFromInputs();

  const draft = {
    name: featureNameInput.value.trim(),
    description: featureDescriptionInput.value.trim(),
    epics: epicDrafts.map((epic) => ({
      name: epic.name.trim(),
      description: epic.description.trim(),
      stories: epic.stories.map((story) => ({
        name: story.name.trim(),
        description: story.description.trim()
      }))
    }))
  };

  if (!draft.name) {
    createStatusBox.textContent = "Feature name is required.";
    return;
  }

  saveFeatureButton.disabled = true;
  createStatusBox.textContent = "Saving feature tree...";

  try {
    const response = await fetch("/api/features/tree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...draft,
        projectName: automationScope.projectName,
        baseBranch: automationScope.baseBranch
      })
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Feature save failed.");
    }

    allFeatures = result;
    renderFeatureLists();
    clearDraftForm();
    createStatusBox.textContent = "Feature tree saved.";
  } catch (error) {
    createStatusBox.textContent = `Save failed: ${error.message}`;
  } finally {
    saveFeatureButton.disabled = false;
  }
}

async function createFeaturesFromManifest() {
  if (!automationScope.projectName || !automationScope.baseBranch) {
    createStatusBox.textContent = "Project and branch are required. Return to the editor page first.";
    return;
  }

  const manifestJson = manifestJsonInput.value.trim();
  if (!manifestJson) {
    createStatusBox.textContent = "Paste a JSON manifest first.";
    return;
  }

  createManifestButton.disabled = true;
  createStatusBox.textContent = "Creating features from JSON manifest...";

  try {
    const response = await fetch("/api/features/tree/from-manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectName: automationScope.projectName,
        baseBranch: automationScope.baseBranch,
        manifestJson
      })
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Manifest creation failed.");
    }

    allFeatures = Array.isArray(result.features) ? result.features : [];
    renderFeatureLists();
    manifestJsonInput.value = "";
    createStatusBox.textContent = `Created ${result.createdFeatureCount} feature(s) from manifest.`;
  } catch (error) {
    createStatusBox.textContent = `Manifest create failed: ${error.message}`;
  } finally {
    createManifestButton.disabled = false;
  }
}

backButton.addEventListener("click", () => {
  const query = new URLSearchParams();
  if (automationScope.projectName) {
    query.set("projectName", automationScope.projectName);
  }
  if (automationScope.baseBranch) {
    query.set("baseBranch", automationScope.baseBranch);
  }
  const suffix = query.toString();
  window.location.href = suffix ? `/?${suffix}` : "/";
});

addEpicButton.addEventListener("click", () => {
  syncDraftFromInputs();
  epicDrafts.push(createEpicDraft());
  renderDrafts();
});

saveFeatureButton.addEventListener("click", saveFeatureTree);
createManifestButton.addEventListener("click", createFeaturesFromManifest);
runFeatureQueueButton.addEventListener("click", () => {
  runFeatureAutomationQueue().catch((error) => {
    createStatusBox.textContent = `Feature queue failed to start: ${error.message}`;
  });
});
clearFeatureQueueButton.addEventListener("click", () => {
  clearFeatureAutomationQueue();
});
incompleteSearchInput.addEventListener("input", renderFeatureLists);
completeSearchInput.addEventListener("input", renderFeatureLists);
clearIncompleteSearchButton.addEventListener("click", () => {
  incompleteSearchInput.value = "";
  renderFeatureLists();
});
clearCompleteSearchButton.addEventListener("click", () => {
  completeSearchInput.value = "";
  renderFeatureLists();
});

setInterval(() => {
  refreshAutomationState().catch((error) => {
    createStatusBox.textContent = `Automation lock refresh failed: ${error.message}`;
  });
}, 3000);

setInterval(() => {
  refreshActiveStoryRuntimeIndicators();
}, 1000);

(async () => {
  try {
    wireStaticCardToggle(createFeatureCardToggle, createFeatureCardContent, { defaultOpen: false });
    wireStaticCardToggle(manifestCardToggle, manifestCardContent, { defaultOpen: false });
    wireStaticCardToggle(featureQueueCardToggle, featureQueueCardContent, { defaultOpen: true });
    automationScope = readScopeFromUrlOrState();
    syncScopeIntoEditorState(automationScope);
    hydrateAutomationStatusFromPersistence();
    renderScopeHint();
    renderFeatureLists();
    await reloadAllData();
    await loadAutomationContextBundles();
    await refreshAutomationState();
    renderDrafts();
  } catch (error) {
    createStatusBox.textContent = `Initial load failed: ${error.message}`;
  }
})();
