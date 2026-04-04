const bundleStatusBox = document.getElementById("bundleStatusBox");
const bundleValidationBox = document.getElementById("bundleValidationBox");
const editingHint = document.getElementById("editingHint");
const bundleTitleInput = document.getElementById("bundleTitleInput");
const bundleDescriptionInput = document.getElementById("bundleDescriptionInput");
const bundleStatusInput = document.getElementById("bundleStatusInput");
const bundleIntendedUseInput = document.getElementById("bundleIntendedUseInput");
const bundleProjectNameInput = document.getElementById("bundleProjectNameInput");
const bundleTagsInput = document.getElementById("bundleTagsInput");
const bundleSummaryInput = document.getElementById("bundleSummaryInput");
const bundleDetailSummary = document.getElementById("bundleDetailSummary");
const saveBundleButton = document.getElementById("saveBundleButton");
const updateBundleButton = document.getElementById("updateBundleButton");
const deleteBundleButton = document.getElementById("deleteBundleButton");
const clearBundleFormButton = document.getElementById("clearBundleFormButton");
const contextBundlesList = document.getElementById("contextBundlesList");
const addBundlePartButton = document.getElementById("addBundlePartButton");
const bundlePartsHint = document.getElementById("bundlePartsHint");
const bundlePartsList = document.getElementById("bundlePartsList");
const refreshBundlePreviewButton = document.getElementById("refreshBundlePreviewButton");
const bundlePreviewHint = document.getElementById("bundlePreviewHint");
const bundlePreviewStatus = document.getElementById("bundlePreviewStatus");
const bundlePreviewWarnings = document.getElementById("bundlePreviewWarnings");
const bundlePreviewBox = document.getElementById("bundlePreviewBox");

const PART_TYPE_OPTIONS = [
  { value: "repository_context", label: "Repository Context" },
  { value: "architecture_guidance", label: "Architecture Guidance" },
  { value: "coding_standards", label: "Coding Standards" },
  { value: "documentation_standards", label: "Documentation Standards" },
  { value: "domain_glossary", label: "Domain Glossary" },
  { value: "implementation_constraints", label: "Implementation Constraints" },
  { value: "testing_expectations", label: "Testing Expectations" },
  { value: "feature_background", label: "Feature Background" },
  { value: "user_notes", label: "User Notes" }
];

let bundles = [];
let selectedBundleId = null;
let bundleParts = [];

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

function formatPartTypeLabel(partType) {
  const normalized = String(partType || "").trim().toLowerCase();
  const match = PART_TYPE_OPTIONS.find((option) => option.value === normalized);
  return match ? match.label : "Unknown";
}

function buildIntentGuidance(bundle = {}) {
  const hasIntendedUse = Boolean(String(bundle.intended_use || "").trim());
  const hasSummary = Boolean(String(bundle.summary || "").trim());

  if (hasIntendedUse && hasSummary) {
    return "Ready for selection: intended use and concise summary are set.";
  }

  if (!hasIntendedUse && !hasSummary) {
    return "Add intended use and a concise summary to improve selection clarity.";
  }

  if (!hasIntendedUse) {
    return "Add intended use so this bundle is easier to match to run goals.";
  }

  return "Add a concise summary so this bundle is easier to scan in lists.";
}

