const test = require("node:test");
const assert = require("node:assert/strict");

const {
  QUEUE_BUILD_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_STOP_REASON,
  DEFAULT_AUTOMATION_RULES,
  buildScopedStoryExecutionQueue,
  createAutomationRules,
  defineAutomationExecutionPlan,
  evaluateAutomationStopCondition,
  normalizeCompletionStatus,
  withStableCreationOrdering
} = require("./automationQueue");

const FEATURES_FIXTURE = [
  {
    id: 2,
    name: "Feature 2",
    created_at: "2026-01-02T09:00:00.000Z",
    epics: [
      {
        id: 22,
        name: "Epic 2.2",
        created_at: "2026-01-02T09:05:00.000Z",
        stories: [
          {
            id: 221,
            name: "Story 2.2.1",
            created_at: "2026-01-02T09:06:00.000Z",
            completion_status: "complete"
          }
        ]
      }
    ]
  },
  {
    id: 1,
    name: "Feature 1",
    created_at: "2026-01-01T09:00:00.000Z",
    epics: [
      {
        id: 12,
        name: "Epic 1.2",
        created_at: "2026-01-01T09:10:00.000Z",
        stories: [
          {
            id: 121,
            name: "Story 1.2.1",
            created_at: "2026-01-01T09:11:00.000Z",
            completion_status: "complete"
          }
        ]
      },
      {
        id: 11,
        name: "Epic 1.1",
        created_at: "2026-01-01T09:05:00.000Z",
        stories: [
          {
            id: 112,
            name: "Story 1.1.2",
            created_at: "2026-01-01T09:07:00.000Z",
            completion_status: "complete"
          },
          {
            id: 111,
            name: "Story 1.1.1",
            description: "Implement queue ordering helper.",
            created_at: "2026-01-01T09:06:00.000Z",
            completion_status: "complete"
          }
        ]
      }
    ]
  }
];

test("withStableCreationOrdering sorts by created_at then id", () => {
  const result = withStableCreationOrdering([
    { id: 2, created_at: "2026-01-01T10:00:00.000Z" },
    { id: 1, created_at: "2026-01-01T10:00:00.000Z" },
    { id: 3, created_at: "2026-01-01T09:00:00.000Z" }
  ]);

  assert.deepEqual(result.map((item) => item.id), [3, 1, 2]);
});

test("feature automation queues all stories in feature epic/story creation order", () => {
  const plan = defineAutomationExecutionPlan(
    FEATURES_FIXTURE,
    {
      automationType: AUTOMATION_SCOPE.FEATURE,
      targetId: 1
    }
  );

  assert.equal(plan.automationType, AUTOMATION_SCOPE.FEATURE);
  assert.equal(plan.stories.length, 3);
  assert.deepEqual(
    plan.stories.map((story) => story.storyId),
    [111, 112, 121]
  );
  assert.deepEqual(
    plan.stories.map((story) => story.positionInQueue),
    [1, 2, 3]
  );
  assert.equal(plan.queueStatus?.isValid, true);
  assert.equal(plan.queueStatus?.code, QUEUE_BUILD_STATUS.READY);
});

test("epic automation queues only selected epic stories in story creation order", () => {
  const plan = defineAutomationExecutionPlan(
    FEATURES_FIXTURE,
    {
      automationType: AUTOMATION_SCOPE.EPIC,
      targetId: 11
    }
  );

  assert.equal(plan.automationType, AUTOMATION_SCOPE.EPIC);
  assert.equal(plan.queues.length, 1);
  assert.equal(plan.queues[0].epicId, 11);
  assert.deepEqual(
    plan.stories.map((story) => story.storyId),
    [111, 112]
  );
});

test("story automation queues only the selected story", () => {
  const plan = defineAutomationExecutionPlan(
    FEATURES_FIXTURE,
    {
      automationType: AUTOMATION_SCOPE.STORY,
      targetId: 121
    }
  );

  assert.equal(plan.automationType, AUTOMATION_SCOPE.STORY);
  assert.equal(plan.stories.length, 1);
  assert.equal(plan.stories[0].storyId, 121);
  assert.equal(plan.stories[0].positionInQueue, 1);
  assert.equal(plan.stories[0].automationType, AUTOMATION_SCOPE.STORY);
  assert.equal(plan.stories[0].targetId, "121");
});

test("queue items include execution and status metadata needed for reporting", () => {
  const queueResult = buildScopedStoryExecutionQueue(
    FEATURES_FIXTURE,
    {
      automationType: AUTOMATION_SCOPE.EPIC,
      targetId: 11
    }
  );

  const firstStory = queueResult.stories[0];
  assert.equal(firstStory.automationType, AUTOMATION_SCOPE.EPIC);
  assert.equal(firstStory.targetId, "11");
  assert.equal(firstStory.featureId, 1);
  assert.equal(firstStory.epicId, 11);
  assert.equal(firstStory.storyId, 111);
  assert.equal(firstStory.storyDescription, "Implement queue ordering helper.");
  assert.equal(typeof firstStory.storyCreatedAt, "string");
  assert.equal(firstStory.completionStatus, "complete");
});

test("buildScopedStoryExecutionQueue surfaces target-not-found cleanly", () => {
  const queueResult = buildScopedStoryExecutionQueue(
    FEATURES_FIXTURE,
    {
      automationType: AUTOMATION_SCOPE.EPIC,
      targetId: 999
    }
  );

  assert.deepEqual(queueResult.queues, []);
  assert.deepEqual(queueResult.stories, []);
  assert.deepEqual(queueResult.queueStatus, {
    isValid: false,
    code: QUEUE_BUILD_STATUS.TARGET_NOT_FOUND,
    message: "No epic found for target '999'."
  });
});

