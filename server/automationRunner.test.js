const test = require("node:test");
const assert = require("node:assert/strict");

const { AUTOMATION_STOP_REASON } = require("./automationQueue");
const { runSequentialStoryQueue } = require("./automationRunner");

test("runner executes queued stories one at a time in queue order", async () => {
  const stories = [
    { storyId: 101, positionInQueue: 1 },
    { storyId: 102, positionInQueue: 2 },
    { storyId: 103, positionInQueue: 3 }
  ];

  const callOrder = [];
  let activeRuns = 0;
  let maxConcurrentRuns = 0;

  const result = await runSequentialStoryQueue({
    stories,
    executeStory: async (story) => {
      activeRuns += 1;
      maxConcurrentRuns = Math.max(maxConcurrentRuns, activeRuns);
      callOrder.push(story.storyId);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeRuns -= 1;

      return {
        runId: story.storyId * 10,
        completionStatus: "complete"
      };
    }
  });

  assert.deepEqual(callOrder, [101, 102, 103]);
  assert.equal(maxConcurrentRuns, 1);
  assert.equal(result.status, "completed");
  assert.equal(result.stopReason, AUTOMATION_STOP_REASON.ALL_WORK_COMPLETE);
  assert.equal(result.processedStories, 3);
  assert.deepEqual(
    result.storyResults.map((storyResult) => storyResult.queueAction),
    ["advanced", "advanced", "advanced"]
  );
});

