const express = require("express");

function parseBooleanQuery(value, defaultValue = true) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }

  return defaultValue;
}

function parsePositiveId(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function createContextBundlesRouter(deps = {}) {
  const {
    createContextBundle,
    getContextBundleById,
    getContextBundles,
    updateContextBundle,
    deleteContextBundleById
  } = deps;

  if (typeof createContextBundle !== "function") throw new Error("createContextBundle dependency is required.");
  if (typeof getContextBundleById !== "function") throw new Error("getContextBundleById dependency is required.");
  if (typeof getContextBundles !== "function") throw new Error("getContextBundles dependency is required.");
  if (typeof updateContextBundle !== "function") throw new Error("updateContextBundle dependency is required.");
  if (typeof deleteContextBundleById !== "function") throw new Error("deleteContextBundleById dependency is required.");

  const router = express.Router();

  router.get("/", async (req, res) => {
    try {
      const includeParts = parseBooleanQuery(req.query?.includeParts, true);
      const bundles = await getContextBundles({ includeParts });
      return res.json(bundles);
    } catch (error) {
      return res.status(500).json({ error: error?.message || "Failed to load context bundles." });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const createdBundle = await createContextBundle(req.body || {});
      return res.status(201).json(createdBundle);
    } catch (error) {
      return res.status(400).json({ error: error?.message || "Failed to create context bundle." });
    }
  });

  router.get("/:bundleId", async (req, res) => {
    const bundleId = parsePositiveId(req.params?.bundleId);
    if (!bundleId) {
      return res.status(400).json({ error: "Invalid context bundle id." });
    }

    try {
      const includeParts = parseBooleanQuery(req.query?.includeParts, true);
      const bundle = await getContextBundleById(bundleId, { includeParts });
      if (!bundle) {
        return res.status(404).json({ error: "Context bundle not found." });
      }
      return res.json(bundle);
    } catch (error) {
      return res.status(500).json({ error: error?.message || "Failed to load context bundle." });
    }
  });

  router.patch("/:bundleId", async (req, res) => {
    const bundleId = parsePositiveId(req.params?.bundleId);
    if (!bundleId) {
      return res.status(400).json({ error: "Invalid context bundle id." });
    }

    try {
      const updatedBundle = await updateContextBundle(bundleId, req.body || {});
      if (!updatedBundle) {
        return res.status(404).json({ error: "Context bundle not found." });
      }
      return res.json(updatedBundle);
    } catch (error) {
      return res.status(400).json({ error: error?.message || "Failed to update context bundle." });
    }
  });

  router.delete("/:bundleId", async (req, res) => {
    const bundleId = parsePositiveId(req.params?.bundleId);
    if (!bundleId) {
      return res.status(400).json({ error: "Invalid context bundle id." });
    }

    try {
      const deletedCount = await deleteContextBundleById(bundleId);
      if (deletedCount <= 0) {
        return res.status(404).json({ error: "Context bundle not found." });
      }
      return res.json({ deleted: true, id: bundleId });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "Failed to delete context bundle." });
    }
  });

  return router;
}

module.exports = {
  createContextBundlesRouter
};
