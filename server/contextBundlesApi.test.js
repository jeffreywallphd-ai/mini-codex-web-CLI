const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const express = require("express");

const { createContextBundlesRouter } = require("./contextBundlesApi");
const { ContextBundleValidationError } = require("./contextBundleValidation");

function createHarness() {
  let idSeed = 7000;
  let partIdSeed = 9000;
  const bundleStore = new Map();
  const partStore = new Map();
  const calls = {
    getContextBundles: [],
    getContextBundleById: [],
    createContextBundle: [],
    updateContextBundle: [],
    deleteContextBundleById: [],
    duplicateContextBundleById: [],
    createContextBundlePart: [],
    getContextBundlePartById: [],
    getContextBundlePartsByBundleId: [],
    updateContextBundlePart: [],
    deleteContextBundlePartById: []
  };

  function getBundleParts(bundleId) {
    return [...partStore.values()]
      .filter((part) => part.bundle_id === Number(bundleId))
      .sort((a, b) => (a.position - b.position) || (a.id - b.id));
  }

  function withParts(bundle) {
    return {
      ...bundle,
      parts: getBundleParts(bundle.id)
    };
  }

  const deps = {
    createContextBundle: async (input = {}) => {
      calls.createContextBundle.push(input);
      idSeed += 1;
      const now = "2026-04-04T00:00:00.000Z";
      const bundle = {
        id: idSeed,
        title: String(input.title || "").trim(),
        description: typeof input.description === "string" ? input.description : "",
        status: String(input.status || "draft").trim().toLowerCase() || "draft",
        intended_use: input.intendedUse ?? input.intended_use ?? null,
        tags: Array.isArray(input.tags) ? input.tags : [],
        project_name: input.projectName ?? input.project_name ?? null,
        summary: input.summary ?? null,
        token_estimate: input.tokenEstimate ?? null,
        is_active: input.isActive ?? null,
        last_used_at: input.lastUsedAt ?? null,
        created_at: now,
        updated_at: now
      };
      if (!bundle.title) {
        throw new Error("Context bundle title is required.");
      }
      bundleStore.set(bundle.id, bundle);
      return withParts(bundle);
    },
    getContextBundleById: async (id, options = {}) => {
      calls.getContextBundleById.push({ id, options });
      const found = bundleStore.get(Number(id)) || null;
      if (!found) return null;
      if (options.includeParts === false) {
        return found;
      }
      return withParts(found);
    },
    getContextBundles: async (options = {}) => {
      calls.getContextBundles.push(options);
      const all = [...bundleStore.values()];
      if (options.includeParts === false) {
        return all;
      }
      return all.map((bundle) => withParts(bundle));
    },
    updateContextBundle: async (id, updates = {}) => {
      calls.updateContextBundle.push({ id, updates });
      const found = bundleStore.get(Number(id)) || null;
      if (!found) return null;
      const next = {
        ...found,
        ...(Object.prototype.hasOwnProperty.call(updates, "title")
          ? { title: String(updates.title || "").trim() }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, "description")
          ? { description: typeof updates.description === "string" ? updates.description : "" }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, "status")
          ? { status: String(updates.status || "").trim().toLowerCase() || "draft" }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, "intendedUse")
          ? { intended_use: updates.intendedUse }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, "intended_use")
          ? { intended_use: updates.intended_use }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, "tags")
          ? { tags: updates.tags }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, "projectName")
          ? { project_name: updates.projectName }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, "project_name")
          ? { project_name: updates.project_name }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, "summary")
          ? { summary: updates.summary }
          : {}),
        updated_at: "2026-04-04T00:02:00.000Z"
      };
      bundleStore.set(Number(id), next);
      return withParts(next);
    },
    deleteContextBundleById: async (id) => {
      calls.deleteContextBundleById.push(id);
      const bundleId = Number(id);
      for (const part of partStore.values()) {
        if (part.bundle_id === bundleId) {
          partStore.delete(part.id);
        }
      }
      return bundleStore.delete(bundleId) ? 1 : 0;
    },
    duplicateContextBundleById: async (id) => {
      calls.duplicateContextBundleById.push(id);
      const bundleId = Number(id);
      const source = bundleStore.get(bundleId);
      if (!source) return null;

      idSeed += 1;
      const copiedBundle = {
        ...source,
        id: idSeed,
        title: `${source.title} (Copy)`,
        created_at: "2026-04-04T00:05:00.000Z",
        updated_at: "2026-04-04T00:05:00.000Z"
      };
      bundleStore.set(copiedBundle.id, copiedBundle);

      const sourceParts = getBundleParts(bundleId);
      for (const part of sourceParts) {
        partIdSeed += 1;
        partStore.set(partIdSeed, {
          ...part,
          id: partIdSeed,
          bundle_id: copiedBundle.id,
          created_at: "2026-04-04T00:05:00.000Z",
          updated_at: "2026-04-04T00:05:00.000Z"
        });
      }

      return withParts(copiedBundle);
    },
    createContextBundlePart: async (input = {}) => {
      calls.createContextBundlePart.push(input);
      const bundleId = Number(input.bundleId);
      const bundle = bundleStore.get(bundleId);
      if (!bundle) {
        throw new Error("Context bundle not found.");
      }

      const title = String(input.title || "").trim();
      if (!title) {
        throw new Error("Context bundle part title is required.");
      }

      partIdSeed += 1;
      const part = {
        id: partIdSeed,
        bundle_id: bundleId,
        part_type: String(input.partType || input.type || "feature_background").trim().toLowerCase(),
        title,
        content: typeof input.content === "string" ? input.content : "",
        position: Number.isInteger(input.position) ? input.position : (getBundleParts(bundleId).length + 1),
        include_in_compiled: input.includeInCompiled === false ? 0 : 1,
        include_in_preview: 1,
        part_type_label: "",
        created_at: "2026-04-04T00:00:00.000Z",
        updated_at: "2026-04-04T00:00:00.000Z"
      };
      partStore.set(part.id, part);
      return part;
    },
    getContextBundlePartById: async (id) => {
      calls.getContextBundlePartById.push(id);
      return partStore.get(Number(id));
    },
    getContextBundlePartsByBundleId: async (bundleId) => {
      calls.getContextBundlePartsByBundleId.push(bundleId);
      return getBundleParts(bundleId);
    },
    updateContextBundlePart: async (id, updates = {}) => {
      calls.updateContextBundlePart.push({ id, updates });
      const found = partStore.get(Number(id));
      if (!found) return null;

      const next = {
        ...found,
        ...(Object.prototype.hasOwnProperty.call(updates, "partType")
          ? { part_type: String(updates.partType || "").trim().toLowerCase() }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, "type")
          ? { part_type: String(updates.type || "").trim().toLowerCase() }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, "title")
          ? { title: String(updates.title || "").trim() }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, "content")
          ? { content: typeof updates.content === "string" ? updates.content : "" }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, "position")
          ? { position: Number(updates.position) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, "includeInCompiled")
          ? { include_in_compiled: updates.includeInCompiled ? 1 : 0 }
          : {}),
        updated_at: "2026-04-04T00:03:00.000Z"
      };

      partStore.set(next.id, next);
      return next;
    },
    deleteContextBundlePartById: async (id) => {
      calls.deleteContextBundlePartById.push(id);
      return partStore.delete(Number(id)) ? 1 : 0;
    }
  };

  const app = express();
  app.use(express.json());
  app.use("/api/context-bundles", createContextBundlesRouter(deps));
  const server = http.createServer(app);

  return {
    server,
    calls
  };
}

