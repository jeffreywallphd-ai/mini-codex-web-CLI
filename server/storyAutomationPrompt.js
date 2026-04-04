function formatSection(title, lines) {
  const safeLines = Array.isArray(lines) ? lines : [];
  return [
    `## ${title}`,
    ...safeLines.map((line) => String(line || "").trim()).filter(Boolean),
    ""
  ].join("\n");
}

function buildStoryAutomationPrompt(context) {
  const featureTitle = String(context?.feature_name || "").trim();
  const featureDescription = String(context?.feature_description || "").trim();
  const epicTitle = String(context?.epic_name || "").trim();
  const epicDescription = String(context?.epic_description || "").trim();
  const storyTitle = String(context?.story_name || "").trim();
  const storyDescription = String(context?.story_description || "").trim();

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
  buildStoryAutomationPrompt
};
