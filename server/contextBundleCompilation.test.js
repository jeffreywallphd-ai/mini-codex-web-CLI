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
  assert.match(
    compiled.compiledText,
    /## Feature Background: Goal[\s\S]*## Testing Expectations: Coverage/
  );
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

  const updated = compileContextBundle({
    ...sourceBundle,
    parts: [{ ...sourceBundle.parts[0], content: "Updated goal text" }]
  });
  assert.match(updated.compiledText, /Updated goal text/);
});
