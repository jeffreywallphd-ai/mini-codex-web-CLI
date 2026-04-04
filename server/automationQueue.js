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

const AUTOMATION_STOP_REASON = Object.freeze({
  ALL_WORK_COMPLETE: "all_work_complete",
  EXECUTION_FAILED: "execution_failed",
  MANUAL_STOP: "manual_stop",
  STORY_INCOMPLETE: "story_incomplete"
});

const QUEUE_BUILD_STATUS = Object.freeze({
  READY: "ready",
  TARGET_NOT_FOUND: "target_not_found",
  EMPTY_QUEUE: "empty_queue"
});

const DEFAULT_AUTOMATION_RULES = Object.freeze({
  ordering: {
    strategy: "original-creation-asc-stable",
    keys: ["created_at", "id", "order"]
  },
  scopes: {
    [AUTOMATION_SCOPE.FEATURE]: {
      includes: "all stories in all epics for the selected feature",
      traversal: [AUTOMATION_SCOPE.EPIC, AUTOMATION_SCOPE.STORY]
    },
    [AUTOMATION_SCOPE.EPIC]: {
      includes: "all stories for the selected epic",
      traversal: [AUTOMATION_SCOPE.STORY]
    },
    [AUTOMATION_SCOPE.STORY]: {
      includes: "only the selected story",
      traversal: [AUTOMATION_SCOPE.STORY]
    }
  },
  stopConditions: {
    stopOnExecutionFailure: true,
    stopOnManualStop: true,
    stopOnIncompleteStory: false,
    stopOnStoryFailure: true,
    stopOnStoryBlocked: true,
    stopOnStoryCancelled: true,
    stopOnEpicFailure: true,
    stopOnEpicBlocked: true,
    stopOnEpicCancelled: true,
    stopOnFeatureFailure: true,
    stopOnFeatureBlocked: true,
    stopOnFeatureCancelled: true
  }
});

const STOP_CONDITION_KEYS = Object.freeze(
  Object.keys(DEFAULT_AUTOMATION_RULES.stopConditions)
);

