const backButton = document.getElementById("backButton");
const createStatusBox = document.getElementById("createStatusBox");
const featureNameInput = document.getElementById("featureNameInput");
const featureDescriptionInput = document.getElementById("featureDescriptionInput");
const addEpicButton = document.getElementById("addEpicButton");
const saveFeatureButton = document.getElementById("saveFeatureButton");
const epicDraftsContainer = document.getElementById("epicDraftsContainer");
const incompleteSearchInput = document.getElementById("incompleteSearchInput");
const clearIncompleteSearchButton = document.getElementById("clearIncompleteSearchButton");
const completeSearchInput = document.getElementById("completeSearchInput");
const clearCompleteSearchButton = document.getElementById("clearCompleteSearchButton");
const incompleteListContainer = document.getElementById("incompleteListContainer");
const completeListContainer = document.getElementById("completeListContainer");
const scopeHint = document.getElementById("scopeHint");
const EDITOR_STATE_KEY = "mini-codex-editor-state";

let allFeatures = [];
const storyAutomationInFlight = new Set();
const openCards = new Set();
let automationScope = {
  projectName: "",
  baseBranch: ""
};
let globalAutomationLock = null;
let activeStoryAutomation = null;
let activeAutomationStream = null;
let automationTimerInterval = null;
let activeAutomationStatusMessage = "Automation status will appear here.";
let activeStoryAutomationTimerNode = null;
let activeStoryAutomationStatusNode = null;
let epicDraftId = 0;
let storyDraftId = 0;
const epicDrafts = [];
const stopMergeIfIncompleteByStoryId = new Map();

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

function renderScopeHint() {
  if (!automationScope.projectName || !automationScope.baseBranch) {
    scopeHint.textContent = "Project and base branch are required. Return to the editor page and select them first.";
    return;
  }

  scopeHint.textContent = `Project: ${automationScope.projectName} | Base branch: ${automationScope.baseBranch}`;
}

function renderAutomationTimer() {
  if (!activeStoryAutomationTimerNode) {
    return;
  }

  if (!activeStoryAutomation?.startedAt) {
    activeStoryAutomationTimerNode.textContent = "";
    activeStoryAutomationTimerNode.classList.add("hidden");
    return;
  }

  const elapsed = Date.now() - activeStoryAutomation.startedAt;
  activeStoryAutomationTimerNode.textContent = `Automation running for ${formatElapsed(elapsed)}`;
  activeStoryAutomationTimerNode.classList.remove("hidden");
}

function renderActiveAutomationStatus() {
  if (!activeStoryAutomationStatusNode) {
    return;
  }

  activeStoryAutomationStatusNode.textContent = activeAutomationStatusMessage;
}

function setActiveAutomationStatusMessage(message) {
  const normalized = String(message || "").trim();
  activeAutomationStatusMessage = normalized || "Automation status will appear here.";
  renderActiveAutomationStatus();
}

function resetActiveStoryAutomationAnchors() {
  activeStoryAutomationTimerNode = null;
  activeStoryAutomationStatusNode = null;
}

function startAutomationTimer() {
  renderAutomationTimer();
  if (automationTimerInterval) {
    clearInterval(automationTimerInterval);
  }
  automationTimerInterval = setInterval(renderAutomationTimer, 1000);
}

function stopAutomationTimer() {
  if (automationTimerInterval) {
    clearInterval(automationTimerInterval);
    automationTimerInterval = null;
  }
}

