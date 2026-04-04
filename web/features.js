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
const stopRunForIncompleteStoriesByFeatureId = new Map();
const stopRunForIncompleteStoriesByEpicId = new Map();

function isStoryComplete(story) {
  return Boolean(story?.is_complete);
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

async function startStoryAutomation(storyId) {
  const projectName = automationScope.projectName;
  const baseBranch = automationScope.baseBranch;
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
      storyId
    })
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Unable to start story automation.");
  }

  return result;
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
  let count = 0;
  for (const epic of feature.epics || []) {
    for (const story of epic.stories || []) {
      if (!isStoryComplete(story)) {
        count += 1;
      }
    }
  }

  return count;
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
      positionInQueue: Number.parseInt(item?.positionInQueue, 10) || null,
      executionStatus: String(item?.executionStatus || "").trim().toLowerCase() || "unknown",
      runId: parseRunId(item?.runId)
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
    const storyLabel = Number.isInteger(item.storyId) && item.storyId > 0
      ? `Story #${item.storyId}`
      : "Story";
    const statusLabel = item.executionStatus || "unknown";
    line.appendChild(document.createTextNode(`${storyLabel}: ${statusLabel} - `));
    appendRunDetailsInline(line, item.runId);
    content.appendChild(line);
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
      featureId
    })
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Unable to start feature automation.");
  }

  return result;
}

async function startEpicAutomation(epicId, options = {}) {
  const projectName = automationScope.projectName;
  const baseBranch = automationScope.baseBranch;
  const stopOnIncompleteStory = Boolean(options.stopOnIncompleteStory);
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
      epicId
    })
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Unable to start epic automation.");
  }

  return result;
}

function createFeatureAutomationUi(content, feature) {
  if (isFeatureComplete(feature)) {
    return;
  }

  const incompleteStoryCount = getIncompleteStoryCountForFeature(feature);
  if (incompleteStoryCount <= 0) {
    content.appendChild(createTextNode("p", "inline-hint", "No incomplete stories in this feature."));
    return;
  }

  const isActiveFeatureRun = Boolean(
    globalAutomationLock?.isActive
      && globalAutomationLock?.automationType === "feature"
      && Number(globalAutomationLock?.targetId) === Number(feature.id)
  );
  const isFeatureStartInFlight = featureAutomationStartInFlight.has(feature.id);

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
    : "Complete with Automation";
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
      const result = await startFeatureAutomation(feature.id, {
        stopOnIncompleteStory: stopOnIncompleteCheckbox.checked
      });
      assertAutomationStartScope(result, {
        automationType: "feature",
        targetId: feature.id
      });
      const runId = result?.automationRun?.id;
      const totalStories = result?.queue?.totalStories;
      createStatusBox.textContent = Number.isInteger(runId)
        ? `Feature automation started for feature #${feature.id} (run #${runId}, ${totalStories} story(s) queued).`
        : `Feature automation started for feature #${feature.id}.`;
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
  let count = 0;
  for (const story of epic.stories || []) {
    if (!isStoryComplete(story)) {
      count += 1;
    }
  }

  return count;
}

function createEpicAutomationUi(content, epic) {
  if (isEpicComplete(epic)) {
    return;
  }

  const incompleteStoryCount = getIncompleteStoryCountForEpic(epic);
  if (incompleteStoryCount <= 0) {
    content.appendChild(createTextNode("p", "inline-hint", "No incomplete stories in this epic."));
    return;
  }

  const isActiveEpicRun = Boolean(
    globalAutomationLock?.isActive
      && globalAutomationLock?.automationType === "epic"
      && Number(globalAutomationLock?.targetId) === Number(epic.id)
  );
  const isEpicStartInFlight = epicAutomationStartInFlight.has(epic.id);

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
    : "Complete with Automation";
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
      const result = await startEpicAutomation(epic.id, {
        stopOnIncompleteStory: stopOnIncompleteCheckbox.checked
      });
      assertAutomationStartScope(result, {
        automationType: "epic",
        targetId: epic.id
      });
      const runId = result?.automationRun?.id;
      const totalStories = result?.queue?.totalStories;
      createStatusBox.textContent = Number.isInteger(runId)
        ? `Epic automation started for epic #${epic.id} (run #${runId}, ${totalStories} story(s) queued).`
        : `Epic automation started for epic #${epic.id}.`;
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

  if (isStoryComplete(story)) {
    return;
  }

  const isActiveStoryRun = Boolean(
    globalAutomationLock?.isActive
      && globalAutomationLock?.automationType === "story"
      && Number(globalAutomationLock?.targetId) === Number(story?.id)
  );
  const isStoryStartInFlight = storyAutomationInFlight.has(story.id);
  const isGlobalRunActive = isAnyAutomationInFlight();

  const automationButton = document.createElement("button");
  automationButton.type = "button";
  automationButton.className = "secondary-button";
  automationButton.textContent = isStoryStartInFlight || isActiveStoryRun
    ? "Automation Running..."
    : "Complete with Automation";
  automationButton.disabled = isGlobalRunActive && !isStoryStartInFlight;

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
      const result = await startStoryAutomation(story.id);
      assertAutomationStartScope(result, {
        automationType: "story",
        targetId: story.id,
        enforceSingleStory: true
      });
      const runId = result?.automationRun?.id;
      createStatusBox.textContent = Number.isInteger(runId)
        ? `Story automation started for story #${story.id} (run #${runId}, 1 story queued).`
        : `Story automation started for story #${story.id} (1 story queued).`;
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

  renderSection(incompleteListContainer, incompleteFeatures, { showAutomation: true });
  renderSection(completeListContainer, completeFeatures, { showAutomation: false });
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

async function loadFeatures() {
  if (!automationScope.projectName || !automationScope.baseBranch) {
    allFeatures = [];
    renderFeatureLists();
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
  renderFeatureLists();
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
}

async function loadAutomationStatus() {
  globalAutomationStatus = null;

  const runId = Number.parseInt(globalAutomationLock?.automationRunId, 10);
  const shouldLoadStatus = Boolean(globalAutomationLock?.isActive) && Number.isInteger(runId) && runId > 0;
  if (!shouldLoadStatus) {
    return;
  }

  const response = await fetch(`/api/automation/status/${encodeURIComponent(String(runId))}`);
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Failed to load automation status.");
  }

  globalAutomationStatus = result;
}

async function refreshAutomationState() {
  await loadAutomationLock();
  await loadAutomationStatus();
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

(async () => {
  try {
    wireStaticCardToggle(createFeatureCardToggle, createFeatureCardContent, { defaultOpen: true });
    wireStaticCardToggle(manifestCardToggle, manifestCardContent, { defaultOpen: false });
    automationScope = readScopeFromUrlOrState();
    syncScopeIntoEditorState(automationScope);
    renderScopeHint();
    await reloadAllData();
    await refreshAutomationState();
    renderDrafts();
  } catch (error) {
    createStatusBox.textContent = `Initial load failed: ${error.message}`;
  }
})();
