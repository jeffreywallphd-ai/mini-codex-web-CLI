const { getContextBundlePartTypeLabel } = require("./contextBundlePartTypes");

function normalizeTruthyFlag(value, defaultValue = true) {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  return Number(value) !== 0;
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function getDeterministicOrderedParts(parts) {
  if (!Array.isArray(parts)) {
    return [];
  }

  return [...parts].sort((left, right) => {
    const leftPosition = Number.isFinite(Number(left?.position)) ? Number(left.position) : Number.MAX_SAFE_INTEGER;
    const rightPosition = Number.isFinite(Number(right?.position)) ? Number(right.position) : Number.MAX_SAFE_INTEGER;
    if (leftPosition !== rightPosition) {
      return leftPosition - rightPosition;
    }

    const leftId = Number.isFinite(Number(left?.id)) ? Number(left.id) : Number.MAX_SAFE_INTEGER;
    const rightId = Number.isFinite(Number(right?.id)) ? Number(right.id) : Number.MAX_SAFE_INTEGER;
    return leftId - rightId;
  });
}

function buildSectionLabel(part) {
  const partTypeLabel = normalizeText(part?.part_type_label)
    || getContextBundlePartTypeLabel(part?.part_type);
  const title = normalizeText(part?.title);
  if (!title) {
    return partTypeLabel || "Context Part";
  }
  return `${partTypeLabel}: ${title}`;
}

function compileContextBundle(bundle = {}) {
  const orderedParts = getDeterministicOrderedParts(bundle?.parts);
  const compiledParts = orderedParts.filter((part) => normalizeTruthyFlag(part?.include_in_compiled, true));
  const sections = compiledParts.map((part) => ({
    partId: Number(part.id),
    position: Number(part.position),
    partType: part.part_type,
    partTypeLabel: normalizeText(part.part_type_label) || getContextBundlePartTypeLabel(part.part_type),
    title: normalizeText(part.title),
    sectionLabel: buildSectionLabel(part),
    content: typeof part.content === "string" ? part.content : ""
  }));

  const compiledText = sections.map((section) => [
    `## ${section.sectionLabel}`,
    section.content
  ].join("\n")).join("\n\n").trim();

  return {
    format: "context_bundle_compiled_preview_v1",
    bundleId: Number(bundle?.id) || null,
    orderedPartIds: orderedParts.map((part) => Number(part.id)).filter(Number.isFinite),
    includedPartIds: sections.map((section) => section.partId),
    sectionCount: sections.length,
    sections,
    compiledText
  };
}

module.exports = {
  compileContextBundle
};