async function withServer(harness, fn) {
  await new Promise((resolve) => harness.server.listen(0, resolve));
  const { port } = harness.server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      harness.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("context bundles API persists and returns optional metadata fields", async () => {
  const harness = createHarness();

  await withServer(harness, async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/context-bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Metadata Bundle",
        description: "Reusable bundle",
        status: "active",
        intendedUse: "story_implementation",
        tags: ["backend", "migration"],
        projectName: "mini-codex-web-CLI",
        summary: "Preferred for schema updates."
      })
    });

    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.intended_use, "story_implementation");
    assert.deepEqual(created.tags, ["backend", "migration"]);
    assert.equal(created.project_name, "mini-codex-web-CLI");
    assert.equal(created.summary, "Preferred for schema updates.");

    const listResponse = await fetch(`${baseUrl}/api/context-bundles?includeParts=false`);
    assert.equal(listResponse.status, 200);
    const listed = await listResponse.json();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].title, "Metadata Bundle");
    assert.equal(listed[0].intended_use, "story_implementation");
    assert.deepEqual(listed[0].tags, ["backend", "migration"]);
    assert.equal(listed[0].project_name, "mini-codex-web-CLI");
    assert.equal(listed[0].summary, "Preferred for schema updates.");
  });

  assert.equal(harness.calls.getContextBundles.length, 1);
  assert.equal(harness.calls.getContextBundles[0].includeParts, false);
});