function renderBundleDetailSummary(bundle) {
  if (!bundleDetailSummary) {
    return;
  }

  if (!bundle) {
    bundleDetailSummary.innerHTML = "";
    const cell = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = "Selection Guidance";
    const value = document.createElement("span");
    value.textContent = "Select a bundle to inspect metadata guidance.";
    cell.appendChild(label);
    cell.appendChild(value);
    bundleDetailSummary.appendChild(cell);
    return;
  }

  const cells = [
    { label: "Intended Use", value: formatMetadataValue(bundle.intended_use) },
    { label: "Summary", value: formatMetadataValue(bundle.summary) },
    { label: "Selection Guidance", value: buildIntentGuidance(bundle) }
  ];

  bundleDetailSummary.innerHTML = "";
  for (const item of cells) {
    const cell = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = item.label;
    const value = document.createElement("span");
    value.textContent = item.value;
    cell.appendChild(label);
    cell.appendChild(value);
    bundleDetailSummary.appendChild(cell);
  }
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

function getSelectedBundleIdOrThrow() {
  if (!selectedBundleId) {
    throw new Error("Create or select a bundle before managing parts.");
  }
  return selectedBundleId;
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

function setPreviewStatus(message, isError = false) {
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage) {
    bundlePreviewStatus.textContent = "";
    bundlePreviewStatus.classList.add("hidden");
    bundlePreviewStatus.classList.remove("bundle-preview-status--muted");
    return;
  }

  bundlePreviewStatus.textContent = normalizedMessage;
  bundlePreviewStatus.classList.remove("hidden");
  bundlePreviewStatus.classList.toggle("bundle-preview-status--muted", !isError);
}

function setPreviewText(text) {
  bundlePreviewBox.textContent = String(text || "").trim() || "(compiled preview is empty)";
}

function setPreviewWarnings(warnings) {
  const normalizedWarnings = Array.isArray(warnings)
    ? warnings.filter((warning) => warning && typeof warning.message === "string" && warning.message.trim())
    : [];

  if (normalizedWarnings.length <= 0) {
    bundlePreviewWarnings.textContent = "";
    bundlePreviewWarnings.classList.add("hidden");
    bundlePreviewWarnings.classList.remove("bundle-preview-warnings--error");
    return;
  }

  const lines = normalizedWarnings.map((warning, index) => {
    const level = String(warning.severity || "warning").trim().toLowerCase() === "error"
      ? "Error"
      : "Warning";
    return `${index + 1}. [${level}] ${warning.message}`;
  });

  bundlePreviewWarnings.textContent = `Context quality advisories:\n${lines.join("\n")}`;
  bundlePreviewWarnings.classList.remove("hidden");
  bundlePreviewWarnings.classList.toggle(
    "bundle-preview-warnings--error",
    normalizedWarnings.some((warning) => String(warning.severity || "").trim().toLowerCase() === "error")
  );
}

function confirmBundleDelete(bundleId, bundleTitle) {
  const label = String(bundleTitle || "").trim() || `bundle #${bundleId}`;
  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    return window.confirm(`Delete ${label}? This permanently removes the bundle and all of its parts.`);
  }
  return true;
}

function clearValidation() {
  bundleValidationBox.textContent = "";
  bundleValidationBox.classList.add("hidden");
}

function setValidation(message) {
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage) {
    clearValidation();
    return;
  }

  bundleValidationBox.textContent = normalizedMessage;
  bundleValidationBox.classList.remove("hidden");
}

function validateBundlePayload(payload) {
  if (!payload.title) {
    return "Bundle title is required.";
  }

  if (!payload.description) {
    return "Bundle description is required.";
  }

  return "";
}

function syncButtonState() {
  const isEditing = Number.isInteger(selectedBundleId) && selectedBundleId > 0;
  saveBundleButton.disabled = isEditing;
  updateBundleButton.disabled = !isEditing;
  deleteBundleButton.disabled = !isEditing;
  addBundlePartButton.disabled = !isEditing;
  refreshBundlePreviewButton.disabled = !isEditing;
  editingHint.textContent = isEditing
    ? `Editing bundle #${selectedBundleId}.`
    : "Creating a new bundle.";
  bundlePartsHint.textContent = isEditing
    ? "Each part has an explicit purpose. Save changes per part and use move up/down for deterministic order."
    : "Create or select a bundle to author parts.";
  bundlePreviewHint.textContent = isEditing
    ? "Preview matches saved part ordering and include-in-compiled settings."
    : "Create or select a bundle to preview compiled context.";
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
  bundleParts = [];
  setPreviewStatus("");
  setPreviewWarnings([]);
  setPreviewText("Select a bundle to load compiled preview.");
  clearValidation();
  syncButtonState();
  renderBundleParts();
  renderBundleDetailSummary(null);
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
  clearValidation();
  syncButtonState();
  renderBundleDetailSummary(bundle);
}

