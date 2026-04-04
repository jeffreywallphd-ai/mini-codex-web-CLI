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

let allFeatures = [];
let completionRuns = [];
let epicDraftId = 0;
let storyDraftId = 0;
const epicDrafts = [];

function normalizeStatus(status) {
  if (status === "complete") return "complete";
  if (status === "incomplete") return "incomplete";
  return "unknown";
}

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

function createCollapsibleCard({ levelClass, name, status, renderBody }) {
  const card = document.createElement("article");
  card.className = `hier-card ${levelClass}`;
  const headerButton = createCardHeader(name, status);
  const content = document.createElement("div");
  content.className = "hier-card__content hidden";

  let isOpen = false;
  headerButton.addEventListener("click", () => {
    isOpen = !isOpen;
    headerButton.classList.toggle("is-open", isOpen);
    content.classList.toggle("hidden", !isOpen);

    if (isOpen) {
      renderBody(content);
    } else {
      content.innerHTML = "";
    }
  });

  const header = document.createElement("header");
  header.className = "hier-card__header";
  header.appendChild(headerButton);
  card.appendChild(header);
  card.appendChild(content);
  return card;
}

function buildRunSummary(run) {
  const title = run.change_title ? ` | ${run.change_title}` : "";
  const completion = normalizeStatus(run.completion_status);
  return `#${run.id} | ${run.project_name || "project"}${title} | ${completion}`;
}

function createStorySyncUi(content, story) {
  const row = document.createElement("div");
  row.className = "story-sync-row";

  const select = document.createElement("select");
  select.className = "story-run-select";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Select run to sync completion";
  select.appendChild(defaultOption);

  for (const run of completionRuns) {
    const option = document.createElement("option");
    option.value = String(run.id);
    option.textContent = buildRunSummary(run);
    if (story.completion_run_id === run.id) {
      option.selected = true;
    }
    select.appendChild(option);
  }

  const syncButton = document.createElement("button");
  syncButton.type = "button";
  syncButton.className = "secondary-button";
  syncButton.textContent = "Sync Status From Run";

  const hint = createTextNode("p", "inline-hint", "Story status is persisted based on selected run completion status.");

  syncButton.addEventListener("click", async () => {
    const runId = Number.parseInt(select.value, 10);
    if (!Number.isInteger(runId)) {
      createStatusBox.textContent = "Select a run before syncing story completion.";
      return;
    }

    syncButton.disabled = true;
    createStatusBox.textContent = `Syncing story #${story.id} completion from run #${runId}...`;

    try {
      const response = await fetch(`/api/stories/${story.id}/sync-completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId })
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to sync story completion.");
      }

      createStatusBox.textContent = result.isComplete
        ? `Story #${story.id} marked complete from run #${runId}.`
        : `Story #${story.id} marked incomplete from run #${runId}.`;
      await reloadAllData();
    } catch (error) {
      createStatusBox.textContent = `Sync failed: ${error.message}`;
    } finally {
      syncButton.disabled = false;
    }
  });

  row.appendChild(select);
  row.appendChild(syncButton);
  content.appendChild(row);
  content.appendChild(hint);
}

function renderStoryCard(story) {
  return createCollapsibleCard({
    levelClass: "hier-card--story",
    name: story.name,
    status: getStoryStatus(story),
    renderBody: (content) => {
      createDescription(content, story.description);
      createStorySyncUi(content, story);
    }
  });
}

function renderEpicCard(epic) {
  return createCollapsibleCard({
    levelClass: "hier-card--epic",
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
        stack.appendChild(renderStoryCard(story));
      }
      content.appendChild(stack);
    }
  });
}

function renderFeatureCard(feature) {
  return createCollapsibleCard({
    levelClass: "hier-card--feature",
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
        stack.appendChild(renderEpicCard(epic));
      }
      content.appendChild(stack);
    }
  });
}

function renderSection(container, features) {
  container.innerHTML = "";

  if (!features.length) {
    container.appendChild(createTextNode("p", "empty-card-copy", "No features found."));
    return;
  }

  for (const feature of features) {
    container.appendChild(renderFeatureCard(feature));
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

  renderSection(incompleteListContainer, incompleteFeatures);
  renderSection(completeListContainer, completeFeatures);
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
  const response = await fetch("/api/features/tree");
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Failed to load features.");
  }

  allFeatures = result;
  renderFeatureLists();
}

async function loadCompletionRuns() {
  const response = await fetch("/api/features/completion-runs");
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Failed to load completion runs.");
  }

  completionRuns = result;
}

async function reloadAllData() {
  await Promise.all([loadFeatures(), loadCompletionRuns()]);
}

async function saveFeatureTree() {
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
      body: JSON.stringify(draft)
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
  window.location.href = "/";
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

(async () => {
  try {
    await reloadAllData();
    renderDrafts();
  } catch (error) {
    createStatusBox.textContent = `Initial load failed: ${error.message}`;
  }
})();
