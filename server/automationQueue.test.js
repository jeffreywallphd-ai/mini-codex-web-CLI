const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AUTOMATION_OUTCOME,
  AUTOMATION_SCOPE,
  DEFAULT_AUTOMATION_RULES,
  createAutomationRules,
  defineAutomationExecutionPlan,
  evaluateAutomationStopCondition,
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

test("automation rule defaults define strict feature epic story ordering", () => {
  assert.deepEqual(DEFAULT_AUTOMATION_RULES.ordering.levels, [
    AUTOMATION_SCOPE.FEATURE,
    AUTOMATION_SCOPE.EPIC,
    AUTOMATION_SCOPE.STORY
  ]);
  assert.equal(DEFAULT_AUTOMATION_RULES.ordering.strategy, "order-asc-stable");
  assert.equal(DEFAULT_AUTOMATION_RULES.stopConditions.stopOnStoryFailure, true);
  assert.equal(DEFAULT_AUTOMATION_RULES.stopConditions.stopOnEpicFailure, true);
});

test("createAutomationRules merges stop-condition overrides", () => {
  const rules = createAutomationRules({
    stopConditions: {
      stopOnStoryFailure: false
    }
  });

  assert.equal(rules.stopConditions.stopOnStoryFailure, false);
  assert.equal(rules.stopConditions.stopOnStoryBlocked, true);
  assert.deepEqual(rules.ordering.levels, [
    AUTOMATION_SCOPE.FEATURE,
    AUTOMATION_SCOPE.EPIC,
    AUTOMATION_SCOPE.STORY
  ]);
});

test("evaluateAutomationStopCondition applies fail-fast rules", () => {
  assert.deepEqual(
    evaluateAutomationStopCondition({
      entityType: AUTOMATION_SCOPE.STORY,
      outcome: AUTOMATION_OUTCOME.FAILED
    }),
    {
      shouldStop: true,
      entityType: AUTOMATION_SCOPE.STORY,
      outcome: AUTOMATION_OUTCOME.FAILED,
      reason: "story.failed"
    }
  );

  assert.deepEqual(
    evaluateAutomationStopCondition(
      {
        entityType: AUTOMATION_SCOPE.STORY,
        outcome: AUTOMATION_OUTCOME.FAILED
      },
      {
        stopConditions: {
          stopOnStoryFailure: false
        }
      }
    ),
    {
      shouldStop: false,
      entityType: AUTOMATION_SCOPE.STORY,
      outcome: AUTOMATION_OUTCOME.FAILED,
      reason: null
    }
  );

  assert.deepEqual(
    evaluateAutomationStopCondition({
      entityType: AUTOMATION_SCOPE.STORY,
      outcome: AUTOMATION_OUTCOME.SUCCESS
    }),
    {
      shouldStop: false,
      entityType: AUTOMATION_SCOPE.STORY,
      outcome: AUTOMATION_OUTCOME.SUCCESS,
      reason: null
    }
  );
});

test("evaluateAutomationStopCondition validates event shape", () => {
  assert.throws(
    () => evaluateAutomationStopCondition(null),
    /event must be an object/
  );

  assert.throws(
    () => evaluateAutomationStopCondition({ entityType: "team", outcome: AUTOMATION_OUTCOME.SUCCESS }),
    /event.entityType must be feature, epic, or story/
  );

  assert.throws(
    () => evaluateAutomationStopCondition({ entityType: AUTOMATION_SCOPE.STORY, outcome: "unknown" }),
    /event.outcome must be success, failed, blocked, or cancelled/
  );
});

test("defineAutomationExecutionPlan returns rules, queues, and flattened stories", () => {
  const plan = defineAutomationExecutionPlan([
    {
      id: "feature-1",
      title: "Feature 1",
      order: 1,
      epics: [
        {
          id: "epic-1",
          title: "Epic 1",
          order: 1,
          stories: [
            { id: "story-2", title: "Story 2", order: 2 },
            { id: "story-1", title: "Story 1", order: 1 }
          ]
        }
      ]
    }
  ]);

  assert.deepEqual(plan.scope, [
    AUTOMATION_SCOPE.FEATURE,
    AUTOMATION_SCOPE.EPIC,
    AUTOMATION_SCOPE.STORY
  ]);
  assert.equal(plan.queues.length, 1);
  assert.deepEqual(plan.stories.map((story) => story.storyId), ["story-1", "story-2"]);
  assert.equal(plan.rules.stopConditions.stopOnStoryFailure, true);
});
