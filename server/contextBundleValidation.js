const { normalizeContextBundlePartType } = require("./contextBundlePartTypes");

const MAX_BUNDLE_TITLE_LENGTH = 160;
const MAX_BUNDLE_DESCRIPTION_LENGTH = 4000;
const MAX_PART_TITLE_LENGTH = 160;
const MAX_PART_CONTENT_LENGTH = 24000;

class ContextBundleValidationError extends Error {
  constructor(validationErrors, message = "Context bundle validation failed.") {
    super(message);
    this.name = "ContextBundleValidationError";
    this.status = 400;
    this.validationErrors = Array.isArray(validationErrors) ? validationErrors : [];
  }
}

function makeValidationError(field, code, message) {
  return { field, code, message };
}

function appendMaxLengthError(errors, field, value, maxLength, label) {
  if (typeof value === "string" && value.length > maxLength) {
    errors.push(makeValidationError(
      field,
      "max_length_exceeded",
      `${label} must be ${maxLength} characters or fewer.`
    ));
  }
}

function throwIfValidationErrors(validationErrors, fallbackMessage) {
  if (!Array.isArray(validationErrors) || validationErrors.length <= 0) {
    return;
  }

  throw new ContextBundleValidationError(
    validationErrors,
    validationErrors[0]?.message || fallbackMessage || "Context bundle validation failed."
  );
}

function validateBundleInput(input = {}, { partial = false } = {}) {
  const errors = [];
  const hasTitle = Object.prototype.hasOwnProperty.call(input, "title");
  const hasDescription = Object.prototype.hasOwnProperty.call(input, "description");

  if (!partial || hasTitle) {
    const title = String(input.title || "").trim();
    if (!title) {
      errors.push(makeValidationError("title", "required", "Context bundle title is required."));
    }
  }

  if (!partial || hasDescription) {
    const description = typeof input.description === "string" ? input.description.trim() : "";
    if (!description) {
      errors.push(makeValidationError("description", "required", "Context bundle description is required."));
    }
  }

  appendMaxLengthError(errors, "title", typeof input.title === "string" ? input.title.trim() : "", MAX_BUNDLE_TITLE_LENGTH, "Context bundle title");
  appendMaxLengthError(errors, "description", typeof input.description === "string" ? input.description.trim() : "", MAX_BUNDLE_DESCRIPTION_LENGTH, "Context bundle description");

  throwIfValidationErrors(errors, "Context bundle validation failed.");
}

function validatePartInput(input = {}, { partial = false } = {}) {
  const errors = [];
  const hasPartType = Object.prototype.hasOwnProperty.call(input, "partType")
    || Object.prototype.hasOwnProperty.call(input, "type");
  const hasTitle = Object.prototype.hasOwnProperty.call(input, "title");
  const hasContent = Object.prototype.hasOwnProperty.call(input, "content")
    || Object.prototype.hasOwnProperty.call(input, "body");

  if (!partial || hasPartType) {
    try {
      normalizeContextBundlePartType(
        input.partType || input.type,
        "Context bundle part type"
      );
    } catch (error) {
      errors.push(makeValidationError("partType", "invalid_value", error.message));
    }
  }

  if (!partial || hasTitle) {
    const title = String(input.title || "").trim();
    if (!title) {
      errors.push(makeValidationError("title", "required", "Context bundle part title is required."));
    }
  }

  if (!partial || hasContent) {
    const content = typeof input.content === "string"
      ? input.content.trim()
      : (typeof input.body === "string" ? input.body.trim() : "");
    if (!content) {
      errors.push(makeValidationError("content", "required", "Context bundle part content is required."));
    }
  }

  appendMaxLengthError(errors, "title", typeof input.title === "string" ? input.title.trim() : "", MAX_PART_TITLE_LENGTH, "Context bundle part title");
  appendMaxLengthError(errors, "content", typeof input.content === "string" ? input.content : (typeof input.body === "string" ? input.body : ""), MAX_PART_CONTENT_LENGTH, "Context bundle part content");

  throwIfValidationErrors(errors, "Context bundle part validation failed.");
}

function buildDuplicatePositionValidationError(position) {
  return new ContextBundleValidationError(
    [
      makeValidationError(
        "position",
        "duplicate",
        `Context bundle part position ${position} is already in use for this bundle.`
      )
    ],
    `Context bundle part position ${position} is already in use for this bundle.`
  );
}

module.exports = {
  ContextBundleValidationError,
  validateBundleInput,
  validatePartInput,
  buildDuplicatePositionValidationError
};