async function loadBundlePreview(bundleId, options = {}) {
  const { silent = false } = options;
  const response = await fetch(`/api/context-bundles/${encodeURIComponent(String(bundleId))}/preview`);
  const result = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(result?.error || "Failed to load compiled preview.");
  }

  const preview = result?.preview || {};
  setPreviewText(preview.compiledText || "");
  setPreviewWarnings(preview.qualityWarnings);

  if (!silent) {
    const includedCount = Array.isArray(preview.includedPartIds) ? preview.includedPartIds.length : 0;
    const warningCount = Array.isArray(preview.qualityWarnings) ? preview.qualityWarnings.length : 0;
    setPreviewStatus(
      `Preview refreshed from saved state (${includedCount} included part${includedCount === 1 ? "" : "s"}, ${warningCount} advisory warning${warningCount === 1 ? "" : "s"}).`
    );
  } else {
    setPreviewStatus("");
  }
}

async function refreshPreviewSafely(bundleId) {
  try {
    await loadBundlePreview(bundleId);
    return "";
  } catch (error) {
    setPreviewStatus(`Preview unavailable: ${error.message}`, true);
    setPreviewWarnings([]);
    return error.message;
  }
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

    const descriptionRow = document.createElement("p");
    descriptionRow.className = "card-description";
    descriptionRow.textContent = `Description: ${formatMetadataValue(bundle.description)}`;

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

    const guidanceRow = document.createElement("p");
    guidanceRow.className = "card-description";
    guidanceRow.textContent = `Selection guidance: ${buildIntentGuidance(bundle)}`;

    const actions = document.createElement("div");
    actions.className = "draft-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "secondary-button";
    editButton.textContent = "Edit Bundle";
    editButton.onclick = async () => {
      try {
        await selectBundleForEditing(bundle.id);
        setStatus(`Loaded bundle #${bundle.id} for editing.`);
      } catch (error) {
        setValidation(error.message);
        setStatus(`Load failed: ${error.message}`);
      }
    };

    const duplicateButton = document.createElement("button");
    duplicateButton.type = "button";
    duplicateButton.className = "secondary-button";
    duplicateButton.textContent = "Duplicate Bundle";
    duplicateButton.onclick = async () => {
      await duplicateBundle(bundle.id);
    };

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger-button";
    deleteButton.textContent = "Delete Bundle";
    deleteButton.onclick = async () => {
      await deleteBundle(bundle.id, bundle.title);
    };

    actions.appendChild(editButton);
    actions.appendChild(duplicateButton);
    actions.appendChild(deleteButton);
    content.appendChild(heading);
    content.appendChild(statusRow);
    content.appendChild(descriptionRow);
    content.appendChild(intendedUseRow);
    content.appendChild(projectRow);
    content.appendChild(tagsRow);
    content.appendChild(summaryRow);
    content.appendChild(guidanceRow);
    content.appendChild(actions);
    card.appendChild(content);
    contextBundlesList.appendChild(card);
  }
}

function sortedParts(parts) {
  return [...parts].sort((a, b) => (Number(a.position) - Number(b.position)) || (Number(a.id) - Number(b.id)));
}

