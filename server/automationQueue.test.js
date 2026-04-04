const test = require("node:test");
const assert = require("node:assert/strict");

const {
  flattenStoryExecutionQueues,
  generateStoryExecutionQueues,
  withStableOrdering
} = require("./automationQueue");

test("withStableOrdering sorts by order and keeps original order for ties", () => {
  const result = withStableOrdering(
    [
      { id: "b", order: 2 },
      { id: "a", order: 1 },
      { id: "c", order: 2 }
    ],
    (item) => item.order
  );

  assert.deepEqual(result.map((item) => item.id), ["a", "b", "c"]);
});

test("generateStoryExecutionQueues orders features, epics, and stories", () => {
  const queues = generateStoryExecutionQueues([
    {
      id: "feature-2",
      title: "Feature 2",
      order: 2,
      epics: [
        {
          id: "epic-2-2",
          title: "Epic 2.2",
          order: 2,
          stories: [
            { id: "story-2-2-b", title: "Story B", order: 2 },
            { id: "story-2-2-a", title: "Story A", order: 1 }
          ]
        }
      ]
    },
    {
      id: "feature-1",
      title: "Feature 1",
      order: 1,
      epics: [
        {
          id: "epic-1-2",
          title: "Epic 1.2",
          order: 2,
          stories: [
            { id: "story-1-2", title: "Story 1.2", order: 1 }
          ]
        },
        {
          id: "epic-1-1",
          title: "Epic 1.1",
          order: 1,
          stories: [
            { id: "story-1-1-b", title: "Story 1.1.b", order: 2 },
            { id: "story-1-1-a", title: "Story 1.1.a", order: 1 }
          ]
        }
      ]
    }
  ]);

  const orderedStories = flattenStoryExecutionQueues(queues);

  assert.deepEqual(
    orderedStories.map((story) => story.storyId),
    ["story-1-1-a", "story-1-1-b", "story-1-2", "story-2-2-a", "story-2-2-b"]
  );

  assert.deepEqual(
    orderedStories.map((story) => story.positionInQueue),
    [1, 2, 3, 4, 5]
  );
});

test("generateStoryExecutionQueues skips epics with no stories", () => {
  const queues = generateStoryExecutionQueues([
    {
      id: "feature-1",
      title: "Feature 1",
      order: 1,
      epics: [
        {
          id: "epic-empty",
          title: "Epic Empty",
          order: 1,
          stories: []
        },
        {
          id: "epic-filled",
          title: "Epic Filled",
          order: 2,
          stories: [{ id: "story-1", title: "Story 1", order: 1 }]
        }
      ]
    }
  ]);

  assert.equal(queues.length, 1);
  assert.equal(queues[0].epicId, "epic-filled");
});

test("generateStoryExecutionQueues throws when features input is invalid", () => {
  assert.throws(
    () => generateStoryExecutionQueues(null),
    /features must be an array/
  );
});

test("flattenStoryExecutionQueues throws when queue input is invalid", () => {
  assert.throws(
    () => flattenStoryExecutionQueues(null),
    /queues must be an array/
  );
});