test("buildScopedStoryExecutionQueue surfaces empty queue when scope has no stories", () => {
  const featuresWithEmptyEpic = [
    {
      id: 1,
      name: "Feature 1",
      created_at: "2026-01-01T09:00:00.000Z",
      epics: [
        {
          id: 11,
          name: "Epic 1.1",
          created_at: "2026-01-01T09:05:00.000Z",
          stories: []
        }
      ]
    }
  ];

  const queueResult = buildScopedStoryExecutionQueue(
    featuresWithEmptyEpic,
    {
      automationType: AUTOMATION_SCOPE.EPIC,
      targetId: 11
    }
  );

  assert.deepEqual(queueResult.queues, []);
  assert.deepEqual(queueResult.stories, []);
  assert.deepEqual(queueResult.queueStatus, {
    isValid: false,
    code: QUEUE_BUILD_STATUS.EMPTY_QUEUE,
    message: "No runnable stories found for epic '11'."
  });
});

test("default automation rules define explicit scope and stop-rule contract", () => {
  assert.equal(DEFAULT_AUTOMATION_RULES.ordering.strategy, "original-creation-asc-stable");
  assert.deepEqual(DEFAULT_AUTOMATION_RULES.scopes.feature.traversal, [
    AUTOMATION_SCOPE.EPIC,
    AUTOMATION_SCOPE.STORY
  ]);
  assert.deepEqual(DEFAULT_AUTOMATION_RULES.scopes.epic.traversal, [
    AUTOMATION_SCOPE.STORY
  ]);
  assert.deepEqual(DEFAULT_AUTOMATION_RULES.scopes.story.traversal, [
    AUTOMATION_SCOPE.STORY
  ]);
  assert.equal(DEFAULT_AUTOMATION_RULES.stopConditions.stopOnExecutionFailure, true);
  assert.equal(DEFAULT_AUTOMATION_RULES.stopConditions.stopOnManualStop, true);
  assert.equal(DEFAULT_AUTOMATION_RULES.stopConditions.stopOnIncompleteStory, false);
});

test("createAutomationRules only merges recognized stop condition overrides", () => {
  const rules = createAutomationRules({
    stopConditions: {
      stopOnIncompleteStory: true,
      stopOnExecutionFailure: false,
      stopOnUnknownCondition: true
    }
  });

  assert.equal(rules.stopConditions.stopOnIncompleteStory, true);
  assert.equal(rules.stopConditions.stopOnExecutionFailure, false);
  assert.equal(rules.stopConditions.stopOnManualStop, true);
  assert.equal(rules.stopConditions.stopOnUnknownCondition, undefined);
});

test("evaluateAutomationStopCondition handles completion, execution failure, and manual stop", () => {
  assert.deepEqual(
    evaluateAutomationStopCondition({ type: "queue_complete" }),
    {
      shouldStop: true,
      reason: AUTOMATION_STOP_REASON.ALL_WORK_COMPLETE
    }
  );

  assert.deepEqual(
    evaluateAutomationStopCondition({ type: "execution_failed" }),
    {
      shouldStop: true,
      reason: AUTOMATION_STOP_REASON.EXECUTION_FAILED
    }
  );

  assert.deepEqual(
    evaluateAutomationStopCondition({ type: "manual_stop" }),
    {
      shouldStop: true,
      reason: AUTOMATION_STOP_REASON.MANUAL_STOP
    }
  );
});

test("evaluateAutomationStopCondition enforces stop-on-incomplete rule only when enabled", () => {
  assert.deepEqual(
    evaluateAutomationStopCondition(
      {
        type: "story_completed",
        completionStatus: "incomplete"
      },
      {
        stopConditions: {
          stopOnIncompleteStory: true
        }
      }
    ),
    {
      shouldStop: true,
      reason: AUTOMATION_STOP_REASON.STORY_INCOMPLETE,
      completionStatus: "incomplete"
    }
  );

  assert.deepEqual(
    evaluateAutomationStopCondition(
      {
        type: "story_completed",
        completionStatus: "incomplete"
      },
      {
        stopConditions: {
          stopOnIncompleteStory: false
        }
      }
    ),
    {
      shouldStop: false,
      reason: null,
      completionStatus: "incomplete"
    }
  );

  assert.deepEqual(
    evaluateAutomationStopCondition(
      {
        type: "story_completed",
        completionStatus: "unknown"
      },
      {
        stopConditions: {
          stopOnIncompleteStory: true
        }
      }
    ),
    {
      shouldStop: true,
      reason: AUTOMATION_STOP_REASON.STORY_INCOMPLETE,
      completionStatus: "unknown"
    }
  );
});

test("normalizeCompletionStatus prefers explicit COMPLETION_STATUS field", () => {
  assert.equal(normalizeCompletionStatus({ COMPLETION_STATUS: "complete" }), "complete");
  assert.equal(normalizeCompletionStatus({ completion_status: "incomplete" }), "incomplete");
  assert.equal(normalizeCompletionStatus({ is_complete: 1 }), "complete");
  assert.equal(normalizeCompletionStatus({ is_complete: 0 }), "incomplete");
  assert.equal(normalizeCompletionStatus({}), "unknown");
});

test("defineAutomationExecutionPlan validates selection", () => {
  assert.throws(
    () => defineAutomationExecutionPlan(FEATURES_FIXTURE, null),
    /selection.automationType is required/
  );

  assert.throws(
    () => defineAutomationExecutionPlan(FEATURES_FIXTURE, { automationType: "feature" }),
    /selection.targetId is required/
  );

  assert.throws(
    () => defineAutomationExecutionPlan(FEATURES_FIXTURE, { automationType: "team", targetId: 1 }),
    /automationType must be feature, epic, or story/
  );
});