function createAutomationStreamId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `feature-run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function closeAutomationStream() {
  if (activeAutomationStream?.eventSource) {
    activeAutomationStream.eventSource.close();
  }
  activeAutomationStream = null;
}

function startAutomationStream(streamId) {
  closeAutomationStream();
  setActiveAutomationStatusMessage("Connected to live run stream.");

  const eventSource = new EventSource(`/api/run-test/stream/${encodeURIComponent(streamId)}`);
  activeAutomationStream = { streamId, eventSource };

  eventSource.onmessage = (event) => {
    if (!activeAutomationStream || activeAutomationStream.streamId !== streamId) {
      return;
    }

    try {
      const payload = JSON.parse(event.data || "{}");
      if (payload?.message) {
        setActiveAutomationStatusMessage(payload.message);
      }
    } catch (error) {
      console.warn("Failed to parse automation stream event", error);
    }
  };

  eventSource.onerror = () => {
    if (!activeAutomationStream || activeAutomationStream.streamId !== streamId) {
      return;
    }
    if (activeStoryAutomation) {
      setActiveAutomationStatusMessage("Live status disconnected; waiting for final automation result...");
    }
  };
}

function isAnyAutomationInFlight() {
  return storyAutomationInFlight.size > 0 || Boolean(globalAutomationLock?.isActive);
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

function createStoryAutomationUi(content, story) {
  const runLine = createTextNode("p", "inline-hint", getStoryRunStatusLabel(story));
  content.appendChild(runLine);

  const linkedRunId = Number.parseInt(story?.run_id, 10);
  if (Number.isInteger(linkedRunId) && linkedRunId > 0) {
    content.appendChild(createTextNode("p", "inline-hint", `Associated run: #${linkedRunId}`));
  }

  if (isStoryComplete(story)) {
    return;
  }

  const isGlobalRunActive = isAnyAutomationInFlight();
  const storyStopMergeCheckbox = document.createElement("input");
  storyStopMergeCheckbox.type = "checkbox";
  storyStopMergeCheckbox.checked = Boolean(stopMergeIfIncompleteByStoryId.get(story.id));
  storyStopMergeCheckbox.addEventListener("change", () => {
    stopMergeIfIncompleteByStoryId.set(story.id, storyStopMergeCheckbox.checked);
  });

  const storyStopMergeLabel = document.createElement("label");
  storyStopMergeLabel.className = "story-automation-checkbox";
  storyStopMergeLabel.appendChild(storyStopMergeCheckbox);
  storyStopMergeLabel.appendChild(document.createTextNode("Stop Merge if Story Implementation is Incomplete"));
  content.appendChild(storyStopMergeLabel);

  const automationButton = document.createElement("button");
  automationButton.type = "button";
  automationButton.className = "secondary-button";
  automationButton.textContent = storyAutomationInFlight.has(story.id)
    ? "Automation Running..."
    : "Complete with Automation";
  automationButton.disabled = isGlobalRunActive;

  automationButton.addEventListener("click", async () => {
    const projectName = automationScope.projectName;
    const baseBranch = automationScope.baseBranch;
    if (!projectName || !baseBranch) {
      createStatusBox.textContent = "Select a project and branch on the editor page first, then retry automation.";
      return;
    }
    if (isAnyAutomationInFlight()) {
      createStatusBox.textContent = "Automation is already running. Wait for completion before starting another story.";
      return;
    }

    const streamId = createAutomationStreamId();
    openCards.add(`feature:${story.feature_id}`);
    openCards.add(`epic:${story.epic_id}`);
    openCards.add(`story:${story.id}`);
    storyAutomationInFlight.add(story.id);
    activeStoryAutomation = {
      storyId: story.id,
      startedAt: Date.now(),
      streamId
    };
    setActiveAutomationStatusMessage("Automation status will appear here.");
    startAutomationTimer();
    startAutomationStream(streamId);
    renderFeatureLists();
    createStatusBox.textContent = `Starting automation for story #${story.id} on project ${projectName} (${baseBranch})...`;

    try {
      const response = await fetch(`/api/stories/${story.id}/complete-with-automation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName,
          baseBranch,
          streamId,
          stopMergeIfStoryImplementationIncomplete: storyStopMergeCheckbox.checked
        })
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to run story automation.");
      }

      allFeatures = Array.isArray(result.features) ? result.features : allFeatures;
      renderFeatureLists();
      if (result.autoMerge?.status === "merged") {
        createStatusBox.textContent = `Automation finished for story #${story.id}. Linked run #${result.runId}. Changes merged to '${result.baseBranch}'.`;
      } else if (result.autoMerge?.status === "skipped") {
        createStatusBox.textContent = `Automation finished for story #${story.id}. Linked run #${result.runId}. Auto-merge skipped: ${result.autoMerge.reason}.`;
      } else {
        createStatusBox.textContent = `Automation finished for story #${story.id}. Linked run #${result.runId}.`;
      }
      await loadAutomationLock();
    } catch (error) {
      createStatusBox.textContent = `Automation failed: ${error.message}`;
      await loadFeatures();
    } finally {
      storyAutomationInFlight.delete(story.id);
      activeStoryAutomation = null;
      closeAutomationStream();
      stopAutomationTimer();
      setActiveAutomationStatusMessage("Automation status will appear here.");
      renderFeatureLists();
    }
  });

  content.appendChild(automationButton);

  if (activeStoryAutomation?.storyId === story.id) {
    const timerNode = document.createElement("p");
    timerNode.className = "run-timer";
    content.appendChild(timerNode);

    const statusNode = document.createElement("div");
    statusNode.className = "story-automation-status";
    content.appendChild(statusNode);

    activeStoryAutomationTimerNode = timerNode;
    activeStoryAutomationStatusNode = statusNode;
    renderAutomationTimer();
    renderActiveAutomationStatus();
  }
}

function renderStoryCard(story, options = {}) {
  return createCollapsibleCard({
    levelClass: "hier-card--story",
    cardKey: `story:${story.id}`,
    name: story.name,
    status: getStoryStatus(story),
    renderBody: (content) => {
      createDescription(content, story.description);
      if (options.showAutomation) {
        createStoryAutomationUi(content, story);
      } else {
        const runStatusLine = createTextNode("p", "inline-hint", getStoryRunStatusLabel(story));
        content.appendChild(runStatusLine);
        const linkedRunId = Number.parseInt(story?.run_id, 10);
        if (Number.isInteger(linkedRunId) && linkedRunId > 0) {
          content.appendChild(createTextNode("p", "inline-hint", `Associated run: #${linkedRunId}`));
        }
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
  resetActiveStoryAutomationAnchors();
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
  loadAutomationLock().catch((error) => {
    createStatusBox.textContent = `Automation lock refresh failed: ${error.message}`;
  });
}, 3000);

(async () => {
  try {
    automationScope = readScopeFromUrlOrState();
    syncScopeIntoEditorState(automationScope);
    renderScopeHint();
    await reloadAllData();
    await loadAutomationLock();
    renderDrafts();
  } catch (error) {
    createStatusBox.textContent = `Initial load failed: ${error.message}`;
  }
})();
