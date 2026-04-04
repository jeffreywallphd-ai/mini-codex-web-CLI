const CONTEXT_BUNDLE_PART_TYPES = Object.freeze([
  "repository_context",
  "architecture_guidance",
  "coding_standards",
  "documentation_standards",
  "domain_glossary",
  "implementation_constraints",
  "testing_expectations",
  "feature_background",
  "user_notes"
]);

const CONTEXT_BUNDLE_PART_TYPE_LABELS = Object.freeze({
  repository_context: "Repository Context",
  architecture_guidance: "Architecture Guidance",
  coding_standards: "Coding Standards",
  documentation_standards: "Documentation Standards",
  domain_glossary: "Domain Glossary",
  implementation_constraints: "Implementation Constraints",
  testing_expectations: "Testing Expectations",
  feature_background: "Feature Background",
  user_notes: "User Notes"
});

const LEGACY_PART_TYPE_ALIASES = Object.freeze({
  objective: "feature_background",
  constraints: "implementation_constraints",
  policy: "implementation_constraints",
  instruction: "architecture_guidance",
  reference: "repository_context",
  notes: "user_notes"
});

const CONTEXT_BUNDLE_PART_TYPE_SET = new Set(CONTEXT_BUNDLE_PART_TYPES);

function getContextBundlePartTypeLabel(partType) {
  const normalizedType = String(partType || "").trim().toLowerCase();
  return CONTEXT_BUNDLE_PART_TYPE_LABELS[normalizedType] || normalizedType || "Unknown";
}

function normalizeContextBundlePartType(value, fieldName = "Context bundle part type") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  const canonical = LEGACY_PART_TYPE_ALIASES[normalized] || normalized;
  if (!CONTEXT_BUNDLE_PART_TYPE_SET.has(canonical)) {
    throw new Error(
      `${fieldName} must be one of: ${CONTEXT_BUNDLE_PART_TYPES.join(", ")}.`
    );
  }

  return canonical;
}

module.exports = {
  CONTEXT_BUNDLE_PART_TYPES,
  CONTEXT_BUNDLE_PART_TYPE_LABELS,
  normalizeContextBundlePartType,
  getContextBundlePartTypeLabel
};
