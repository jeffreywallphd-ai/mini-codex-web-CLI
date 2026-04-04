const { compileContextBundle } = require("./contextBundleCompilation");

const PROMPT_INJECTION_POLICY = "bundle_context_before_task_prompt_v1";
const COMPILED_CONTEXT_HEADING = "## Compiled Context Bundle";
const TASK_PROMPT_HEADING = "## Task Prompt";
const EMPTY_COMPILED_CONTEXT_NOTICE = "[No compiled context included from selected bundle.]";

function normalizePrompt(prompt) {
  return typeof prompt === "string" ? prompt.trim() : "";
}

function normalizePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
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

async function resolveRunPrompt({
  prompt,
  contextBundleId = null,
  getContextBundleById,
  compileBundle = compileContextBundle
}) {
  const basePrompt = normalizePrompt(prompt);
  const hasBundleSelection = !(
    contextBundleId === null
    || contextBundleId === undefined
    || contextBundleId === ""
  );
  const normalizedBundleId = normalizePositiveInteger(contextBundleId);

  if (!hasBundleSelection) {
    return {
      prompt: basePrompt,
      promptAssembly: {
        promptInjectionPolicy: PROMPT_INJECTION_POLICY,
        usedContextBundleId: null
      }
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

  const compiledBundle = compileBundle(bundle);
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
  resolveRunPrompt
};
