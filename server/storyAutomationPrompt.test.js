const test = require("node:test");
const assert = require("node:assert/strict");

const { buildStoryAutomationPrompt } = require("./storyAutomationPrompt");

test("story automation prompt includes feature, epic, story context and expectations", () => {
  const prompt = buildStoryAutomationPrompt({
    feature_name: "Feature A",
    feature_description: "Feature description",
    epic_name: "Epic A",
    epic_description: "Epic description",
    story_name: "Story A",
    story_description: "Story description"
  });

  assert.match(prompt, /## Feature Context/);
  assert.match(prompt, /Title: Feature A/);
  assert.match(prompt, /## Epic Context/);
  assert.match(prompt, /Title: Epic A/);
  assert.match(prompt, /## Story Request/);
  assert.match(prompt, /Title: Story A/);
  assert.match(prompt, /relevant tests/i);
  assert.match(prompt, /relevant documentation/i);
  assert.match(prompt, /existing documentation standards/i);
  assert.match(prompt, /existing system architecture practices/i);
});
