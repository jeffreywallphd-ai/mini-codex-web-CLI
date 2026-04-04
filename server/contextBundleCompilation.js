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
const DEFAULT_APPROX_CHARS_PER_TOKEN = 4;
const DEFAULT_WARNING_THRESHOLD_CHARS = 12000;
const TRUNCATION_NOTICE = "[...truncated by context bundle compiler due to size limit]";
const TRUNCATION_STRATEGY = "prefix-preserving by compilation section priority and deterministic part order";

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

function normalizePositiveInteger(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }

  return Math.floor(numeric);
}

function estimateTokenCount(characterCount, approxCharsPerToken = DEFAULT_APPROX_CHARS_PER_TOKEN) {
  const normalizedChars = Math.max(0, Number(characterCount) || 0);
  return Math.ceil(normalizedChars / approxCharsPerToken);
}

function resolveSizingOptions(options = {}) {
  const approxCharsPerToken = normalizePositiveInteger(
    options?.approxCharsPerToken,
    DEFAULT_APPROX_CHARS_PER_TOKEN
  );
  const warningThresholdChars = normalizePositiveInteger(
    options?.warningThresholdChars,
    DEFAULT_WARNING_THRESHOLD_CHARS
  );
  const warningThresholdTokens = normalizePositiveInteger(options?.warningThresholdTokens, null);
  const maxCompiledChars = normalizePositiveInteger(options?.maxCompiledChars, null);
  const maxCompiledTokens = normalizePositiveInteger(options?.maxCompiledTokens, null);

  return {
    approxCharsPerToken,
    warningThresholdChars: warningThresholdTokens
      ? warningThresholdTokens * approxCharsPerToken
      : warningThresholdChars,
    maxCompiledChars: maxCompiledTokens
      ? maxCompiledTokens * approxCharsPerToken
      : maxCompiledChars
  };
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
  const entries = [];

  for (const group of compilationGroups) {
    const groupHeader = `## ${group.sectionLabel}\n\n`;
    group.sections.forEach((section, sectionIndex) => {
      entries.push({
        partId: section.partId,
        sectionLabel: section.sectionLabel,
        sectionKey: group.sectionKey,
        text: `${entries.length === 0 ? "" : "\n\n"}${sectionIndex === 0 ? groupHeader : ""}### ${section.sectionLabel}\n${section.content}`
      });
    });
  }

  return {
    compiledText: entries.map((entry) => entry.text).join("").trim(),
    entries
  };
}

function applySizeLimit(compiledText, maxCompiledChars) {
  if (!Number.isFinite(maxCompiledChars) || maxCompiledChars <= 0 || compiledText.length <= maxCompiledChars) {
    return {
      compiledText,
      isTruncated: false,
      preservedSourceChars: compiledText.length,
      truncationNoticeUsed: false
    };
  }

  const noticeWithSpacing = `\n\n${TRUNCATION_NOTICE}`;
  if (maxCompiledChars <= noticeWithSpacing.length) {
    return {
      compiledText: compiledText.slice(0, maxCompiledChars).trimEnd(),
      isTruncated: true,
      preservedSourceChars: maxCompiledChars,
      truncationNoticeUsed: false
    };
  }

  const preservedSourceChars = maxCompiledChars - noticeWithSpacing.length;
  const prefix = compiledText.slice(0, preservedSourceChars).trimEnd();
  return {
    compiledText: `${prefix}${noticeWithSpacing}`,
    isTruncated: true,
    preservedSourceChars,
    truncationNoticeUsed: true
  };
}

function summarizeTruncation(entries, preservedSourceChars) {
  const preservedPartIds = [];
  const partiallyTruncatedPartIds = [];
  const omittedPartIds = [];
  const omittedSectionLabels = [];
  const partiallyTruncatedSectionLabels = [];
  let cursor = 0;

  for (const entry of entries) {
    const start = cursor;
    const end = start + entry.text.length;
    const partId = Number(entry.partId);

    if (preservedSourceChars >= end) {
      if (Number.isFinite(partId) && !preservedPartIds.includes(partId)) {
        preservedPartIds.push(partId);
      }
    } else if (preservedSourceChars <= start) {
      if (Number.isFinite(partId) && !omittedPartIds.includes(partId)) {
        omittedPartIds.push(partId);
      }
      omittedSectionLabels.push(entry.sectionLabel);
    } else {
      if (Number.isFinite(partId) && !partiallyTruncatedPartIds.includes(partId)) {
        partiallyTruncatedPartIds.push(partId);
      }
      partiallyTruncatedSectionLabels.push(entry.sectionLabel);
    }

    cursor = end;
  }

  return {
    preservedPartIds,
    partiallyTruncatedPartIds,
    omittedPartIds,
    omittedSectionLabels,
    partiallyTruncatedSectionLabels
  };
}

