function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

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

module.exports = {
  flattenStoryExecutionQueues,
  generateStoryExecutionQueues,
  withStableOrdering
};
