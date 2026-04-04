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

function createDescription(content, text) {
  content.appendChild(createTextNode("p", "card-description", text || "(no description)"));
}

function formatContextBundleOption(bundle) {
  const title = String(bundle?.title || "").trim() || "Untitled Bundle";
  const intendedUse = String(bundle?.intended_use || "").trim();
  const summary = String(bundle?.summary || "").trim();
  const meta = [intendedUse, summary].filter(Boolean).join(" | ");
  return meta ? `${title} - ${meta}` : title;
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
    if (featureAutomationStartInFlight.has(feature.id)) {
      createStatusBox.textContent = "Feature automation start is already being requested for this feature.";
      return;
    }

    if (isAnyAutomationInFlight() && !isActiveFeatureRun) {
      createStatusBox.textContent = "Automation is already running. Wait for completion before starting another run.";
      return;
    }

    if (isActiveFeatureRun) {
      createStatusBox.textContent = "Feature automation is already running for this feature.";
      return;
    }

    openCards.add(`feature:${feature.id}`);
    featureAutomationStartInFlight.add(feature.id);
    renderFeatureLists();

    try {
      const selectedContextBundleId = parseSelectedContextBundleId(contextBundleSelect.value);
      const result = isResumeEligible
        ? await resumeAutomationRun(feature.feature_automation_run_id, {
          contextBundleId: selectedContextBundleId
        })
        : await startFeatureAutomation(feature.id, {
          stopOnIncompleteStory: stopOnIncompleteCheckbox.checked,
          contextBundleId: selectedContextBundleId
        });
      assertAutomationStartScope(result, {
        automationType: "feature",
        targetId: feature.id
      });
      const runId = result?.automationRun?.id;
      const totalStories = result?.queue?.totalStories;
      const isResumeLaunch = String(result?.launchMode || "").toLowerCase() === "resume";
      createStatusBox.textContent = Number.isInteger(runId)
        ? (isResumeLaunch
          ? `Feature automation resumed for feature #${feature.id} (run #${runId}, ${totalStories} remaining story(s) queued).`
          : `Feature automation started for feature #${feature.id} (run #${runId}, ${totalStories} story(s) queued).`)
        : (isResumeLaunch
          ? `Feature automation resumed for feature #${feature.id}.`
          : `Feature automation started for feature #${feature.id}.`);
      await refreshAutomationState();
    } catch (error) {
      createStatusBox.textContent = isAutomationAlreadyRunningError(error)
        ? `Automation is already running. ${error.message}`
        : `Feature automation failed to start: ${error.message}`;
    } finally {
      featureAutomationStartInFlight.delete(feature.id);
      renderFeatureLists();
    }
  });

  content.appendChild(button);
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
      createStatusBox.textContent = Number.isInteger(runId)
        ? (isResumeLaunch
          ? `Epic automation resumed for epic #${epic.id} (run #${runId}, ${totalStories} remaining story(s) queued).`
          : `Epic automation started for epic #${epic.id} (run #${runId}, ${totalStories} story(s) queued).`)
        : (isResumeLaunch
          ? `Epic automation resumed for epic #${epic.id}.`
          : `Epic automation started for epic #${epic.id}.`);
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

  content.appendChild(button);
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
      createStatusBox.textContent = Number.isInteger(runId)
        ? (isResumeLaunch
          ? `Story automation resumed for story #${story.id} (run #${runId}, ${totalStories} remaining story queued).`
          : `Story automation started for story #${story.id} (run #${runId}, 1 story queued).`)
        : (isResumeLaunch
          ? `Story automation resumed for story #${story.id}.`
          : `Story automation started for story #${story.id} (1 story queued).`);
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

  content.appendChild(automationButton);
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
      createDescription(content, story.description);
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

function syncAutomationDrivenCardState() {
  const activeRun = globalAutomationStatus?.automationRun || null;
  const activeStory = getActiveQueueStoryRuntimeContext();

  if (activeRun && String(activeRun.status || "").toLowerCase() === "running") {
    if (String(activeRun.automationType || "").toLowerCase() === "feature") {
      openCards.add(`feature:${activeRun.targetId}`);
    }
    if (activeStory?.featureId) {
      openCards.add(`feature:${activeStory.featureId}`);
    }
    if (activeStory?.epicId) {
      openCards.add(`epic:${activeStory.epicId}`);
    }
    if (activeStory?.storyId) {
      openCards.add(`story:${activeStory.storyId}`);
    }
  }

  const processedStoryIds = getLatestProcessedStoryIdsFromAutomation();
  for (const storyId of processedStoryIds) {
    openCards.delete(`story:${storyId}`);
  }

  for (const feature of allFeatures) {
    for (const epic of feature?.epics || []) {
      if (isEpicComplete(epic)) {
        openCards.delete(`epic:${epic.id}`);
      }
    }
  }

  if (activeRun && String(activeRun.status || "").toLowerCase() !== "running") {
    if (String(activeRun.automationType || "").toLowerCase() === "feature") {
      openCards.delete(`feature:${activeRun.targetId}`);
      removeFeatureDescendantOpenCards(activeRun.targetId);
    }
  }
}

function maybeAlertMergeFailure() {
  const finalResult = globalAutomationStatus?.finalResult;
  const isMergeFailure = finalResult
    && String(finalResult.status || "").toLowerCase() === "failed"
    && String(finalResult.stopReason || "").toLowerCase() === "merge_failed";
  if (!isMergeFailure) {
    return;
  }

  const runId = Number.parseInt(globalAutomationStatus?.automationRun?.id, 10);
  const runLabel = Number.isInteger(runId) ? ` (run #${runId})` : "";
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
  syncAutomationDrivenCardState();
  const incompleteQuery = incompleteSearchInput.value.trim();
  const completeQuery = completeSearchInput.value.trim();

  const incompleteFeatures = allFeatures
    .filter((feature) => !isFeatureComplete(feature))
    .filter((feature) => matchesQuery(feature, incompleteQuery));

  const completeFeatures = allFeatures
    .filter((feature) => isFeatureComplete(feature))
    .filter((feature) => matchesQuery(feature, completeQuery));

  renderSection(incompleteListContainer, incompleteFeatures, { showAutomation: true });
  renderSection(completeListContainer, completeFeatures, { showAutomation: false });

  const signature = getAutomationUiSignature();
  if (signature !== lastAutomationUiSignature) {
    maybeAlertMergeFailure();
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
    wireStaticCardToggle(createFeatureCardToggle, createFeatureCardContent, { defaultOpen: true });
    wireStaticCardToggle(manifestCardToggle, manifestCardContent, { defaultOpen: false });
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
