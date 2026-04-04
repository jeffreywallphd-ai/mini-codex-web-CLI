function formatSection(title, lines) {
  const safeLines = Array.isArray(lines) ? lines : [];
  return [
    `## ${title}`,
    ...safeLines.map((line) => String(line || "").trim()).filter(Boolean),
    ""
  ].join("\n");
}

class StoryAutomationPromptError extends Error {
  constructor(message) {
    super(message);
    this.name = "StoryAutomationPromptError";
    this.code = "prompt_generation_failed";
  }
}

function firstNonEmptyString(values) {
  if (!Array.isArray(values)) return "";

  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return "";
}

function buildStoryAutomationPrompt(context) {
  const source = context && typeof context === "object" ? context : {};
  const featureTitle = firstNonEmptyString([
    source.feature_name,
    source.featureTitle,
    source.feature_title,
    source.featureName
  ]);
  const featureDescription = firstNonEmptyString([
    source.feature_description,
    source.featureDescription
  ]);
  const epicTitle = firstNonEmptyString([
    source.epic_name,
    source.epicTitle,
    source.epic_title,
    source.epicName
  ]);
  const epicDescription = firstNonEmptyString([
    source.epic_description,
    source.epicDescription
  ]);
  const storyTitle = firstNonEmptyString([
    source.story_name,
    source.storyTitle,
    source.story_title,
    source.storyName,
    source.name
  ]);
  const storyDescription = firstNonEmptyString([
    source.story_description,
    source.storyDescription,
    source.description
  ]);

  if (!storyTitle) {
    throw new StoryAutomationPromptError("Story prompt generation requires a story title.");
  }

  if (!storyDescription) {
    throw new StoryAutomationPromptError("Story prompt generation requires a story description.");
  }

  return [
    "Implement the requested story in this repository.",
    "",
    formatSection("Feature Context", [
      `Title: ${featureTitle || "(no feature title provided)"}`,
      `Description: ${featureDescription || "(no feature description provided)"}`
    ]),
    formatSection("Epic Context", [
      `Title: ${epicTitle || "(no epic title provided)"}`,
      `Description: ${epicDescription || "(no epic description provided)"}`
    ]),
    formatSection("Story Request", [
      `Title: ${storyTitle || "(no story title provided)"}`,
      `Description: ${storyDescription || "(no story description provided)"}`
    ]),
    formatSection("Implementation Expectations", [
      "- Implement only the requested story scope.",
      "- Add or update relevant tests for the implemented functionality.",
      "- Add or update relevant documentation for this feature/epic/story.",
      "- Follow existing documentation standards in this repository where present.",
      "- Follow existing system architecture practices in this repository unless this story explicitly requires a different approach."
    ])
  ].join("\n").trim();
}

module.exports = {
  buildStoryAutomationPrompt,
  StoryAutomationPromptError
};
