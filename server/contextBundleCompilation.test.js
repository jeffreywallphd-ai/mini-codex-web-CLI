const test = require("node:test");
const assert = require("node:assert/strict");

const { compileContextBundle } = require("./contextBundleCompilation");

test("compileContextBundle creates deterministic section ordering and labels", () => {
  const compiled = compileContextBundle({
    id: 11,
    parts: [
      {
        id: 103,
        part_type: "testing_expectations",
        part_type_label: "Testing Expectations",
        title: "Coverage",
        content: "Add API tests.",
        position: 3,
        include_in_compiled: 1
      },
      {
        id: 101,
        part_type: "feature_background",
        part_type_label: "Feature Background",
        title: "Goal",
        content: "Implement preview payload.",
        position: 1,
        include_in_compiled: 1
      },
      {
        id: 102,
        part_type: "implementation_constraints",
        part_type_label: "Implementation Constraints",
        title: "Scope",
        content: "Do only requested story.",
        position: 2,
        include_in_compiled: 0
      }
    ]
  });

  assert.equal(compiled.format, "context_bundle_compiled_preview_v1");
  assert.equal(compiled.bundleId, 11);
  assert.deepEqual(compiled.orderedPartIds, [101, 102, 103]);
  assert.deepEqual(compiled.includedPartIds, [101, 103]);
  assert.equal(compiled.sectionCount, 2);
  assert.deepEqual(
    compiled.sections.map((section) => section.sectionLabel),
    [
      "Feature Background: Goal",
      "Testing Expectations: Coverage"
    ]
  );
  assert.deepEqual(compiled.typeGroups, [
    {
      partType: "feature_background",
      partTypeLabel: "Feature Background",
      includedPartIds: [101],
      sectionLabels: ["Feature Background: Goal"]
    },
    {
      partType: "testing_expectations",
      partTypeLabel: "Testing Expectations",
      includedPartIds: [103],
      sectionLabels: ["Testing Expectations: Coverage"]
    }
  ]);
  assert.deepEqual(compiled.compilationGroups, [
    {
      sectionKey: "architecture_guidance",
      sectionLabel: "Architecture Guidance",
      contextRole: "instructions",
      includedPartIds: [103],
      sectionLabels: ["Testing Expectations: Coverage"],
      partTypes: ["testing_expectations"],
      sections: [
        {
          partId: 103,
          position: 3,
          partType: "testing_expectations",
          partTypeLabel: "Testing Expectations",
          title: "Coverage",
          sectionLabel: "Testing Expectations: Coverage",
          content: "Add API tests."
        }
      ]
    },
    {
      sectionKey: "background_context",
      sectionLabel: "Background Context",
      contextRole: "reference",
      includedPartIds: [101],
      sectionLabels: ["Feature Background: Goal"],
      partTypes: ["feature_background"],
      sections: [
        {
          partId: 101,
          position: 1,
          partType: "feature_background",
          partTypeLabel: "Feature Background",
          title: "Goal",
          sectionLabel: "Feature Background: Goal",
          content: "Implement preview payload."
        }
      ]
    }
  ]);
  assert.match(
    compiled.compiledText,
    /## Architecture Guidance[\s\S]*### Testing Expectations: Coverage[\s\S]*## Background Context[\s\S]*### Feature Background: Goal/
  );
  assert.equal(compiled.compiledString, compiled.compiledText);
});

test("compileContextBundle updates output when included parts or content changes", () => {
  const sourceBundle = {
    id: 12,
    parts: [
      {
        id: 201,
        part_type: "feature_background",
        part_type_label: "Feature Background",
        title: "Goal",
        content: "Initial goal",
        position: 1,
        include_in_compiled: 1
      }
    ]
  };

  const initial = compileContextBundle(sourceBundle);
  assert.deepEqual(initial.includedPartIds, [201]);
  assert.match(initial.compiledText, /Initial goal/);

  const excluded = compileContextBundle({
    ...sourceBundle,
    parts: [{ ...sourceBundle.parts[0], include_in_compiled: 0 }]
  });
  assert.deepEqual(excluded.includedPartIds, []);
  assert.equal(excluded.compiledText, "");
  assert.deepEqual(excluded.typeGroups, []);
  assert.deepEqual(excluded.compilationGroups, []);

  const updated = compileContextBundle({
    ...sourceBundle,
    parts: [{ ...sourceBundle.parts[0], content: "Updated goal text" }]
  });
  assert.match(updated.compiledText, /Updated goal text/);
});

