const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const express = require("express");

const { createContextBundlesRouter } = require("./contextBundlesApi");

function createHarness() {
  let idSeed = 7000;
  const bundleStore = new Map();
  const calls = {
    getContextBundles: [],
    getContextBundleById: [],
    createContextBundle: [],
    updateContextBundle: [],
    deleteContextBundleById: []
  };

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
        updated_at: now,
        parts: []
      };
      if (!bundle.title) {
        throw new Error("Context bundle title is required.");
      }
      bundleStore.set(bundle.id, bundle);
      return bundle;
    },
    getContextBundleById: async (id, options = {}) => {
      calls.getContextBundleById.push({ id, options });
      const found = bundleStore.get(Number(id)) || null;
      if (!found) return null;
      if (options.includeParts === false) {
        const { parts, ...withoutParts } = found;
        return withoutParts;
      }
      return found;
    },
    getContextBundles: async (options = {}) => {
      calls.getContextBundles.push(options);
      const all = [...bundleStore.values()];
      if (options.includeParts === false) {
        return all.map((bundle) => {
          const { parts, ...withoutParts } = bundle;
          return withoutParts;
        });
      }
      return all;
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
      return next;
    },
    deleteContextBundleById: async (id) => {
      calls.deleteContextBundleById.push(id);
      return bundleStore.delete(Number(id)) ? 1 : 0;
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
