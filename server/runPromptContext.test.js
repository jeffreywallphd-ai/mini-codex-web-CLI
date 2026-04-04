const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROMPT_INJECTION_POLICY,
  buildRunPromptWithCompiledBundle,
  resolveRunPrompt
} = require("./runPromptContext");

test("buildRunPromptWithCompiledBundle injects compiled context before task prompt", () => {
  const prompt = buildRunPromptWithCompiledBundle({
    taskPrompt: "Implement the requested story.",
    bundle: {
      id: 41,
      title: "Story Implementation Bundle"
    },
    compiledBundle: {
      compiledText: "## Architecture Guidance\n\n### Coding Standards: Scope\nOnly change requested files."
    }
  });

  assert.match(prompt, /^## Compiled Context Bundle/);
  assert.match(prompt, /Bundle #41: Story Implementation Bundle/);
  assert.match(prompt, new RegExp(`Prompt placement policy: ${PROMPT_INJECTION_POLICY}`));
  assert.match(prompt, /## Task Prompt\nImplement the requested story\./);
  assert.ok(prompt.indexOf("## Compiled Context Bundle") < prompt.indexOf("## Task Prompt"));
});

test("resolveRunPrompt reuses bundle compiler flow and returns assembled prompt metadata", async () => {
  const calls = {
    getContextBundleById: []
  };

  const output = await resolveRunPrompt({
    prompt: "Ship story 2.3.1",
    contextBundleId: 55,
    getContextBundleById: async (bundleId, options) => {
      calls.getContextBundleById.push({ bundleId, options });
      return {
        id: 55,
        title: "Run Integration Bundle",
        parts: []
      };
    },
    compileBundle: () => ({
      format: "context_bundle_compiled_preview_v1",
      includedPartIds: [7, 8],
      compiledText: "## Background Context\n\n### Feature Background: Story\nIntegrate bundle context."
    })
  });

  assert.equal(calls.getContextBundleById.length, 1);
  assert.deepEqual(calls.getContextBundleById[0], {
    bundleId: 55,
    options: { includeParts: true }
  });
  assert.match(output.prompt, /## Compiled Context Bundle/);
  assert.match(output.prompt, /## Task Prompt\nShip story 2\.3\.1/);
  assert.equal(output.promptAssembly.usedContextBundleId, 55);
  assert.equal(output.promptAssembly.usedContextBundleTitle, "Run Integration Bundle");
  assert.equal(output.promptAssembly.compiledBundleFormat, "context_bundle_compiled_preview_v1");
  assert.deepEqual(output.promptAssembly.includedPartIds, [7, 8]);
});

test("resolveRunPrompt returns original prompt when no bundle id is supplied", async () => {
  const output = await resolveRunPrompt({
    prompt: "Keep existing flow."
  });

  assert.equal(output.prompt, "Keep existing flow.");
  assert.equal(output.promptAssembly.usedContextBundleId, null);
  assert.equal(output.promptAssembly.usedContextBundleTitle, null);
  assert.equal(output.promptAssembly.promptInjectionPolicy, PROMPT_INJECTION_POLICY);
});

test("resolveRunPrompt throws context_bundle_not_found for missing selected bundle", async () => {
  await assert.rejects(
    () => resolveRunPrompt({
      prompt: "Run task",
      contextBundleId: 999,
      getContextBundleById: async () => null
    }),
    (error) => error && error.code === "context_bundle_not_found"
  );
});

test("resolveRunPrompt rejects non-numeric context bundle id values", async () => {
  await assert.rejects(
    () => resolveRunPrompt({
      prompt: "Run task",
      contextBundleId: "bad-id",
      getContextBundleById: async () => null
    }),
    (error) => error && error.code === "context_bundle_invalid_id"
  );
});

test("resolveRunPrompt rejects multi-reference context bundle id values", async () => {
  await assert.rejects(
    () => resolveRunPrompt({
      prompt: "Run task",
      contextBundleId: "11,12",
      getContextBundleById: async () => null
    }),
    (error) => error && error.code === "context_bundle_invalid_id"
  );

  await assert.rejects(
    () => resolveRunPrompt({
      prompt: "Run task",
      contextBundleId: [11, 12],
      getContextBundleById: async () => null
    }),
    (error) => error && error.code === "context_bundle_invalid_id"
  );
});

test("resolveRunPrompt rejects unusable bundles when compilation returns error-level quality warnings", async () => {
  await assert.rejects(
    () => resolveRunPrompt({
      prompt: "Run task",
      contextBundleId: 55,
      getContextBundleById: async () => ({
        id: 55,
        title: "Broken Bundle",
        parts: []
      }),
      compileBundle: () => ({
        compiledText: "placeholder",
        qualityWarnings: [
          {
            code: "invalid_part_required_field_missing",
            severity: "error",
            message: "Part 88 is missing content.",
            partIds: [88],
            sectionKeys: ["background_context"]
          }
        ]
      })
    }),
    (error) => error
      && error.code === "context_bundle_compile_failed"
      && Array.isArray(error.validationErrors)
      && error.validationErrors.length === 1
  );
});
