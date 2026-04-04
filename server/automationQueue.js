function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

const AUTOMATION_SCOPE = Object.freeze({
  FEATURE: "feature",
  EPIC: "epic",
  STORY: "story"
});

const AUTOMATION_OUTCOME = Object.freeze({
  SUCCESS: "success",
  FAILED: "failed",
  BLOCKED: "blocked",
  CANCELLED: "cancelled"
});

const DEFAULT_AUTOMATION_RULES = Object.freeze({
  ordering: {
    levels: [AUTOMATION_SCOPE.FEATURE, AUTOMATION_SCOPE.EPIC, AUTOMATION_SCOPE.STORY],
    strategy: "order-asc-stable"
  },
  stopConditions: {
    stopOnStoryFailure: true,
    stopOnStoryBlocked: true,
    stopOnStoryCancelled: true,
    stopOnEpicFailure: true,
    stopOnFeatureFailure: true
  }
});

function toOrderKey(value) {
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function withStableOrdering(items, getOrder) {
  return items
    .map((item, index) => ({
      item,
      index,
      order: toOrderKey(getOrder(item))
    }))
    .sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }

      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

function createQueueStory(feature, epic, story, positionInQueue) {
  return {
    positionInQueue,
    featureId: feature.id ?? null,
    featureTitle: feature.title ?? "",
    epicId: epic.id ?? null,
    epicTitle: epic.title ?? "",
    storyId: story.id ?? null,
    storyTitle: story.title ?? "",
    storyOrder: Number.isFinite(story.order) ? story.order : null
  };
}

function generateStoryExecutionQueues(features) {
  if (!Array.isArray(features)) {
    throw new TypeError("features must be an array");
  }

  const orderedFeatures = withStableOrdering(features, (feature) => feature?.order);
  const queues = [];
  let globalPosition = 1;

  for (const feature of orderedFeatures) {
    const epics = withStableOrdering(normalizeList(feature?.epics), (epic) => epic?.order);

    for (const epic of epics) {
      const stories = withStableOrdering(normalizeList(epic?.stories), (story) => story?.order);
      const queuedStories = stories.map((story) => {
        const queueStory = createQueueStory(feature, epic, story, globalPosition);
        globalPosition += 1;
        return queueStory;
      });

      if (queuedStories.length === 0) {
        continue;
      }

      queues.push({
        featureId: feature.id ?? null,
        featureTitle: feature.title ?? "",
        epicId: epic.id ?? null,
        epicTitle: epic.title ?? "",
        stories: queuedStories
      });
    }
  }

  return queues;
}

function flattenStoryExecutionQueues(queues) {
  if (!Array.isArray(queues)) {
    throw new TypeError("queues must be an array");
  }

  const stories = [];

  for (const queue of queues) {
    const queueStories = normalizeList(queue?.stories);

    for (const story of queueStories) {
      stories.push(story);
    }
  }

  return stories;
}

function createAutomationRules(overrides = {}) {
  const normalizedOverrides = overrides && typeof overrides === "object" ? overrides : {};

  return {
    ordering: {
      levels: [...DEFAULT_AUTOMATION_RULES.ordering.levels],
      strategy: DEFAULT_AUTOMATION_RULES.ordering.strategy,
      ...(normalizedOverrides.ordering || {})
    },
    stopConditions: {
      ...DEFAULT_AUTOMATION_RULES.stopConditions,
      ...(normalizedOverrides.stopConditions || {})
    }
  };
}

function evaluateAutomationStopCondition(event, rules = DEFAULT_AUTOMATION_RULES) {
  if (!event || typeof event !== "object") {
    throw new TypeError("event must be an object");
  }

  const entityType = String(event.entityType || "").toLowerCase();
  const outcome = String(event.outcome || "").toLowerCase();

  if (!Object.values(AUTOMATION_SCOPE).includes(entityType)) {
    throw new TypeError("event.entityType must be feature, epic, or story");
  }

  if (!Object.values(AUTOMATION_OUTCOME).includes(outcome)) {
    throw new TypeError("event.outcome must be success, failed, blocked, or cancelled");
  }

  const stopRules = createAutomationRules(rules).stopConditions;

  let shouldStop = false;
  if (entityType === AUTOMATION_SCOPE.STORY && outcome === AUTOMATION_OUTCOME.FAILED) {
    shouldStop = Boolean(stopRules.stopOnStoryFailure);
  } else if (entityType === AUTOMATION_SCOPE.STORY && outcome === AUTOMATION_OUTCOME.BLOCKED) {
    shouldStop = Boolean(stopRules.stopOnStoryBlocked);
  } else if (entityType === AUTOMATION_SCOPE.STORY && outcome === AUTOMATION_OUTCOME.CANCELLED) {
    shouldStop = Boolean(stopRules.stopOnStoryCancelled);
  } else if (entityType === AUTOMATION_SCOPE.EPIC && outcome === AUTOMATION_OUTCOME.FAILED) {
    shouldStop = Boolean(stopRules.stopOnEpicFailure);
  } else if (entityType === AUTOMATION_SCOPE.FEATURE && outcome === AUTOMATION_OUTCOME.FAILED) {
    shouldStop = Boolean(stopRules.stopOnFeatureFailure);
  }

  return {
    shouldStop,
    entityType,
    outcome,
    reason: shouldStop ? `${entityType}.${outcome}` : null
  };
}

function defineAutomationExecutionPlan(features, overrides = {}) {
  const rules = createAutomationRules(overrides);
  const queues = generateStoryExecutionQueues(features);

  return {
    scope: [...rules.ordering.levels],
    rules,
    queues,
    stories: flattenStoryExecutionQueues(queues)
  };
}

module.exports = {
  AUTOMATION_OUTCOME,
  AUTOMATION_SCOPE,
  DEFAULT_AUTOMATION_RULES,
  createAutomationRules,
  defineAutomationExecutionPlan,
  evaluateAutomationStopCondition,
  flattenStoryExecutionQueues,
  generateStoryExecutionQueues,
  withStableOrdering
};
