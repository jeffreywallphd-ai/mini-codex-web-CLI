const { getContextBundlePartTypeLabel } = require("./contextBundlePartTypes");

const COMPILATION_SECTION_LAYOUT = Object.freeze([
  {
    key: "implementation_constraints",
    label: "Implementation Constraints",
    contextRole: "constraints",
    partTypes: ["implementation_constraints"]
  },
  {
    key: "architecture_guidance",
    label: "Architecture Guidance",
    contextRole: "instructions",
    partTypes: ["architecture_guidance", "coding_standards", "testing_expectations"]
  },
  {
    key: "documentation_standards",
    label: "Documentation Standards",
    contextRole: "instructions",
    partTypes: ["documentation_standards"]
  },
  {
    key: "background_context",
    label: "Background Context",
    contextRole: "reference",
    partTypes: ["repository_context", "feature_background", "user_notes"]
  },
  {
    key: "glossary",
    label: "Glossary",
    contextRole: "reference",
    partTypes: ["domain_glossary"]
  }
]);

const PART_TYPE_TO_COMPILATION_SECTION = (() => {
  const map = new Map();
  for (const section of COMPILATION_SECTION_LAYOUT) {
    for (const partType of section.partTypes) {
      map.set(partType, section.key);
    }
  }
  return map;
})();

const DEFAULT_COMPILATION_SECTION_KEY = "background_context";

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

function resolveCompilationSection(partType) {
  const normalizedPartType = String(partType || "").trim().toLowerCase();
  const sectionKey = PART_TYPE_TO_COMPILATION_SECTION.get(normalizedPartType) || DEFAULT_COMPILATION_SECTION_KEY;
  return COMPILATION_SECTION_LAYOUT.find((section) => section.key === sectionKey);
}

function buildCompilationGroups(sections) {
  const groupsByKey = new Map();

  for (const layoutSection of COMPILATION_SECTION_LAYOUT) {
    groupsByKey.set(layoutSection.key, {
      sectionKey: layoutSection.key,
      sectionLabel: layoutSection.label,
      contextRole: layoutSection.contextRole,
      includedPartIds: [],
      sectionLabels: [],
      partTypes: [],
      sections: []
    });
  }

  for (const section of sections) {
    const targetLayoutSection = resolveCompilationSection(section.partType);
    const group = groupsByKey.get(targetLayoutSection.key);
    group.includedPartIds.push(section.partId);
    group.sectionLabels.push(section.sectionLabel);
    if (!group.partTypes.includes(section.partType)) {
      group.partTypes.push(section.partType);
    }
    group.sections.push(section);
  }

  return COMPILATION_SECTION_LAYOUT
    .map((layoutSection) => groupsByKey.get(layoutSection.key))
    .filter((group) => group.sections.length > 0);
}

function buildCompiledText(compilationGroups) {
  return compilationGroups
    .map((group) => [
      `## ${group.sectionLabel}`,
      "",
      ...group.sections.map((section) => [
        `### ${section.sectionLabel}`,
        section.content
      ].join("\n")).flat()
    ].join("\n"))
    .join("\n\n")
    .trim();
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
  const compilationGroups = buildCompilationGroups(sections);

  const compiledText = buildCompiledText(compilationGroups);

  return {
    format: "context_bundle_compiled_preview_v1",
    bundleId: Number(bundle?.id) || null,
    orderedPartIds: orderedParts.map((part) => Number(part.id)).filter(Number.isFinite),
    includedPartIds: sections.map((section) => section.partId).filter(Number.isFinite),
    sectionCount: sections.length,
    typeGroups: buildTypeGroups(sections),
    compilationGroups,
    sections,
    compiledText,
    compiledString: compiledText
  };
}

module.exports = {
  compileContextBundle
};