function renderBundleParts() {
  bundlePartsList.innerHTML = "";

  if (!selectedBundleId) {
    return;
  }

  if (bundleParts.length <= 0) {
    const empty = document.createElement("p");
    empty.className = "empty-card-copy";
    empty.textContent = "No parts yet. Add a part to begin building this bundle's structured context.";
    bundlePartsList.appendChild(empty);
    return;
  }

  const totalParts = bundleParts.length;
  for (const [index, part] of bundleParts.entries()) {
    const card = document.createElement("article");
    card.className = "hier-card bundle-part-card";

    const content = document.createElement("div");
    content.className = "hier-card__content";

    const heading = document.createElement("h4");
    heading.className = "bundle-part-heading";
    heading.textContent = `Part ${index + 1}: ${formatPartTypeLabel(part.part_type)}`;

    const titleMeta = document.createElement("p");
    titleMeta.className = "card-description";
    titleMeta.textContent = `Purpose: ${formatMetadataValue(part.title)}`;

    const typeLabel = document.createElement("label");
    typeLabel.textContent = "Type";
    const typeInput = document.createElement("select");
    for (const option of PART_TYPE_OPTIONS) {
      const optionEl = document.createElement("option");
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      typeInput.appendChild(optionEl);
    }
    typeInput.value = part.part_type || "feature_background";

    const titleLabel = document.createElement("label");
    titleLabel.textContent = "Title";
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = part.title || "";
    titleInput.placeholder = "Part purpose title";

    const contentLabel = document.createElement("label");
    contentLabel.textContent = "Content";
    const contentInput = document.createElement("textarea");
    contentInput.rows = 5;
    contentInput.value = part.content || "";
    contentInput.placeholder = "Part content";

    const includeRow = document.createElement("label");
    includeRow.className = "story-automation-checkbox";
    const includeInput = document.createElement("input");
    includeInput.type = "checkbox";
    includeInput.checked = Number(part.include_in_compiled) !== 0;
    const includeCopy = document.createElement("span");
    includeCopy.textContent = "Include in compiled output";
    includeRow.appendChild(includeInput);
    includeRow.appendChild(includeCopy);

    const actions = document.createElement("div");
    actions.className = "draft-actions";

    const moveUpButton = document.createElement("button");
    moveUpButton.type = "button";
    moveUpButton.className = "secondary-button";
    moveUpButton.textContent = "Move Up";
    moveUpButton.disabled = index === 0;
    moveUpButton.onclick = async () => {
      await movePart(part.id, -1);
    };

    const moveDownButton = document.createElement("button");
    moveDownButton.type = "button";
    moveDownButton.className = "secondary-button";
    moveDownButton.textContent = "Move Down";
    moveDownButton.disabled = index === totalParts - 1;
    moveDownButton.onclick = async () => {
      await movePart(part.id, 1);
    };

    const savePartButton = document.createElement("button");
    savePartButton.type = "button";
    savePartButton.className = "secondary-button";
    savePartButton.textContent = "Save Part";
    savePartButton.onclick = async () => {
      await savePartEdits(part.id, {
        partType: typeInput.value,
        title: titleInput.value.trim(),
        content: contentInput.value,
        includeInCompiled: includeInput.checked,
        position: index + 1
      });
    };

    const deletePartButton = document.createElement("button");
    deletePartButton.type = "button";
    deletePartButton.className = "danger-button";
    deletePartButton.textContent = "Delete Part";
    deletePartButton.onclick = async () => {
      await deletePart(part.id);
    };

    actions.appendChild(moveUpButton);
    actions.appendChild(moveDownButton);
    actions.appendChild(savePartButton);
    actions.appendChild(deletePartButton);

    content.appendChild(heading);
    content.appendChild(titleMeta);
    content.appendChild(typeLabel);
    content.appendChild(typeInput);
    content.appendChild(titleLabel);
    content.appendChild(titleInput);
    content.appendChild(contentLabel);
    content.appendChild(contentInput);
    content.appendChild(includeRow);
    content.appendChild(actions);

    card.appendChild(content);
    bundlePartsList.appendChild(card);
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

async function loadBundleParts(bundleId) {
  const response = await fetch(`/api/context-bundles/${encodeURIComponent(String(bundleId))}/parts`);
  const result = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(result?.error || "Failed to load bundle parts.");
  }

  bundleParts = sortedParts(Array.isArray(result) ? result : []);
  renderBundleParts();
}

async function selectBundleForEditing(bundleId) {
  const response = await fetch(`/api/context-bundles/${encodeURIComponent(String(bundleId))}`);
  const result = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(result?.error || "Failed to load context bundle.");
  }

  setBundleForm(result);
  bundleParts = sortedParts(Array.isArray(result.parts) ? result.parts : []);
  renderBundleParts();
  try {
    await loadBundlePreview(bundleId, { silent: true });
  } catch (error) {
    setPreviewStatus(`Preview unavailable: ${error.message}`, true);
    setPreviewWarnings([]);
    setPreviewText("Unable to load compiled preview.");
  }
}

