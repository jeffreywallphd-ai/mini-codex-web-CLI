const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildStoryAutomationPrompt,
  StoryAutomationPromptError
} = require("./storyAutomationPrompt");

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

test("story automation prompt supports queued story field names", () => {
  const prompt = buildStoryAutomationPrompt({
    featureTitle: "Feature Queue",
    epicTitle: "Epic Queue",
    storyTitle: "Story Queue",
    storyDescription: "Queued story description"
  });

  assert.match(prompt, /Title: Feature Queue/);
  assert.match(prompt, /Title: Epic Queue/);
  assert.match(prompt, /Title: Story Queue/);
  assert.match(prompt, /Description: Queued story description/);
});

test("story automation prompt supports generic name and description fields for story scope", () => {
  const prompt = buildStoryAutomationPrompt({
    name: "Generic Story",
    description: "Generic story description"
  });

  assert.match(prompt, /Title: Generic Story/);
  assert.match(prompt, /Description: Generic story description/);
});

test("story automation prompt throws a dedicated error when story title is missing", () => {
  assert.throws(
    () => buildStoryAutomationPrompt({
      storyDescription: "Description present"
    }),
    (error) => {
      assert.equal(error instanceof StoryAutomationPromptError, true);
      assert.equal(error.code, "prompt_generation_failed");
      assert.match(error.message, /story title/i);
      return true;
    }
  );
});

test("story automation prompt throws a dedicated error when story description is missing", () => {
  assert.throws(
    () => buildStoryAutomationPrompt({
      storyTitle: "Story present"
    }),
    (error) => {
      assert.equal(error instanceof StoryAutomationPromptError, true);
      assert.equal(error.code, "prompt_generation_failed");
      assert.match(error.message, /story description/i);
      return true;
    }
  );
});
