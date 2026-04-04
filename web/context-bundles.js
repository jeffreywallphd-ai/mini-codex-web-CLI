const bundleStatusBox = document.getElementById("bundleStatusBox");
const editingHint = document.getElementById("editingHint");
const bundleTitleInput = document.getElementById("bundleTitleInput");
const bundleDescriptionInput = document.getElementById("bundleDescriptionInput");
const bundleStatusInput = document.getElementById("bundleStatusInput");
const bundleIntendedUseInput = document.getElementById("bundleIntendedUseInput");
const bundleProjectNameInput = document.getElementById("bundleProjectNameInput");
const bundleTagsInput = document.getElementById("bundleTagsInput");
const bundleSummaryInput = document.getElementById("bundleSummaryInput");
const saveBundleButton = document.getElementById("saveBundleButton");
const updateBundleButton = document.getElementById("updateBundleButton");
const deleteBundleButton = document.getElementById("deleteBundleButton");
const clearBundleFormButton = document.getElementById("clearBundleFormButton");
const contextBundlesList = document.getElementById("contextBundlesList");

let bundles = [];
let selectedBundleId = null;

function parseTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatMetadataValue(value) {
  const normalized = String(value || "").trim();
  return normalized || "(none)";
}

function buildBundlePayload() {
  return {
    title: bundleTitleInput.value.trim(),
    description: bundleDescriptionInput.value.trim(),
    status: bundleStatusInput.value,
    intendedUse: bundleIntendedUseInput.value.trim() || null,
    projectName: bundleProjectNameInput.value.trim() || null,
    tags: parseTags(bundleTagsInput.value),
    summary: bundleSummaryInput.value.trim() || null
  };
}

async function parseJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return { error: await response.text() };
}

function setStatus(message) {
  bundleStatusBox.textContent = message;
}

function syncButtonState() {
  const isEditing = Number.isInteger(selectedBundleId) && selectedBundleId > 0;
  saveBundleButton.disabled = isEditing;
  updateBundleButton.disabled = !isEditing;
  deleteBundleButton.disabled = !isEditing;
  editingHint.textContent = isEditing
    ? `Editing bundle #${selectedBundleId}.`
    : "Creating a new bundle.";
}

function clearBundleForm() {
  selectedBundleId = null;
  bundleTitleInput.value = "";
  bundleDescriptionInput.value = "";
  bundleStatusInput.value = "draft";
  bundleIntendedUseInput.value = "";
  bundleProjectNameInput.value = "";
  bundleTagsInput.value = "";
  bundleSummaryInput.value = "";
  syncButtonState();
}

function setBundleForm(bundle) {
  selectedBundleId = bundle.id;
  bundleTitleInput.value = bundle.title || "";
  bundleDescriptionInput.value = bundle.description || "";
  bundleStatusInput.value = bundle.status || "draft";
  bundleIntendedUseInput.value = bundle.intended_use || "";
  bundleProjectNameInput.value = bundle.project_name || "";
  bundleTagsInput.value = Array.isArray(bundle.tags) ? bundle.tags.join(", ") : "";
  bundleSummaryInput.value = bundle.summary || "";
  syncButtonState();
}

function renderBundles() {
  contextBundlesList.innerHTML = "";

  if (bundles.length <= 0) {
    const empty = document.createElement("p");
    empty.className = "empty-card-copy";
    empty.textContent = "No context bundles yet.";
    contextBundlesList.appendChild(empty);
    return;
  }

  for (const bundle of bundles) {
    const card = document.createElement("article");
    card.className = "hier-card";

    const content = document.createElement("div");
    content.className = "hier-card__content";

    const heading = document.createElement("h3");
    heading.textContent = `${bundle.title} (#${bundle.id})`;

    const statusRow = document.createElement("p");
    statusRow.className = "card-description";
    statusRow.textContent = `Status: ${formatMetadataValue(bundle.status)} | Updated: ${formatMetadataValue(bundle.updated_at)}`;

    const intendedUseRow = document.createElement("p");
    intendedUseRow.className = "card-description";
    intendedUseRow.textContent = `Intended use: ${formatMetadataValue(bundle.intended_use)}`;

    const projectRow = document.createElement("p");
    projectRow.className = "card-description";
    projectRow.textContent = `Project affinity: ${formatMetadataValue(bundle.project_name)}`;

    const tagsRow = document.createElement("p");
    tagsRow.className = "card-description";
    tagsRow.textContent = `Tags: ${Array.isArray(bundle.tags) && bundle.tags.length > 0 ? bundle.tags.join(", ") : "(none)"}`;

    const summaryRow = document.createElement("p");
    summaryRow.className = "card-description";
    summaryRow.textContent = `Summary: ${formatMetadataValue(bundle.summary)}`;

    const actions = document.createElement("div");
    actions.className = "draft-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "secondary-button";
    editButton.textContent = "Edit Metadata";
    editButton.onclick = () => {
      setBundleForm(bundle);
      setStatus(`Loaded bundle #${bundle.id} for editing.`);
    };

    actions.appendChild(editButton);
    content.appendChild(heading);
    content.appendChild(statusRow);
    content.appendChild(intendedUseRow);
    content.appendChild(projectRow);
    content.appendChild(tagsRow);
    content.appendChild(summaryRow);
    content.appendChild(actions);
    card.appendChild(content);
    contextBundlesList.appendChild(card);
  }
}

async function loadBundles() {
  const response = await fetch("/api/context-bundles?includeParts=false");
  const result = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(result?.error || "Failed to load bundles.");
  }

  bundles = Array.isArray(result) ? result : [];
  renderBundles();
}

saveBundleButton.addEventListener("click", async () => {
  try {
    const payload = buildBundlePayload();
    if (!payload.title) {
      throw new Error("Bundle title is required.");
    }

    const response = await fetch("/api/context-bundles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result?.error || "Failed to create bundle.");
    }

    setStatus(`Created bundle #${result.id}.`);
    clearBundleForm();
    await loadBundles();
  } catch (error) {
    setStatus(`Create failed: ${error.message}`);
  }
});

updateBundleButton.addEventListener("click", async () => {
  if (!selectedBundleId) {
    setStatus("Select a bundle first.");
    return;
  }

  try {
    const payload = buildBundlePayload();
    const response = await fetch(`/api/context-bundles/${encodeURIComponent(String(selectedBundleId))}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result?.error || "Failed to update bundle.");
    }

    setStatus(`Updated bundle #${result.id}.`);
    await loadBundles();
  } catch (error) {
    setStatus(`Update failed: ${error.message}`);
  }
});

deleteBundleButton.addEventListener("click", async () => {
  if (!selectedBundleId) {
    setStatus("Select a bundle first.");
    return;
  }

  try {
    const response = await fetch(`/api/context-bundles/${encodeURIComponent(String(selectedBundleId))}`, {
      method: "DELETE"
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result?.error || "Failed to delete bundle.");
    }

    setStatus(`Deleted bundle #${selectedBundleId}.`);
    clearBundleForm();
    await loadBundles();
  } catch (error) {
    setStatus(`Delete failed: ${error.message}`);
  }
});

clearBundleFormButton.addEventListener("click", () => {
  clearBundleForm();
  setStatus("Bundle form cleared.");
});

(async () => {
  clearBundleForm();
  try {
    await loadBundles();
  } catch (error) {
    setStatus(`Initial load failed: ${error.message}`);
  }
})();
