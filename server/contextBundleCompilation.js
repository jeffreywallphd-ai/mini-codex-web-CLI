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

function normalizeNumber(value, fallback = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getDeterministicOrderedParts(parts) {
  if (!Array.isArray(parts)) {
    return [];
  }

  return parts
    .map((part, originalIndex) => ({ part, originalIndex }))
    .sort((left, right) => {
      const leftPosition = normalizeNumber(left.part?.position);
      const rightPosition = normalizeNumber(right.part?.position);
      if (leftPosition !== rightPosition) {
        return leftPosition - rightPosition;
      }

      const leftId = normalizeNumber(left.part?.id);
      const rightId = normalizeNumber(right.part?.id);
      if (leftId !== rightId) {
        return leftId - rightId;
      }

      const leftType = String(left.part?.part_type || "").trim().toLowerCase();
      const rightType = String(right.part?.part_type || "").trim().toLowerCase();
      if (leftType !== rightType) {
        return leftType.localeCompare(rightType);
      }

      const leftTitle = normalizeText(left.part?.title);
      const rightTitle = normalizeText(right.part?.title);
      if (leftTitle !== rightTitle) {
        return leftTitle.localeCompare(rightTitle);
      }

      return left.originalIndex - right.originalIndex;
    })
    .map((entry) => entry.part);
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

function buildTypeGroups(sections) {
  const grouped = new Map();

  for (const section of sections) {
    const key = section.partType || "unknown";
    if (!grouped.has(key)) {
      grouped.set(key, {
        partType: section.partType,
        partTypeLabel: section.partTypeLabel || getContextBundlePartTypeLabel(section.partType),
        includedPartIds: [],
        sectionLabels: []
      });
    }

    const group = grouped.get(key);
    group.includedPartIds.push(section.partId);
    group.sectionLabels.push(section.sectionLabel);
  }

  return [...grouped.values()];
}

function compileContextBundle(bundle = {}) {
  const orderedParts = getDeterministicOrderedParts(bundle?.parts);
  const compiledParts = orderedParts.filter((part) => normalizeTruthyFlag(part?.include_in_compiled, true));
  const sections = compiledParts.map((part) => ({
    partId: normalizeNumber(part.id, Number.NaN),
    position: normalizeNumber(part.position, Number.NaN),
    partType: String(part.part_type || "").trim().toLowerCase(),
    partTypeLabel: normalizeText(part.part_type_label) || getContextBundlePartTypeLabel(part.part_type),
    title: normalizeText(part.title),
    sectionLabel: buildSectionLabel(part),
    content: typeof part.content === "string" ? part.content : ""
  }));

  const compiledText = sections
    .map((section) => [
      `## ${section.sectionLabel}`,
      section.content
    ].join("\n"))
    .join("\n\n")
    .trim();

  return {
    format: "context_bundle_compiled_preview_v1",
    bundleId: Number(bundle?.id) || null,
    orderedPartIds: orderedParts.map((part) => Number(part.id)).filter(Number.isFinite),
    includedPartIds: sections.map((section) => section.partId).filter(Number.isFinite),
    sectionCount: sections.length,
    typeGroups: buildTypeGroups(sections),
    sections,
    compiledText,
    compiledString: compiledText
  };
}

module.exports = {
  compileContextBundle
};