async function duplicateBundle(bundleId) {
  try {
    clearValidation();
    const response = await fetch(`/api/context-bundles/${encodeURIComponent(String(bundleId))}/duplicate`, {
      method: "POST"
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result?.error || "Failed to duplicate bundle.");
    }

    await loadBundles();
    const duplicatedBundle = bundles.find((bundle) => bundle.id === result.id);
    if (duplicatedBundle) {
      await selectBundleForEditing(duplicatedBundle.id);
    }
    setStatus(`Duplicated bundle #${bundleId} as #${result.id}.`);
  } catch (error) {
    setValidation(error.message);
    setStatus(`Duplicate failed: ${error.message}`);
  }
}

async function deleteBundle(bundleId, bundleTitle) {
  try {
    if (!confirmBundleDelete(bundleId, bundleTitle)) {
      setStatus("Delete cancelled.");
      return;
    }

    clearValidation();
    const response = await fetch(`/api/context-bundles/${encodeURIComponent(String(bundleId))}`, {
      method: "DELETE"
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result?.error || "Failed to delete bundle.");
    }

    if (selectedBundleId === bundleId) {
      clearBundleForm();
    }
    await loadBundles();
    setStatus(`Deleted bundle #${bundleId}.`);
  } catch (error) {
    setValidation(error.message);
    setStatus(`Delete failed: ${error.message}`);
  }
}

async function addBundlePart() {
  try {
    const bundleId = getSelectedBundleIdOrThrow();
    clearValidation();
    const response = await fetch(`/api/context-bundles/${encodeURIComponent(String(bundleId))}/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partType: "feature_background",
        title: `New Part ${bundleParts.length + 1}`,
        content: "Add context content for this part.",
        includeInCompiled: true,
        position: bundleParts.length + 1
      })
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result?.error || "Failed to add bundle part.");
    }

    bundleParts = sortedParts([...bundleParts, result]);
    renderBundleParts();
    const previewError = await refreshPreviewSafely(bundleId);
    setStatus(
      previewError
        ? `Added part #${result.id} to bundle #${bundleId}. Preview refresh failed: ${previewError}`
        : `Added part #${result.id} to bundle #${bundleId}.`
    );
  } catch (error) {
    setValidation(error.message);
    setStatus(`Add part failed: ${error.message}`);
  }
}

async function savePartEdits(partId, payload) {
  try {
    const bundleId = getSelectedBundleIdOrThrow();
    if (!payload.title) {
      throw new Error("Part title is required.");
    }

    clearValidation();
    const response = await fetch(`/api/context-bundles/${encodeURIComponent(String(bundleId))}/parts/${encodeURIComponent(String(partId))}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result?.error || "Failed to update bundle part.");
    }

    bundleParts = sortedParts(bundleParts.map((part) => (part.id === result.id ? result : part)));
    renderBundleParts();
    const previewError = await refreshPreviewSafely(bundleId);
    setStatus(
      previewError
        ? `Saved part #${result.id}. Preview refresh failed: ${previewError}`
        : `Saved part #${result.id}.`
    );
  } catch (error) {
    setValidation(error.message);
    setStatus(`Save part failed: ${error.message}`);
  }
}

async function persistPartOrder(partsInOrder) {
  const bundleId = getSelectedBundleIdOrThrow();
  const tempOffset = 100000;

  for (const [index, part] of partsInOrder.entries()) {
    const tempPosition = tempOffset + index + 1;
    const tempResponse = await fetch(`/api/context-bundles/${encodeURIComponent(String(bundleId))}/parts/${encodeURIComponent(String(part.id))}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: tempPosition })
    });
    const tempResult = await parseJsonResponse(tempResponse);
    if (!tempResponse.ok) {
      throw new Error(tempResult?.error || "Failed to apply temporary part ordering.");
    }
  }

  const persistedParts = [];
  for (const [index, part] of partsInOrder.entries()) {
    const finalResponse = await fetch(`/api/context-bundles/${encodeURIComponent(String(bundleId))}/parts/${encodeURIComponent(String(part.id))}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: index + 1 })
    });
    const finalResult = await parseJsonResponse(finalResponse);
    if (!finalResponse.ok) {
      throw new Error(finalResult?.error || "Failed to persist part ordering.");
    }
    persistedParts.push(finalResult);
  }

  bundleParts = sortedParts(persistedParts);
  renderBundleParts();
  return refreshPreviewSafely(bundleId);
}