function normalizeTargetId(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function toOrderKey(value) {
  if (Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }

  return Number.MAX_SAFE_INTEGER;
}

function toTimestampKey(value) {
  if (typeof value !== "string") {
    return Number.MAX_SAFE_INTEGER;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function toIdKey(value) {
  if (Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }

  return Number.MAX_SAFE_INTEGER;
}

function withStableCreationOrdering(items) {
  return items
    .map((item, index) => ({
      item,
      index,
      createdAt: toTimestampKey(item?.created_at),
      id: toIdKey(item?.id),
      order: toOrderKey(item?.order)
    }))
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt;
      }

      if (a.id !== b.id) {
        return a.id - b.id;
      }

      if (a.order !== b.order) {
        return a.order - b.order;
      }

      return a.index - b.index;
    })
    .map((entry) => entry.item);
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

function getLabel(entity) {
  return String(entity?.title ?? entity?.name ?? "");
}

function normalizeCompletionStatus(story = {}) {
  const rawStatus = story?.COMPLETION_STATUS
    ?? story?.completion_status
    ?? story?.run_completion_status
    ?? null;

  if (rawStatus === "complete") {
    return "complete";
  }

  if (rawStatus === "incomplete") {
    return "incomplete";
  }

  if (story?.is_complete === true || story?.is_complete === 1) {
    return "complete";
  }

  if (story?.is_complete === false || story?.is_complete === 0) {
    return "incomplete";
  }

  return "unknown";
}

function createQueueBuildStatus({ code, automationType, targetId }) {
  if (code === QUEUE_BUILD_STATUS.READY) {
    return {
      isValid: true,
      code,
      message: "Queue is ready."
    };
  }

  if (code === QUEUE_BUILD_STATUS.TARGET_NOT_FOUND) {
    return {
      isValid: false,
      code,
      message: `No ${automationType} found for target '${targetId}'.`
    };
  }

  return {
    isValid: false,
    code: QUEUE_BUILD_STATUS.EMPTY_QUEUE,
    message: `No runnable stories found for ${automationType} '${targetId}'.`
  };
}

function createQueueStory(feature, epic, story, positionInQueue, scope = {}) {
  const storyOrder = toOrderKey(story?.order);

  return {
    positionInQueue,
    automationType: scope.automationType ?? null,
    targetId: scope.targetId ?? null,
    featureId: feature?.id ?? null,
    featureTitle: getLabel(feature),
    epicId: epic?.id ?? null,
    epicTitle: getLabel(epic),
    storyId: story?.id ?? null,
    storyTitle: getLabel(story),
    storyDescription: String(story?.description ?? ""),
    storyCreatedAt: story?.created_at ?? null,
    completionStatus: normalizeCompletionStatus(story),
    storyOrder: storyOrder === Number.MAX_SAFE_INTEGER ? null : storyOrder
  };
}

function findFeatureById(features, targetId) {
  return features.find((feature) => normalizeTargetId(feature?.id) === targetId) || null;
}

function findEpicContextById(features, targetId) {
  for (const feature of features) {
    const epics = withStableCreationOrdering(normalizeList(feature?.epics));
    const epic = epics.find((candidate) => normalizeTargetId(candidate?.id) === targetId);
    if (epic) {
      return { feature, epic };
    }
  }

  return null;
}

function findStoryContextById(features, targetId) {
  for (const feature of features) {
    const epics = withStableCreationOrdering(normalizeList(feature?.epics));
    for (const epic of epics) {
      const stories = withStableCreationOrdering(normalizeList(epic?.stories));
      const story = stories.find((candidate) => normalizeTargetId(candidate?.id) === targetId);
      if (story) {
        return { feature, epic, story };
      }
    }
  }

  return null;
}

function toScopeDefinition(automationType) {
  const definition = DEFAULT_AUTOMATION_RULES.scopes[automationType];
  if (!definition) {
    throw new TypeError("automationType must be feature, epic, or story");
  }

  return {
    automationType,
    ...definition
  };
}

function createAutomationRules(overrides = {}) {
  const normalizedOverrides = overrides && typeof overrides === "object" ? overrides : {};
  const rawStopOverrides = normalizedOverrides.stopConditions;
  const normalizedStopOverrides = {};

  if (rawStopOverrides && typeof rawStopOverrides === "object") {
    for (const key of STOP_CONDITION_KEYS) {
      if (Object.prototype.hasOwnProperty.call(rawStopOverrides, key)) {
        normalizedStopOverrides[key] = Boolean(rawStopOverrides[key]);
      }
    }
  }

  return {
    ordering: {
      strategy: DEFAULT_AUTOMATION_RULES.ordering.strategy,
      keys: [...DEFAULT_AUTOMATION_RULES.ordering.keys]
    },
    scopes: {
      ...DEFAULT_AUTOMATION_RULES.scopes
    },
    stopConditions: {
      ...DEFAULT_AUTOMATION_RULES.stopConditions,
      ...normalizedStopOverrides
    }
  };
}

function generateStoryExecutionQueues(features) {
  if (!Array.isArray(features)) {
    throw new TypeError("features must be an array");
  }

  const orderedFeatures = withStableCreationOrdering(features);
  const queues = [];
  let globalPosition = 1;

  for (const feature of orderedFeatures) {
    const epics = withStableCreationOrdering(normalizeList(feature?.epics));

    for (const epic of epics) {
      const stories = withStableCreationOrdering(normalizeList(epic?.stories));
      const queuedStories = stories.map((story) => {
        const queueStory = createQueueStory(feature, epic, story, globalPosition);
        globalPosition += 1;
        return queueStory;
      });

      if (queuedStories.length === 0) {
        continue;
      }

      queues.push({
        featureId: feature?.id ?? null,
        featureTitle: getLabel(feature),
        epicId: epic?.id ?? null,
        epicTitle: getLabel(epic),
        stories: queuedStories
      });
    }
  }

  return queues;
}

function buildScopedStoryExecutionQueue(features, selection) {
  if (!Array.isArray(features)) {
    throw new TypeError("features must be an array");
  }

  const automationType = String(selection?.automationType || "").trim().toLowerCase();
  const targetId = normalizeTargetId(selection?.targetId);
  const scope = { automationType, targetId };

  if (!automationType) {
    throw new TypeError("selection.automationType is required");
  }

  if (!targetId) {
    throw new TypeError("selection.targetId is required");
  }

  toScopeDefinition(automationType);

  const orderedFeatures = withStableCreationOrdering(features);
  const queues = [];
  let globalPosition = 1;
  let targetFound = true;

  if (automationType === AUTOMATION_SCOPE.FEATURE) {
    const feature = findFeatureById(orderedFeatures, targetId);

    if (!feature) {
      targetFound = false;
      return {
        queues,
        stories: [],
        queueStatus: createQueueBuildStatus({ code: QUEUE_BUILD_STATUS.TARGET_NOT_FOUND, automationType, targetId })
      };
    }

    const epics = withStableCreationOrdering(normalizeList(feature?.epics));
    for (const epic of epics) {
      const stories = withStableCreationOrdering(normalizeList(epic?.stories));
      const queuedStories = stories.map((story) => {
        const queueStory = createQueueStory(feature, epic, story, globalPosition, scope);
        globalPosition += 1;
        return queueStory;
      });

      if (queuedStories.length === 0) {
        continue;
      }

      queues.push({
        featureId: feature?.id ?? null,
        featureTitle: getLabel(feature),
        epicId: epic?.id ?? null,
        epicTitle: getLabel(epic),
        stories: queuedStories
      });
    }
  }

  if (automationType === AUTOMATION_SCOPE.EPIC) {
    const context = findEpicContextById(orderedFeatures, targetId);

    if (!context) {
      targetFound = false;
      return {
        queues,
        stories: [],
        queueStatus: createQueueBuildStatus({ code: QUEUE_BUILD_STATUS.TARGET_NOT_FOUND, automationType, targetId })
      };
    }

    const stories = withStableCreationOrdering(normalizeList(context.epic?.stories));
    const queuedStories = stories.map((story) => {
      const queueStory = createQueueStory(context.feature, context.epic, story, globalPosition, scope);
      globalPosition += 1;
      return queueStory;
    });

    if (queuedStories.length > 0) {
      queues.push({
        featureId: context.feature?.id ?? null,
        featureTitle: getLabel(context.feature),
        epicId: context.epic?.id ?? null,
        epicTitle: getLabel(context.epic),
        stories: queuedStories
      });
    }
  }

  if (automationType === AUTOMATION_SCOPE.STORY) {
    const context = findStoryContextById(orderedFeatures, targetId);

    if (!context) {
      targetFound = false;
      return {
        queues,
        stories: [],
        queueStatus: createQueueBuildStatus({ code: QUEUE_BUILD_STATUS.TARGET_NOT_FOUND, automationType, targetId })
      };
    }

    queues.push({
      featureId: context.feature?.id ?? null,
      featureTitle: getLabel(context.feature),
      epicId: context.epic?.id ?? null,
      epicTitle: getLabel(context.epic),
      stories: [createQueueStory(context.feature, context.epic, context.story, globalPosition, scope)]
    });
  }

  const stories = flattenStoryExecutionQueues(queues);
  const queueStatus = stories.length > 0 && targetFound
    ? createQueueBuildStatus({ code: QUEUE_BUILD_STATUS.READY, automationType, targetId })
    : createQueueBuildStatus({
      code: targetFound ? QUEUE_BUILD_STATUS.EMPTY_QUEUE : QUEUE_BUILD_STATUS.TARGET_NOT_FOUND,
      automationType,
      targetId
    });

  return {
    queues,
    stories,
    queueStatus
  };
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

function evaluateAutomationStopCondition(event, rules = DEFAULT_AUTOMATION_RULES) {
  if (!event || typeof event !== "object") {
    throw new TypeError("event must be an object");
  }

  const stopRules = createAutomationRules(rules).stopConditions;
  const entityType = String(event.entityType || "").toLowerCase();
  const outcome = String(event.outcome || "").toLowerCase();
  const eventType = String(event.type || "").trim().toLowerCase();

  if (!eventType && entityType && outcome) {
    if (!Object.values(AUTOMATION_SCOPE).includes(entityType)) {
      throw new TypeError("event.entityType must be feature, epic, or story");
    }

    if (!Object.values(AUTOMATION_OUTCOME).includes(outcome)) {
      throw new TypeError("event.outcome must be success, failed, blocked, or cancelled");
    }

    if (outcome === AUTOMATION_OUTCOME.SUCCESS) {
      return {
        shouldStop: false,
        entityType,
        outcome,
        reason: null
      };
    }

    const legacyRuleMap = {
      [`${AUTOMATION_SCOPE.STORY}.${AUTOMATION_OUTCOME.FAILED}`]: "stopOnStoryFailure",
      [`${AUTOMATION_SCOPE.STORY}.${AUTOMATION_OUTCOME.BLOCKED}`]: "stopOnStoryBlocked",
      [`${AUTOMATION_SCOPE.STORY}.${AUTOMATION_OUTCOME.CANCELLED}`]: "stopOnStoryCancelled",
      [`${AUTOMATION_SCOPE.EPIC}.${AUTOMATION_OUTCOME.FAILED}`]: "stopOnEpicFailure",
      [`${AUTOMATION_SCOPE.EPIC}.${AUTOMATION_OUTCOME.BLOCKED}`]: "stopOnEpicBlocked",
      [`${AUTOMATION_SCOPE.EPIC}.${AUTOMATION_OUTCOME.CANCELLED}`]: "stopOnEpicCancelled",
      [`${AUTOMATION_SCOPE.FEATURE}.${AUTOMATION_OUTCOME.FAILED}`]: "stopOnFeatureFailure",
      [`${AUTOMATION_SCOPE.FEATURE}.${AUTOMATION_OUTCOME.BLOCKED}`]: "stopOnFeatureBlocked",
      [`${AUTOMATION_SCOPE.FEATURE}.${AUTOMATION_OUTCOME.CANCELLED}`]: "stopOnFeatureCancelled"
    };

    const ruleKey = legacyRuleMap[`${entityType}.${outcome}`];
    const shouldStop = ruleKey ? Boolean(stopRules[ruleKey]) : false;

    return {
      shouldStop,
      entityType,
      outcome,
      reason: shouldStop ? `${entityType}.${outcome}` : null
    };
  }

  if (!eventType) {
    throw new TypeError("event.type is required");
  }

  if (eventType === "queue_complete") {
    return {
      shouldStop: true,
      reason: AUTOMATION_STOP_REASON.ALL_WORK_COMPLETE
    };
  }

  if (eventType === "execution_failed") {
    return {
      shouldStop: Boolean(stopRules.stopOnExecutionFailure),
      reason: stopRules.stopOnExecutionFailure ? AUTOMATION_STOP_REASON.EXECUTION_FAILED : null
    };
  }

  if (eventType === "manual_stop") {
    return {
      shouldStop: Boolean(stopRules.stopOnManualStop),
      reason: stopRules.stopOnManualStop ? AUTOMATION_STOP_REASON.MANUAL_STOP : null
    };
  }

  if (eventType === "story_completed") {
    const completionStatus = normalizeCompletionStatus({
      completion_status: event.completionStatus,
      COMPLETION_STATUS: event.COMPLETION_STATUS,
      is_complete: event.isComplete
    });
    const shouldStop = stopRules.stopOnIncompleteStory && completionStatus !== "complete";

    return {
      shouldStop,
      reason: shouldStop ? AUTOMATION_STOP_REASON.STORY_INCOMPLETE : null,
      completionStatus
    };
  }

  throw new TypeError("event.type must be queue_complete, execution_failed, manual_stop, or story_completed");
}

function defineAutomationExecutionPlan(features, selection, overrides = {}) {
  const legacyStyleSelection = selection && typeof selection === "object"
    && !Object.prototype.hasOwnProperty.call(selection, "automationType")
    && (Object.prototype.hasOwnProperty.call(selection, "stopConditions")
      || Object.prototype.hasOwnProperty.call(selection, "ordering"));

  if (legacyStyleSelection) {
    const rules = createAutomationRules(selection);
    const queues = generateStoryExecutionQueues(features);
    return {
      scope: [AUTOMATION_SCOPE.FEATURE, AUTOMATION_SCOPE.EPIC, AUTOMATION_SCOPE.STORY],
      rules,
      queues,
      stories: flattenStoryExecutionQueues(queues)
    };
  }

  const rules = createAutomationRules(overrides);
  const normalizedSelection = selection && typeof selection === "object" ? selection : {};
  const automationType = String(normalizedSelection.automationType || "").trim().toLowerCase();
  const targetId = normalizeTargetId(normalizedSelection.targetId);

  if (!automationType) {
    throw new TypeError("selection.automationType is required");
  }

  if (!targetId) {
    throw new TypeError("selection.targetId is required");
  }

  const scope = toScopeDefinition(automationType);
  const queueResult = buildScopedStoryExecutionQueue(features, { automationType, targetId });

  return {
    automationType,
    targetId,
    scope,
    rules,
    queues: queueResult.queues,
    stories: queueResult.stories,
    queueStatus: queueResult.queueStatus
  };
}

module.exports = {
  AUTOMATION_OUTCOME,
  AUTOMATION_SCOPE,
  AUTOMATION_STOP_REASON,
  DEFAULT_AUTOMATION_RULES,
  QUEUE_BUILD_STATUS,
  buildScopedStoryExecutionQueue,
  createAutomationRules,
  defineAutomationExecutionPlan,
  evaluateAutomationStopCondition,
  flattenStoryExecutionQueues,
  generateStoryExecutionQueues,
  normalizeCompletionStatus,
  withStableCreationOrdering,
  withStableOrdering
};