test("compileContextBundle is deterministic across repeated compiles and ties", () => {
  const input = {
    id: 21,
    parts: [
      {
        id: 4,
        part_type: "user_notes",
        title: "B",
        content: "second",
        position: 5,
        include_in_compiled: 1
      },
      {
        id: 3,
        part_type: "feature_background",
        title: "A",
        content: "first",
        position: 5,
        include_in_compiled: 1
      },
      {
        id: 7,
        part_type: "feature_background",
        title: "Hidden",
        content: "hidden",
        position: 6,
        include_in_compiled: 0
      }
    ]
  };

  const first = compileContextBundle(input);
  const second = compileContextBundle(input);

  assert.deepEqual(second, first);
  assert.deepEqual(first.orderedPartIds, [3, 4, 7]);
  assert.deepEqual(first.includedPartIds, [3, 4]);
  assert.deepEqual(first.typeGroups.map((group) => group.partType), [
    "feature_background",
    "user_notes"
  ]);
  assert.deepEqual(first.compilationGroups.map((group) => group.sectionKey), [
    "background_context"
  ]);
});

test("compileContextBundle layers constraints, instructions, and reference context into explicit sections", () => {
  const compiled = compileContextBundle({
    id: 31,
    parts: [
      {
        id: 301,
        part_type: "feature_background",
        title: "Story",
        content: "Background details",
        position: 1,
        include_in_compiled: 1
      },
      {
        id: 302,
        part_type: "implementation_constraints",
        title: "Guardrails",
        content: "Do not change API signatures.",
        position: 2,
        include_in_compiled: 1
      },
      {
        id: 303,
        part_type: "documentation_standards",
        title: "Docs",
        content: "Document new payload fields.",
        position: 3,
        include_in_compiled: 1
      },
      {
        id: 304,
        part_type: "domain_glossary",
        title: "Terms",
        content: "Compiler: bundle assembler.",
        position: 4,
        include_in_compiled: 1
      }
    ]
  });

  assert.deepEqual(compiled.compilationGroups.map((group) => group.sectionKey), [
    "implementation_constraints",
    "documentation_standards",
    "background_context",
    "glossary"
  ]);
  assert.match(
    compiled.compiledText,
    /## Implementation Constraints[\s\S]*### Implementation Constraints: Guardrails[\s\S]*## Documentation Standards[\s\S]*### Documentation Standards: Docs[\s\S]*## Background Context[\s\S]*### Feature Background: Story[\s\S]*## Glossary[\s\S]*### Domain Glossary: Terms/
  );
});

test("compileContextBundle provides lightweight size estimates and warning notes", () => {
  const compiled = compileContextBundle({
    id: 41,
    parts: [
      {
        id: 401,
        part_type: "feature_background",
        part_type_label: "Feature Background",
        title: "Large Context",
        content: "A".repeat(300),
        position: 1,
        include_in_compiled: 1
      }
    ]
  }, {
    warningThresholdChars: 100
  });

  assert.equal(compiled.sizeEstimate.warningThresholdChars, 100);
  assert.equal(compiled.sizeEstimate.isOverWarningThreshold, true);
  assert.equal(compiled.sizeEstimate.isTruncated, false);
  assert.equal(compiled.partSizeEstimates.length, 1);
  assert.equal(compiled.partSizeEstimates[0].partId, 401);
  assert.ok(compiled.partSizeEstimates[0].contentTokens > 0);
  assert.equal(compiled.compilerNotes.length, 1);
  assert.match(compiled.compilerNotes[0], /exceeds warning threshold/i);
});

test("compileContextBundle truncates deterministically and preserves highest-priority prefix first", () => {
  const compiled = compileContextBundle({
    id: 42,
    parts: [
      {
        id: 501,
        part_type: "implementation_constraints",
        part_type_label: "Implementation Constraints",
        title: "Primary Guardrails",
        content: "A".repeat(120),
        position: 1,
        include_in_compiled: 1
      },
      {
        id: 502,
        part_type: "feature_background",
        part_type_label: "Feature Background",
        title: "Secondary Context",
        content: "B".repeat(120),
        position: 2,
        include_in_compiled: 1
      },
      {
        id: 503,
        part_type: "user_notes",
        part_type_label: "User Notes",
        title: "Tail Context",
        content: "C".repeat(120),
        position: 3,
        include_in_compiled: 1
      }
    ]
  }, {
    maxCompiledChars: 260
  });

  assert.equal(compiled.truncation.applied, true);
  assert.equal(compiled.sizeEstimate.isTruncated, true);
  assert.match(compiled.compiledText, /\[\.\.\.truncated by context bundle compiler due to size limit\]$/);
  assert.equal(compiled.truncation.strategy, "prefix-preserving by compilation section priority and deterministic part order");
  assert.deepEqual(compiled.truncation.preservedPartIds, [501]);
  assert.deepEqual(compiled.truncation.omittedPartIds, [503]);
  assert.deepEqual(compiled.truncation.partiallyTruncatedPartIds, [502]);
  assert.match(compiled.compilerNotes.join("\n"), /was truncated/i);
});
