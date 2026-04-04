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

test("generateStoryExecutionQueues supports DB-shaped name fields", () => {
  const queues = generateStoryExecutionQueues([
    {
      id: 101,
      name: "Feature From DB",
      epics: [
        {
          id: 201,
          name: "Epic From DB",
          stories: [
            { id: 301, name: "Story From DB" }
          ]
        }
      ]
    }
  ]);

  assert.equal(queues.length, 1);
  assert.equal(queues[0].featureTitle, "Feature From DB");
  assert.equal(queues[0].epicTitle, "Epic From DB");
  assert.equal(queues[0].stories.length, 1);
  assert.equal(queues[0].stories[0].storyTitle, "Story From DB");
  assert.equal(queues[0].stories[0].featureId, 101);
  assert.equal(queues[0].stories[0].epicId, 201);
  assert.equal(queues[0].stories[0].storyId, 301);
});

test("generateStoryExecutionQueues accepts numeric-string order values", () => {
  const queues = generateStoryExecutionQueues([
    {
      id: "feature-10",
      title: "Feature 10",
      order: "10",
      epics: [
        {
          id: "epic-10",
          title: "Epic 10",
          order: "10",
          stories: [
            { id: "story-10", title: "Story 10", order: "10" }
          ]
        }
      ]
    },
    {
      id: "feature-2",
      title: "Feature 2",
      order: "2",
      epics: [
        {
          id: "epic-2",
          title: "Epic 2",
          order: "2",
          stories: [
            { id: "story-2", title: "Story 2", order: "2" }
          ]
        }
      ]
    }
  ]);

  const orderedStories = flattenStoryExecutionQueues(queues);

  assert.deepEqual(
    orderedStories.map((story) => story.storyId),
    ["story-2", "story-10"]
  );
  assert.deepEqual(
    orderedStories.map((story) => story.storyOrder),
    [2, 10]
  );
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
  assert.equal(DEFAULT_AUTOMATION_RULES.stopConditions.stopOnEpicBlocked, true);
  assert.equal(DEFAULT_AUTOMATION_RULES.stopConditions.stopOnEpicCancelled, true);
  assert.equal(DEFAULT_AUTOMATION_RULES.stopConditions.stopOnFeatureFailure, true);
  assert.equal(DEFAULT_AUTOMATION_RULES.stopConditions.stopOnFeatureBlocked, true);
  assert.equal(DEFAULT_AUTOMATION_RULES.stopConditions.stopOnFeatureCancelled, true);
});

test("createAutomationRules merges recognized stop-condition overrides", () => {
  const rules = createAutomationRules({
    ordering: {
      levels: [AUTOMATION_SCOPE.STORY],
      strategy: "custom"
    },
    stopConditions: {
      stopOnStoryFailure: false,
      stopOnEpicCancelled: false,
      stopOnUnknownCondition: false
    }
  });

  assert.equal(rules.stopConditions.stopOnStoryFailure, false);
  assert.equal(rules.stopConditions.stopOnEpicCancelled, false);
  assert.equal(rules.stopConditions.stopOnStoryBlocked, true);
  assert.equal(rules.stopConditions.stopOnFeatureFailure, true);
  assert.equal(rules.stopConditions.stopOnUnknownCondition, undefined);
  assert.deepEqual(rules.ordering.levels, [
    AUTOMATION_SCOPE.FEATURE,
    AUTOMATION_SCOPE.EPIC,
    AUTOMATION_SCOPE.STORY
  ]);
  assert.equal(rules.ordering.strategy, "order-asc-stable");
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

  assert.deepEqual(
    evaluateAutomationStopCondition({
      entityType: AUTOMATION_SCOPE.EPIC,
      outcome: AUTOMATION_OUTCOME.BLOCKED
    }),
    {
      shouldStop: true,
      entityType: AUTOMATION_SCOPE.EPIC,
      outcome: AUTOMATION_OUTCOME.BLOCKED,
      reason: "epic.blocked"
    }
  );

  assert.deepEqual(
    evaluateAutomationStopCondition(
      {
        entityType: AUTOMATION_SCOPE.FEATURE,
        outcome: AUTOMATION_OUTCOME.CANCELLED
      },
      {
        stopConditions: {
          stopOnFeatureCancelled: false
        }
      }
    ),
    {
      shouldStop: false,
      entityType: AUTOMATION_SCOPE.FEATURE,
      outcome: AUTOMATION_OUTCOME.CANCELLED,
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