test("context bundles API supports metadata-only updates and optional null clears", async () => {
  const harness = createHarness();

  await withServer(harness, async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/context-bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Update Target",
        status: "draft"
      })
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();

    const updateResponse = await fetch(`${baseUrl}/api/context-bundles/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intended_use: "bug_fixes",
        tags: ["api", "ui"],
        project_name: "demo-project",
        summary: "Focus on user-facing fixes."
      })
    });
    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json();
    assert.equal(updated.intended_use, "bug_fixes");
    assert.deepEqual(updated.tags, ["api", "ui"]);
    assert.equal(updated.project_name, "demo-project");
    assert.equal(updated.summary, "Focus on user-facing fixes.");

    const clearResponse = await fetch(`${baseUrl}/api/context-bundles/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tags: [],
        summary: null
      })
    });
    assert.equal(clearResponse.status, 200);
    const cleared = await clearResponse.json();
    assert.deepEqual(cleared.tags, []);
    assert.equal(cleared.summary, null);
  });
});

test("context bundles API supports editing bundle title and description", async () => {
  const harness = createHarness();

  await withServer(harness, async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/context-bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Original Bundle Title",
        description: "Original bundle description",
        status: "draft"
      })
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();

    const updateResponse = await fetch(`${baseUrl}/api/context-bundles/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Updated Bundle Title",
        description: "Updated bundle description"
      })
    });
    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json();
    assert.equal(updated.title, "Updated Bundle Title");
    assert.equal(updated.description, "Updated bundle description");

    const getResponse = await fetch(`${baseUrl}/api/context-bundles/${created.id}?includeParts=false`);
    assert.equal(getResponse.status, 200);
    const loaded = await getResponse.json();
    assert.equal(loaded.title, "Updated Bundle Title");
    assert.equal(loaded.description, "Updated bundle description");
  });
});

test("context bundles API supports part CRUD and deterministic order fields", async () => {
  const harness = createHarness();

  await withServer(harness, async (baseUrl) => {
    const createBundleResponse = await fetch(`${baseUrl}/api/context-bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Part Bundle",
        description: "Part authoring"
      })
    });
    assert.equal(createBundleResponse.status, 201);
    const bundle = await createBundleResponse.json();

    const createPartResponse = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partType: "feature_background",
        title: "Goal",
        content: "Implement only story scope.",
        position: 1,
        includeInCompiled: true
      })
    });
    assert.equal(createPartResponse.status, 201);
    const createdPart = await createPartResponse.json();
    assert.equal(createdPart.bundle_id, bundle.id);
    assert.equal(createdPart.position, 1);

    const updatePartResponse = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/parts/${createdPart.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Goal Updated",
        position: 2,
        includeInCompiled: false
      })
    });
    assert.equal(updatePartResponse.status, 200);
    const updatedPart = await updatePartResponse.json();
    assert.equal(updatedPart.title, "Goal Updated");
    assert.equal(updatedPart.position, 2);
    assert.equal(updatedPart.include_in_compiled, 0);

    const getPartResponse = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/parts/${createdPart.id}`);
    assert.equal(getPartResponse.status, 200);
    const loadedPart = await getPartResponse.json();
    assert.equal(loadedPart.id, createdPart.id);
    assert.equal(loadedPart.bundle_id, bundle.id);
    assert.equal(loadedPart.title, "Goal Updated");

    const listPartsResponse = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/parts`);
    assert.equal(listPartsResponse.status, 200);
    const parts = await listPartsResponse.json();
    assert.equal(parts.length, 1);
    assert.equal(parts[0].id, createdPart.id);

    const deletePartResponse = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/parts/${createdPart.id}`, {
      method: "DELETE"
    });
    assert.equal(deletePartResponse.status, 200);
    const deletedPayload = await deletePartResponse.json();
    assert.equal(deletedPayload.deleted, true);

    const listAfterDeleteResponse = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/parts`);
    const afterDelete = await listAfterDeleteResponse.json();
    assert.deepEqual(afterDelete, []);
  });

  assert.ok(harness.calls.createContextBundlePart.length >= 1);
  assert.ok(harness.calls.updateContextBundlePart.length >= 1);
  assert.ok(harness.calls.getContextBundlePartsByBundleId.length >= 2);
  assert.ok(harness.calls.deleteContextBundlePartById.length >= 1);
});