test("runner executes stories by normalized queue position regardless of input array order", async () => {
  const stories = [
    { storyId: 703, positionInQueue: 3 },
    { storyId: 701, positionInQueue: 1 },
    { storyId: 702, positionInQueue: 2 }
  ];
  const executionOrder = [];

  const result = await runSequentialStoryQueue({
    stories,
    executeStory: async (story) => {
      executionOrder.push(story.storyId);
      return { runId: story.storyId * 10, completionStatus: "complete" };
    }
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(executionOrder, [701, 702, 703]);
  assert.deepEqual(
    result.storyResults.map((storyResult) => storyResult.positionInQueue),
    [1, 2, 3]
  );
});

test("runner advances only after current story execution resolves", async () => {
  const stories = [
    { storyId: 201, positionInQueue: 1 },
    { storyId: 202, positionInQueue: 2 }
  ];
  const events = [];
  let allowFirstStoryToFinish;

  const firstStoryFinished = new Promise((resolve) => {
    allowFirstStoryToFinish = resolve;
  });

  const promise = runSequentialStoryQueue({
    stories,
    executeStory: async (story) => {
      events.push(`start:${story.storyId}`);
      if (story.storyId === 201) {
        await firstStoryFinished;
      }
      events.push(`finish:${story.storyId}`);
      return { runId: story.storyId * 10, completionStatus: "complete" };
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(events, ["start:201"]);

  allowFirstStoryToFinish();
  await promise;

  assert.deepEqual(events, [
    "start:201",
    "finish:201",
    "start:202",
    "finish:202"
  ]);
});

test("runner reports progress after each story execution", async () => {
  const progressSnapshots = [];
  const stories = [
    { storyId: 301, positionInQueue: 1 },
    { storyId: 302, positionInQueue: 2 }
  ];

  const result = await runSequentialStoryQueue({
    stories,
    executeStory: async (story) => ({
      runId: story.storyId * 10,
      completionStatus: "complete"
    }),
    onProgress: async (snapshot) => {
      progressSnapshots.push(snapshot);
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(progressSnapshots.length, 2);
  assert.deepEqual(
    progressSnapshots.map((snapshot) => snapshot.processedStories),
    [1, 2]
  );
  assert.deepEqual(
    progressSnapshots.map((snapshot) => snapshot.lastProcessedStoryId),
    [301, 302]
  );
  assert.deepEqual(
    progressSnapshots.map((snapshot) => snapshot.remainingStories),
    [1, 0]
  );
});

test("runner reports story start before execution begins", async () => {
  const startedStories = [];
  const executionEvents = [];
  const stories = [
    { storyId: 321, storyTitle: "Story 321", positionInQueue: 1 },
    { storyId: 322, storyTitle: "Story 322", positionInQueue: 2 }
  ];

  const result = await runSequentialStoryQueue({
    stories,
    onStoryStart: async (storyStart) => {
      startedStories.push(storyStart);
      executionEvents.push(`start:${storyStart.storyId}`);
    },
    executeStory: async (story) => {
      executionEvents.push(`execute:${story.storyId}`);
      return {
        runId: story.storyId * 10,
        completionStatus: "complete"
      };
    }
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(executionEvents, [
    "start:321",
    "execute:321",
    "start:322",
    "execute:322"
  ]);
  assert.deepEqual(startedStories, [
    {
      storyId: 321,
      storyTitle: "Story 321",
      positionInQueue: 1,
      totalStories: 2
    },
    {
      storyId: 322,
      storyTitle: "Story 322",
      positionInQueue: 2,
      totalStories: 2
    }
  ]);
});

test("runner exposes per-story completion work and queue action via callback", async () => {
  const recordedStoryResults = [];
  const stories = [{ storyId: 351, positionInQueue: 1 }];

  const result = await runSequentialStoryQueue({
    stories,
    executeStory: async () => ({
      runId: 3510,
      completionStatus: "complete",
      completionWork: "Applied API persistence updates."
    }),
    onStoryResult: async (storyResult) => {
      recordedStoryResults.push(storyResult);
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(recordedStoryResults.length, 1);
  assert.equal(recordedStoryResults[0].runId, 3510);
  assert.equal(recordedStoryResults[0].completionStatus, "complete");
  assert.equal(recordedStoryResults[0].completionWork, "Applied API persistence updates.");
  assert.equal(recordedStoryResults[0].queueAction, "advanced");
});

test("runner stops when stopOnIncompleteStory is enabled and story is incomplete", async () => {
  const stories = [
    { storyId: 401, positionInQueue: 1 },
    { storyId: 402, positionInQueue: 2 }
  ];
  const callOrder = [];

  const result = await runSequentialStoryQueue({
    stories,
    stopOnIncompleteStory: true,
    executeStory: async (story) => {
      callOrder.push(story.storyId);
      return {
        runId: story.storyId * 10,
        completionStatus: story.storyId === 401 ? "incomplete" : "complete"
      };
    }
  });

  assert.deepEqual(callOrder, [401]);
  assert.equal(result.status, "stopped");
  assert.equal(result.stopReason, AUTOMATION_STOP_REASON.STORY_INCOMPLETE);
  assert.equal(result.processedStories, 1);
  assert.equal(result.storyResults[0].queueAction, "stopped");
});

test("runner stops before advancing when manual stop is requested", async () => {
  const stories = [
    { storyId: 421, positionInQueue: 1 },
    { storyId: 422, positionInQueue: 2 }
  ];
  const callOrder = [];
  let stopRequested = false;

  const result = await runSequentialStoryQueue({
    stories,
    shouldStop: async () => stopRequested,
    executeStory: async (story) => {
      callOrder.push(story.storyId);
      if (story.storyId === 421) {
        stopRequested = true;
      }
      return {
        runId: story.storyId * 10,
        completionStatus: "complete"
      };
    }
  });

  assert.deepEqual(callOrder, [421]);
  assert.equal(result.status, "stopped");
  assert.equal(result.stopReason, AUTOMATION_STOP_REASON.MANUAL_STOP);
  assert.equal(result.processedStories, 1);
  assert.equal(result.storyResults[0].queueAction, "stopped");
});

test("runner continues past incomplete stories when stopOnIncompleteStory is disabled", async () => {
  const stories = [
    { storyId: 451, positionInQueue: 1 },
    { storyId: 452, positionInQueue: 2 }
  ];
  const callOrder = [];

  const result = await runSequentialStoryQueue({
    stories,
    stopOnIncompleteStory: false,
    executeStory: async (story) => {
      callOrder.push(story.storyId);
      return {
        runId: story.storyId * 10,
        completionStatus: story.storyId === 451 ? "incomplete" : "complete"
      };
    }
  });

  assert.deepEqual(callOrder, [451, 452]);
  assert.equal(result.status, "completed");
  assert.equal(result.stopReason, AUTOMATION_STOP_REASON.ALL_WORK_COMPLETE);
  assert.equal(result.processedStories, 2);
  assert.equal(result.storyResults[0].completionStatus, "incomplete");
  assert.equal(result.storyResults[1].completionStatus, "complete");
});

test("runner stops queue when story execution throws", async () => {
  const stories = [
    { storyId: 501, storyTitle: "Story 501", positionInQueue: 1 },
    { storyId: 502, positionInQueue: 2 }
  ];
  const callOrder = [];

  const result = await runSequentialStoryQueue({
    stories,
    executeStory: async (story) => {
      callOrder.push(story.storyId);
      if (story.storyId === 501) {
        throw new Error("execution failed", {
          cause: new Error("codex spawn timeout")
        });
      }
      return { runId: story.storyId * 10, completionStatus: "complete" };
    }
  });

  assert.deepEqual(callOrder, [501]);
  assert.equal(result.status, "failed");
  assert.equal(result.stopReason, AUTOMATION_STOP_REASON.EXECUTION_FAILED);
  assert.equal(result.processedStories, 1);
  assert.equal(result.storyResults[0].status, "failed");
  assert.equal(result.storyResults[0].storyId, 501);
  assert.equal(result.storyResults[0].storyTitle, "Story 501");
  assert.equal(result.storyResults[0].error, "execution failed (cause: codex spawn timeout)");
  assert.equal(result.storyResults[0].queueAction, "failed");
});

test("runner marks empty queue as complete", async () => {
  const result = await runSequentialStoryQueue({
    stories: [],
    executeStory: async () => ({ completionStatus: "complete" })
  });

  assert.equal(result.status, "completed");
  assert.equal(result.stopReason, AUTOMATION_STOP_REASON.ALL_WORK_COMPLETE);
  assert.equal(result.totalStories, 0);
  assert.equal(result.processedStories, 0);
});
