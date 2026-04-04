const express = require("express");
const { ContextBundleValidationError } = require("./contextBundleValidation");

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

function buildErrorPayload(error, fallbackMessage) {
  const message = error?.message || fallbackMessage || "Request failed.";
  if (error instanceof ContextBundleValidationError || Array.isArray(error?.validationErrors)) {
    return {
      error: message,
      validationErrors: Array.isArray(error?.validationErrors) ? error.validationErrors : []
    };
  }

  return { error: message };
}

async function getValidatedPartForBundle({
  bundleId,
  partId,
  getContextBundlePartById
}) {
  const existingPart = await getContextBundlePartById(partId);
  if (!existingPart) {
    return {
      error: { status: 404, message: "Context bundle part not found." }
    };
  }

  if (existingPart.bundle_id !== bundleId) {
    return {
      error: { status: 404, message: "Context bundle part not found for bundle." }
    };
  }

  return { part: existingPart };
}

function createContextBundlesRouter(deps = {}) {
  const {
    createContextBundle,
    getContextBundleById,
    getContextBundles,
    updateContextBundle,
    deleteContextBundleById,
    duplicateContextBundleById,
    createContextBundlePart,
    getContextBundlePartById,
    getContextBundlePartsByBundleId,
    updateContextBundlePart,
    deleteContextBundlePartById
  } = deps;

  if (typeof createContextBundle !== "function") throw new Error("createContextBundle dependency is required.");
  if (typeof getContextBundleById !== "function") throw new Error("getContextBundleById dependency is required.");
  if (typeof getContextBundles !== "function") throw new Error("getContextBundles dependency is required.");
  if (typeof updateContextBundle !== "function") throw new Error("updateContextBundle dependency is required.");
  if (typeof deleteContextBundleById !== "function") throw new Error("deleteContextBundleById dependency is required.");
  if (typeof duplicateContextBundleById !== "function") throw new Error("duplicateContextBundleById dependency is required.");
  if (typeof createContextBundlePart !== "function") throw new Error("createContextBundlePart dependency is required.");
  if (typeof getContextBundlePartById !== "function") throw new Error("getContextBundlePartById dependency is required.");
  if (typeof getContextBundlePartsByBundleId !== "function") throw new Error("getContextBundlePartsByBundleId dependency is required.");
  if (typeof updateContextBundlePart !== "function") throw new Error("updateContextBundlePart dependency is required.");
  if (typeof deleteContextBundlePartById !== "function") throw new Error("deleteContextBundlePartById dependency is required.");

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
      const status = Number.isInteger(error?.status) ? error.status : 400;
      return res.status(status).json(buildErrorPayload(error, "Failed to create context bundle."));
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
      const status = Number.isInteger(error?.status) ? error.status : 400;
      return res.status(status).json(buildErrorPayload(error, "Failed to update context bundle."));
    }
  });

  router.get("/:bundleId/parts", async (req, res) => {
    const bundleId = parsePositiveId(req.params?.bundleId);
    if (!bundleId) {
      return res.status(400).json({ error: "Invalid context bundle id." });
    }

    try {
      const bundle = await getContextBundleById(bundleId, { includeParts: false });
      if (!bundle) {
        return res.status(404).json({ error: "Context bundle not found." });
      }

      const parts = await getContextBundlePartsByBundleId(bundleId);
      return res.json(parts);
    } catch (error) {
      return res.status(500).json({ error: error?.message || "Failed to load context bundle parts." });
    }
  });

  router.post("/:bundleId/parts", async (req, res) => {
    const bundleId = parsePositiveId(req.params?.bundleId);
    if (!bundleId) {
      return res.status(400).json({ error: "Invalid context bundle id." });
    }

    try {
      const createdPart = await createContextBundlePart({
        ...(req.body || {}),
        bundleId
      });
      return res.status(201).json(createdPart);
    } catch (error) {
      const message = error?.message || "Failed to create context bundle part.";
      if (/not found/i.test(message)) {
        return res.status(404).json({ error: message });
      }
      const status = Number.isInteger(error?.status) ? error.status : 400;
      return res.status(status).json(buildErrorPayload(error, "Failed to create context bundle part."));
    }
  });

  router.get("/:bundleId/parts/:partId", async (req, res) => {
    const bundleId = parsePositiveId(req.params?.bundleId);
    const partId = parsePositiveId(req.params?.partId);
    if (!bundleId) {
      return res.status(400).json({ error: "Invalid context bundle id." });
    }
    if (!partId) {
      return res.status(400).json({ error: "Invalid context bundle part id." });
    }

    try {
      const validated = await getValidatedPartForBundle({
        bundleId,
        partId,
        getContextBundlePartById
      });
      if (validated.error) {
        return res.status(validated.error.status).json({ error: validated.error.message });
      }

      return res.json(validated.part);
    } catch (error) {
      return res.status(500).json({ error: error?.message || "Failed to load context bundle part." });
    }
  });

  router.patch("/:bundleId/parts/:partId", async (req, res) => {
    const bundleId = parsePositiveId(req.params?.bundleId);
    const partId = parsePositiveId(req.params?.partId);
    if (!bundleId) {
      return res.status(400).json({ error: "Invalid context bundle id." });
    }
    if (!partId) {
      return res.status(400).json({ error: "Invalid context bundle part id." });
    }

    try {
      const validated = await getValidatedPartForBundle({
        bundleId,
        partId,
        getContextBundlePartById
      });
      if (validated.error) {
        return res.status(validated.error.status).json({ error: validated.error.message });
      }

      const updatedPart = await updateContextBundlePart(partId, req.body || {});
      if (!updatedPart) {
        return res.status(404).json({ error: "Context bundle part not found." });
      }
      return res.json(updatedPart);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 400;
      return res.status(status).json(buildErrorPayload(error, "Failed to update context bundle part."));
    }
  });

  router.delete("/:bundleId/parts/:partId", async (req, res) => {
    const bundleId = parsePositiveId(req.params?.bundleId);
    const partId = parsePositiveId(req.params?.partId);
    if (!bundleId) {
      return res.status(400).json({ error: "Invalid context bundle id." });
    }
    if (!partId) {
      return res.status(400).json({ error: "Invalid context bundle part id." });
    }

    try {
      const validated = await getValidatedPartForBundle({
        bundleId,
        partId,
        getContextBundlePartById
      });
      if (validated.error) {
        return res.status(validated.error.status).json({ error: validated.error.message });
      }

      const deletedCount = await deleteContextBundlePartById(partId);
      if (deletedCount <= 0) {
        return res.status(404).json({ error: "Context bundle part not found." });
      }
      return res.json({ deleted: true, id: partId, bundleId });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "Failed to delete context bundle part." });
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

  router.post("/:bundleId/duplicate", async (req, res) => {
    const bundleId = parsePositiveId(req.params?.bundleId);
    if (!bundleId) {
      return res.status(400).json({ error: "Invalid context bundle id." });
    }

    try {
      const duplicatedBundle = await duplicateContextBundleById(bundleId);
      if (!duplicatedBundle) {
        return res.status(404).json({ error: "Context bundle not found." });
      }
      return res.status(201).json(duplicatedBundle);
    } catch (error) {
      return res.status(500).json({ error: error?.message || "Failed to duplicate context bundle." });
    }
  });

  return router;
}

module.exports = {
  createContextBundlesRouter
};