test("context bundles API rejects cross-bundle part mutation", async () => {
  const harness = createHarness();

  await withServer(harness, async (baseUrl) => {
    const createBundleA = await fetch(`${baseUrl}/api/context-bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Bundle A", description: "A" })
    });
    const bundleA = await createBundleA.json();

    const createBundleB = await fetch(`${baseUrl}/api/context-bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Bundle B", description: "B" })
    });
    const bundleB = await createBundleB.json();

    const createPart = await fetch(`${baseUrl}/api/context-bundles/${bundleA.id}/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partType: "feature_background",
        title: "Shared Part",
        content: "Part content",
        position: 1
      })
    });
    const part = await createPart.json();

    const wrongUpdate = await fetch(`${baseUrl}/api/context-bundles/${bundleB.id}/parts/${part.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Should fail" })
    });
    assert.equal(wrongUpdate.status, 404);

    const wrongGet = await fetch(`${baseUrl}/api/context-bundles/${bundleB.id}/parts/${part.id}`);
    assert.equal(wrongGet.status, 404);

    const wrongDelete = await fetch(`${baseUrl}/api/context-bundles/${bundleB.id}/parts/${part.id}`, {
      method: "DELETE"
    });
    assert.equal(wrongDelete.status, 404);
  });
});

test("context bundles API duplicates bundle metadata and part relationships", async () => {
  const harness = createHarness();

  await withServer(harness, async (baseUrl) => {
    const createBundle = await fetch(`${baseUrl}/api/context-bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Source Bundle",
        description: "Source description",
        status: "active"
      })
    });
    assert.equal(createBundle.status, 201);
    const sourceBundle = await createBundle.json();

    const createPartA = await fetch(`${baseUrl}/api/context-bundles/${sourceBundle.id}/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partType: "feature_background",
        title: "Part One",
        content: "Part one content",
        position: 1
      })
    });
    assert.equal(createPartA.status, 201);

    const createPartB = await fetch(`${baseUrl}/api/context-bundles/${sourceBundle.id}/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partType: "implementation_constraints",
        title: "Part Two",
        content: "Part two content",
        position: 2
      })
    });
    assert.equal(createPartB.status, 201);

    const duplicateResponse = await fetch(`${baseUrl}/api/context-bundles/${sourceBundle.id}/duplicate`, {
      method: "POST"
    });
    assert.equal(duplicateResponse.status, 201);
    const duplicate = await duplicateResponse.json();
    assert.notEqual(duplicate.id, sourceBundle.id);
    assert.match(duplicate.title, /\(Copy\)$/);
    assert.equal(duplicate.parts.length, 2);
    assert.deepEqual(duplicate.parts.map((part) => part.bundle_id), [duplicate.id, duplicate.id]);
    assert.deepEqual(duplicate.parts.map((part) => part.position), [1, 2]);

    const listResponse = await fetch(`${baseUrl}/api/context-bundles`);
    assert.equal(listResponse.status, 200);
    const allBundles = await listResponse.json();
    assert.equal(allBundles.length, 2);
  });

  assert.equal(harness.calls.duplicateContextBundleById.length, 1);
});

test("context bundles API delete returns 404 when bundle is missing", async () => {
  const harness = createHarness();

  await withServer(harness, async (baseUrl) => {
    const deleteResponse = await fetch(`${baseUrl}/api/context-bundles/99999`, {
      method: "DELETE"
    });
    assert.equal(deleteResponse.status, 404);
    const payload = await deleteResponse.json();
    assert.match(payload.error, /not found/i);
  });
});

test("context bundles API duplicate returns 404 when bundle is missing", async () => {
  const harness = createHarness();

  await withServer(harness, async (baseUrl) => {
    const duplicateResponse = await fetch(`${baseUrl}/api/context-bundles/99999/duplicate`, {
      method: "POST"
    });
    assert.equal(duplicateResponse.status, 404);
    const payload = await duplicateResponse.json();
    assert.match(payload.error, /not found/i);
  });
});

test("context bundles API returns frontend-friendly validation errors for bundle and part input", async () => {
  const deps = {
    createContextBundle: async () => {
      throw new ContextBundleValidationError(
        [{ field: "title", code: "required", message: "Context bundle title is required." }],
        "Context bundle title is required."
      );
    },
    getContextBundleById: async () => ({ id: 1 }),
    getContextBundles: async () => [],
    updateContextBundle: async () => ({ id: 1 }),
    deleteContextBundleById: async () => 1,
    duplicateContextBundleById: async () => ({ id: 1 }),
    createContextBundlePart: async () => {
      throw new ContextBundleValidationError(
        [{ field: "position", code: "duplicate", message: "Context bundle part position 1 is already in use for this bundle." }],
        "Context bundle part position 1 is already in use for this bundle."
      );
    },
    getContextBundlePartById: async () => ({ id: 10, bundle_id: 1 }),
    getContextBundlePartsByBundleId: async () => [],
    updateContextBundlePart: async () => ({ id: 10, bundle_id: 1 }),
    deleteContextBundlePartById: async () => 1
  };

  const app = express();
  app.use(express.json());
  app.use("/api/context-bundles", createContextBundlesRouter(deps));
  const server = http.createServer(app);

  await withServer({ server }, async (baseUrl) => {
    const bundleResponse = await fetch(`${baseUrl}/api/context-bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(bundleResponse.status, 400);
    const bundlePayload = await bundleResponse.json();
    assert.equal(bundlePayload.error, "Context bundle title is required.");
    assert.deepEqual(bundlePayload.validationErrors, [
      { field: "title", code: "required", message: "Context bundle title is required." }
    ]);

    const partResponse = await fetch(`${baseUrl}/api/context-bundles/1/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partType: "feature_background", title: "One", content: "One", position: 1 })
    });
    assert.equal(partResponse.status, 400);
    const partPayload = await partResponse.json();
    assert.equal(partPayload.error, "Context bundle part position 1 is already in use for this bundle.");
    assert.deepEqual(partPayload.validationErrors, [
      { field: "position", code: "duplicate", message: "Context bundle part position 1 is already in use for this bundle." }
    ]);
  });
});

test("context bundles API returns bundle preview payload with deterministic compiled ordering", async () => {
  const harness = createHarness();

  await withServer(harness, async (baseUrl) => {
    const createBundleResponse = await fetch(`${baseUrl}/api/context-bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Preview Bundle",
        description: "Preview description",
        status: "draft"
      })
    });
    assert.equal(createBundleResponse.status, 201);
    const bundle = await createBundleResponse.json();

    const createPartA = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partType: "testing_expectations",
        title: "Tests",
        content: "Add regression coverage.",
        position: 3,
        includeInCompiled: true
      })
    });
    assert.equal(createPartA.status, 201);
    const partA = await createPartA.json();

    const createPartB = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partType: "feature_background",
        title: "Goal",
        content: "Build preview output.",
        position: 1,
        includeInCompiled: true
      })
    });
    assert.equal(createPartB.status, 201);
    const partB = await createPartB.json();

    const createPartC = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partType: "implementation_constraints",
        title: "Scope",
        content: "Only implement requested story.",
        position: 2,
        includeInCompiled: false
      })
    });
    assert.equal(createPartC.status, 201);
    const partC = await createPartC.json();

    const previewResponse = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/preview`);
    assert.equal(previewResponse.status, 200);
    const payload = await previewResponse.json();

    assert.equal(payload.bundle.id, bundle.id);
    assert.equal(payload.preview.format, "context_bundle_compiled_preview_v1");
    assert.deepEqual(payload.preview.orderedPartIds, [partB.id, partC.id, partA.id]);
    assert.deepEqual(payload.preview.includedPartIds, [partB.id, partA.id]);
    assert.deepEqual(
      payload.preview.sections.map((section) => section.sectionLabel),
      ["Feature Background: Goal", "Testing Expectations: Tests"]
    );
    assert.deepEqual(
      payload.preview.compilationGroups.map((group) => group.sectionKey),
      ["architecture_guidance", "background_context"]
    );
    assert.match(payload.preview.compiledText, /## Architecture Guidance/);
    assert.match(payload.preview.compiledText, /### Testing Expectations: Tests/);
    assert.match(payload.preview.compiledText, /## Background Context/);
    assert.match(payload.preview.compiledText, /### Feature Background: Goal/);
  });
});

test("context bundles API preview reflects part content and inclusion changes", async () => {
  const harness = createHarness();

  await withServer(harness, async (baseUrl) => {
    const createBundleResponse = await fetch(`${baseUrl}/api/context-bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Mutable Preview Bundle",
        description: "Preview mutation coverage",
        status: "draft"
      })
    });
    assert.equal(createBundleResponse.status, 201);
    const bundle = await createBundleResponse.json();

    const createPartResponse = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partType: "feature_background",
        title: "Goal",
        content: "Initial content",
        position: 1,
        includeInCompiled: true
      })
    });
    assert.equal(createPartResponse.status, 201);
    const part = await createPartResponse.json();

    const initialPreviewResponse = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/preview`);
    assert.equal(initialPreviewResponse.status, 200);
    const initialPayload = await initialPreviewResponse.json();
    assert.deepEqual(initialPayload.preview.includedPartIds, [part.id]);
    assert.match(initialPayload.preview.compiledText, /Initial content/);

    const updatePartResponse = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/parts/${part.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Updated content",
        includeInCompiled: false
      })
    });
    assert.equal(updatePartResponse.status, 200);

    const updatedPreviewResponse = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/preview`);
    assert.equal(updatedPreviewResponse.status, 200);
    const updatedPayload = await updatedPreviewResponse.json();
    assert.deepEqual(updatedPayload.preview.includedPartIds, []);
    assert.equal(updatedPayload.preview.compiledText, "");

    const includeAgainResponse = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/parts/${part.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        includeInCompiled: true
      })
    });
    assert.equal(includeAgainResponse.status, 200);

    const restoredPreviewResponse = await fetch(`${baseUrl}/api/context-bundles/${bundle.id}/preview`);
    assert.equal(restoredPreviewResponse.status, 200);
    const restoredPayload = await restoredPreviewResponse.json();
    assert.deepEqual(restoredPayload.preview.includedPartIds, [part.id]);
    assert.match(restoredPayload.preview.compiledText, /Updated content/);
  });
});
