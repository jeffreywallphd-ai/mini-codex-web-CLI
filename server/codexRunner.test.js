const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EXECUTION_MODE_OPTIONS,
  buildAugmentedPrompt,
  buildThreadOptions,
  formatUsageSummary,
  mapThreadEventToProgressEvent,
  normalizePrompt,
  parseChangeSummary
} = require("./codexRunner");

test("execution mode options only add sandboxing for write mode", () => {
  assert.deepEqual(EXECUTION_MODE_OPTIONS.read, {});
  assert.deepEqual(EXECUTION_MODE_OPTIONS.write, {
    sandboxMode: "workspace-write",
    approvalPolicy: "on-failure"
  });
});

test("prompts are normalized before being passed to the sdk", () => {
  assert.equal(normalizePrompt("  review base branch safety  "), "review base branch safety");
  assert.equal(normalizePrompt("   "), "");
});

test("prompts are augmented with the changelog instructions", () => {
  const augmented = buildAugmentedPrompt("Implement feature X");
  assert.match(augmented, /Implement feature X/);
  assert.match(augmented, /<<<CODEX_CHANGESET_START>>>/);
  assert.match(augmented, /TITLE:/);
  assert.match(augmented, /DESCRIPTION:/);
});

test("sdk thread options match the requested execution mode", () => {
  assert.deepEqual(buildThreadOptions("/tmp/repo", "read"), {
    workingDirectory: "/tmp/repo"
  });
  assert.deepEqual(buildThreadOptions("/tmp/repo", "write"), {
    workingDirectory: "/tmp/repo",
    sandboxMode: "workspace-write",
    approvalPolicy: "on-failure"
  });
});

test("usage summaries prefer token counts when available", () => {
  assert.equal(
    formatUsageSummary({ input_tokens: 11, output_tokens: 7, total_tokens: 18 }),
    "input=11, output=7, total=18"
  );
  assert.equal(formatUsageSummary({ total_cost_usd: 0.12 }), '{"total_cost_usd":0.12}');
  assert.equal(formatUsageSummary(null), null);
});

test("change summary metadata is parsed from the final response", () => {
  const result = parseChangeSummary(`
Implemented the requested feature.
<<<CODEX_CHANGESET_START>>>
TITLE: Add branch-aware merge details
DESCRIPTION:
- store the generated title
- render git diff details in the UI
<<<CODEX_CHANGESET_END>>>
`);

  assert.equal(result.responseText, "Implemented the requested feature.");
  assert.equal(result.changeTitle, "Add branch-aware merge details");
  assert.equal(
    result.changeDescription,
    "- store the generated title\n- render git diff details in the UI"
  );
});

test("thread events are mapped into concise progress events", () => {
  assert.deepEqual(
    mapThreadEventToProgressEvent({ type: "turn.started" }),
    {
      type: "codex.started",
      message: "Codex started."
    }
  );

  assert.deepEqual(
    mapThreadEventToProgressEvent({
      type: "item.started",
      item: {
        type: "command_execution",
        command: "npm test"
      }
    }),
    {
      type: "codex.command",
      message: "Running command: npm test"
    }
  );

  assert.deepEqual(
    mapThreadEventToProgressEvent({
      type: "item.completed",
      item: {
        type: "file_change",
        changes: [{ path: "web/app.js", kind: "update" }]
      }
    }),
    {
      type: "codex.file_change",
      message: "File changes detected (1 files)."
    }
  );
});
