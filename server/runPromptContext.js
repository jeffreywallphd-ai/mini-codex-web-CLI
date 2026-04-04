const { compileContextBundle } = require("./contextBundleCompilation");

const PROMPT_INJECTION_POLICY = "bundle_context_before_task_prompt_v1";
const COMPILED_CONTEXT_HEADING = "## Compiled Context Bundle";
const TASK_PROMPT_HEADING = "## Task Prompt";
const EMPTY_COMPILED_CONTEXT_NOTICE = "[No compiled context included from selected bundle.]";
const CONTEXT_BUNDLE_COMPILE_ERROR_CODE = "context_bundle_compile_failed";

function normalizePrompt(prompt) {
  return typeof prompt === "string" ? prompt.trim() : "";
}

function normalizePositiveInteger(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildRunPromptWithCompiledBundle({
  taskPrompt,
  bundle,
  compiledBundle
}) {
  const normalizedTaskPrompt = normalizePrompt(taskPrompt);
  const compiledText = normalizePrompt(compiledBundle?.compiledText || compiledBundle?.compiledString);
  const bundleId = normalizePositiveInteger(bundle?.id);
  const bundleTitle = normalizePrompt(bundle?.title) || "Untitled Context Bundle";
  const compiledSectionBody = compiledText || EMPTY_COMPILED_CONTEXT_NOTICE;

  return [
    COMPILED_CONTEXT_HEADING,
    `Bundle #${bundleId || "unknown"}: ${bundleTitle}`,
    `Prompt placement policy: ${PROMPT_INJECTION_POLICY}`,
    "",
    compiledSectionBody,
    "",
    TASK_PROMPT_HEADING,
    normalizedTaskPrompt
  ].join("\n").trim();
}

function createMissingBundleError(bundleId) {
  const error = new Error(`Context bundle #${bundleId} was not found.`);
  error.code = "context_bundle_not_found";
  return error;
}

function createInvalidBundleIdError() {
  const error = new Error("Context bundle id must be a positive integer when provided.");
  error.code = "context_bundle_invalid_id";
  return error;
}

function createBundleCompilationError({
  bundleId,
  message,
  validationErrors = []
}) {
  const normalizedBundleId = normalizePositiveInteger(bundleId);
  const fallbackMessage = Number.isInteger(normalizedBundleId)
    ? `Context bundle #${normalizedBundleId} is unusable and cannot be compiled for execution.`
    : "Selected context bundle is unusable and cannot be compiled for execution.";
  const error = new Error(message || fallbackMessage);
  error.code = CONTEXT_BUNDLE_COMPILE_ERROR_CODE;
  error.validationErrors = Array.isArray(validationErrors) ? validationErrors : [];
  return error;
}

function getCompileValidationErrors(compiledBundle) {
  if (!compiledBundle || typeof compiledBundle !== "object") {
    return [];
  }

  const qualityWarnings = Array.isArray(compiledBundle.qualityWarnings)
    ? compiledBundle.qualityWarnings
    : [];

  return qualityWarnings
    .filter((warning) => String(warning?.severity || "").trim().toLowerCase() === "error")
    .map((warning) => ({
      code: String(warning?.code || "bundle_compile_error").trim() || "bundle_compile_error",
      message: String(warning?.message || "Bundle compilation failed due to invalid context content.").trim(),
      severity: "error",
      partIds: Array.isArray(warning?.partIds) ? warning.partIds.filter(Number.isFinite) : [],
      sectionKeys: Array.isArray(warning?.sectionKeys) ? warning.sectionKeys.filter(Boolean) : []
    }));
}

async function validateContextBundleSelection({
  contextBundleId = null,
  getContextBundleById,
  compileBundle = compileContextBundle
}) {
  const hasBundleSelection = !(
    contextBundleId === null
    || contextBundleId === undefined
    || contextBundleId === ""
  );
  const normalizedBundleId = normalizePositiveInteger(contextBundleId);

  if (!hasBundleSelection) {
    return {
      contextBundleId: null,
      bundle: null,
      compiledBundle: null
    };
  }
  if (normalizedBundleId === null) {
    throw createInvalidBundleIdError();
  }

  if (typeof getContextBundleById !== "function") {
    throw new Error("getContextBundleById dependency is required when contextBundleId is provided.");
  }

  const bundle = await getContextBundleById(normalizedBundleId, { includeParts: true });
  if (!bundle) {
    throw createMissingBundleError(normalizedBundleId);
  }

  let compiledBundle;
  try {
    compiledBundle = compileBundle(bundle);
  } catch (error) {
    throw createBundleCompilationError({
      bundleId: normalizedBundleId,
      message: `Context bundle #${normalizedBundleId} failed compilation: ${error?.message || "unknown compiler error"}.`
    });
  }

  const compiledText = typeof compiledBundle?.compiledText === "string"
    ? compiledBundle.compiledText
    : (typeof compiledBundle?.compiledString === "string" ? compiledBundle.compiledString : null);
  if (compiledText === null) {
    throw createBundleCompilationError({
      bundleId: normalizedBundleId,
      message: `Context bundle #${normalizedBundleId} produced invalid compiled output.`
    });
  }

  const compileValidationErrors = getCompileValidationErrors(compiledBundle);
  if (compileValidationErrors.length > 0) {
    throw createBundleCompilationError({
      bundleId: normalizedBundleId,
      validationErrors: compileValidationErrors
    });
  }

  return {
    contextBundleId: normalizedBundleId,
    bundle,
    compiledBundle
  };
}

async function resolveRunPrompt({
  prompt,
  contextBundleId = null,
  getContextBundleById,
  compileBundle = compileContextBundle
}) {
  const basePrompt = normalizePrompt(prompt);
  const validatedBundleSelection = await validateContextBundleSelection({
    contextBundleId,
    getContextBundleById,
    compileBundle
  });

  if (!validatedBundleSelection?.bundle) {
    return {
      prompt: basePrompt,
      promptAssembly: {
        promptInjectionPolicy: PROMPT_INJECTION_POLICY,
        usedContextBundleId: null,
        usedContextBundleTitle: null
      }
    };
  }
  const normalizedBundleId = validatedBundleSelection.contextBundleId;
  const bundle = validatedBundleSelection.bundle;
  const compiledBundle = validatedBundleSelection.compiledBundle;
  const compiledPrompt = buildRunPromptWithCompiledBundle({
    taskPrompt: basePrompt,
    bundle,
    compiledBundle
  });

  return {
    prompt: compiledPrompt,
    promptAssembly: {
      promptInjectionPolicy: PROMPT_INJECTION_POLICY,
      usedContextBundleId: normalizedBundleId,
      usedContextBundleTitle: normalizePrompt(bundle?.title) || null,
      compiledBundleFormat: compiledBundle?.format || null,
      includedPartIds: Array.isArray(compiledBundle?.includedPartIds)
        ? [...compiledBundle.includedPartIds]
        : []
    }
  };
}

module.exports = {
  PROMPT_INJECTION_POLICY,
  buildRunPromptWithCompiledBundle,
  resolveRunPrompt,
  validateContextBundleSelection
};