async function movePart(partId, direction) {
  try {
    clearValidation();
    const current = sortedParts(bundleParts);
    const fromIndex = current.findIndex((part) => part.id === partId);
    if (fromIndex < 0) return;

    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= current.length) return;

    const reordered = [...current];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    const previewError = await persistPartOrder(reordered);
    setStatus(
      previewError
        ? `Reordered part #${partId}. Preview refresh failed: ${previewError}`
        : `Reordered part #${partId}.`
    );
  } catch (error) {
    setValidation(error.message);
    setStatus(`Reorder failed: ${error.message}`);
  }
}

async function deletePart(partId) {
  try {
    const bundleId = getSelectedBundleIdOrThrow();
    clearValidation();

    const response = await fetch(`/api/context-bundles/${encodeURIComponent(String(bundleId))}/parts/${encodeURIComponent(String(partId))}`, {
      method: "DELETE"
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result?.error || "Failed to delete bundle part.");
    }

    const remaining = sortedParts(bundleParts.filter((part) => part.id !== partId));
    if (remaining.length > 0) {
      const previewError = await persistPartOrder(remaining);
      setStatus(
        previewError
          ? `Deleted part #${partId}. Preview refresh failed: ${previewError}`
          : `Deleted part #${partId}.`
      );
    } else {
      bundleParts = [];
      renderBundleParts();
      const previewError = await refreshPreviewSafely(bundleId);
      setStatus(
        previewError
          ? `Deleted part #${partId}. Preview refresh failed: ${previewError}`
          : `Deleted part #${partId}.`
      );
    }
  } catch (error) {
    setValidation(error.message);
    setStatus(`Delete part failed: ${error.message}`);
  }
}

saveBundleButton.addEventListener("click", async () => {
  try {
    const payload = buildBundlePayload();
    const validationError = validateBundlePayload(payload);
    if (validationError) {
      throw new Error(validationError);
    }
    clearValidation();

    const response = await fetch("/api/context-bundles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result?.error || "Failed to create bundle.");
    }

    await loadBundles();
    const createdBundle = bundles.find((bundle) => bundle.id === result.id);
    if (createdBundle) {
      await selectBundleForEditing(createdBundle.id);
    } else {
      clearBundleForm();
    }
    setStatus(`Created bundle #${result.id}.`);
  } catch (error) {
    setValidation(error.message);
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
    const validationError = validateBundlePayload(payload);
    if (validationError) {
      throw new Error(validationError);
    }
    clearValidation();

    const response = await fetch(`/api/context-bundles/${encodeURIComponent(String(selectedBundleId))}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result?.error || "Failed to update bundle.");
    }

    await loadBundles();
    const refreshedBundle = bundles.find((bundle) => bundle.id === result.id);
    if (refreshedBundle) {
      await selectBundleForEditing(refreshedBundle.id);
    } else {
      clearBundleForm();
    }
    setStatus(`Updated bundle #${result.id}.`);
  } catch (error) {
    setValidation(error.message);
    setStatus(`Update failed: ${error.message}`);
  }
});

deleteBundleButton.addEventListener("click", async () => {
  if (!selectedBundleId) {
    setStatus("Select a bundle first.");
    return;
  }

  await deleteBundle(selectedBundleId, bundleTitleInput.value);
});

clearBundleFormButton.addEventListener("click", () => {
  clearBundleForm();
  setStatus("Bundle form cleared.");
});

addBundlePartButton.addEventListener("click", async () => {
  await addBundlePart();
});

refreshBundlePreviewButton.addEventListener("click", async () => {
  if (!selectedBundleId) {
    setPreviewStatus("Select a bundle first.", true);
    return;
  }

  try {
    await loadBundlePreview(selectedBundleId);
  } catch (error) {
    setPreviewStatus(error.message, true);
    setStatus(`Preview load failed: ${error.message}`);
  }
});

(async () => {
  clearBundleForm();
  try {
    await loadBundles();
  } catch (error) {
    setStatus(`Initial load failed: ${error.message}`);
  }
})();