function compileContextBundle(bundle = {}, options = {}) {
  const sizingOptions = resolveSizingOptions(options);
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
  const partSizeEstimates = sections.map((section) => ({
    partId: section.partId,
    sectionLabel: section.sectionLabel,
    contentChars: section.content.length,
    contentTokens: estimateTokenCount(section.content.length, sizingOptions.approxCharsPerToken),
    compiledSectionChars: (`### ${section.sectionLabel}\n${section.content}`).length,
    compiledSectionTokens: estimateTokenCount(
      (`### ${section.sectionLabel}\n${section.content}`).length,
      sizingOptions.approxCharsPerToken
    )
  }));
  const compilationGroups = buildCompilationGroups(sections);
  const compiledOutput = buildCompiledText(compilationGroups);
  const fullCompiledText = compiledOutput.compiledText;
  const sizeLimitedOutput = applySizeLimit(fullCompiledText, sizingOptions.maxCompiledChars);
  const truncationSummary = summarizeTruncation(
    compiledOutput.entries,
    sizeLimitedOutput.preservedSourceChars
  );
  const compiledText = sizeLimitedOutput.compiledText;
  const estimatedCompiledChars = fullCompiledText.length;
  const estimatedCompiledTokens = estimateTokenCount(
    estimatedCompiledChars,
    sizingOptions.approxCharsPerToken
  );
  const finalCompiledChars = compiledText.length;
  const finalCompiledTokens = estimateTokenCount(finalCompiledChars, sizingOptions.approxCharsPerToken);
  const isOverWarningThreshold = estimatedCompiledChars > sizingOptions.warningThresholdChars;
  const compilerNotes = [];

  if (isOverWarningThreshold) {
    compilerNotes.push(
      `Compiled context estimate (${estimatedCompiledChars} chars, ~${estimatedCompiledTokens} tokens) exceeds warning threshold (${sizingOptions.warningThresholdChars} chars).`
    );
  }

  if (sizeLimitedOutput.isTruncated) {
    compilerNotes.push(
      `Compiled context was truncated at ${sizingOptions.maxCompiledChars} chars using strategy "${TRUNCATION_STRATEGY}".`
    );
  }

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
    compiledString: compiledText,
    sizeEstimate: {
      approxCharsPerToken: sizingOptions.approxCharsPerToken,
      warningThresholdChars: sizingOptions.warningThresholdChars,
      warningThresholdTokens: estimateTokenCount(
        sizingOptions.warningThresholdChars,
        sizingOptions.approxCharsPerToken
      ),
      maxCompiledChars: sizingOptions.maxCompiledChars,
      maxCompiledTokens: Number.isFinite(sizingOptions.maxCompiledChars)
        ? estimateTokenCount(sizingOptions.maxCompiledChars, sizingOptions.approxCharsPerToken)
        : null,
      estimatedCompiledChars,
      estimatedCompiledTokens,
      finalCompiledChars,
      finalCompiledTokens,
      isOverWarningThreshold,
      isTruncated: sizeLimitedOutput.isTruncated
    },
    partSizeEstimates,
    truncation: {
      applied: sizeLimitedOutput.isTruncated,
      strategy: sizeLimitedOutput.isTruncated ? TRUNCATION_STRATEGY : null,
      preservedSourceChars: sizeLimitedOutput.preservedSourceChars,
      truncationNoticeUsed: sizeLimitedOutput.truncationNoticeUsed,
      preservedPartIds: truncationSummary.preservedPartIds,
      partiallyTruncatedPartIds: truncationSummary.partiallyTruncatedPartIds,
      omittedPartIds: truncationSummary.omittedPartIds,
      partiallyTruncatedSectionLabels: truncationSummary.partiallyTruncatedSectionLabels,
      omittedSectionLabels: truncationSummary.omittedSectionLabels
    },
    compilerNotes
  };
}

module.exports = {
  compileContextBundle
};
