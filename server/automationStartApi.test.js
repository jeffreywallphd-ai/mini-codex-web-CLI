const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const express = require("express");

const { createAutomationStartRouter } = require("./automationStartApi");

function createFeaturesFixture() {
  return [
    {
      id: 100,
      name: "Feature 100",
      created_at: "2026-01-01T10:00:00.000Z",
      epics: [
        {
          id: 201,
          name: "Epic 201",
          created_at: "2026-01-01T10:03:00.000Z",
          stories: [
            {
              id: 301,
              name: "Story 301",
              created_at: "2026-01-01T10:04:00.000Z"
            },
            {
              id: 302,
              name: "Story 302",
              created_at: "2026-01-01T10:05:00.000Z"
            }
          ]
        }
      ]
    }
  ];
}

function createServerHarness(overrides = {}) {
  let activeAutomation = null;
  let automationRunIdSeed = 1000;
  const automationRuns = new Map();

  const calls = {
    createAutomationRun: [],
    listLocalBranches: [],
    getFeaturesTree: [],
    detachedTasks: [],
    updateAutomationRunMetadata: []
  };

  const deps = {
    isValidProject: () => true,
    listLocalBranches: async (repoPath) => {
      calls.listLocalBranches.push(repoPath);
      return { branches: ["main"], currentBranch: "main" };
    },
    getRepoPath: (projectName) => `C:/repos/${projectName}`,
    getFeaturesTree: async (scope) => {
      calls.getFeaturesTree.push(scope);
      return createFeaturesFixture();
    },
    createAutomationRun: async (input) => {
      calls.createAutomationRun.push(input);
      automationRunIdSeed += 1;
      const runRecord = {
        id: automationRunIdSeed,
        automation_type: input.automationType,
        target_id: Number(input.targetId),
        stop_on_incomplete: input.stopOnIncomplete ? 1 : 0,
        stop_flag: input.stopFlag ? 1 : 0,
        current_position: input.currentPosition,
        automation_status: input.automationStatus,
        stop_reason: input.stopReason ?? null,
        created_at: "2026-04-04T00:00:00.000Z",
        updated_at: "2026-04-04T00:00:00.000Z"
      };
      automationRuns.set(runRecord.id, runRecord);
      return runRecord;
    },
    updateAutomationRunMetadata: async (automationRunId, updates = {}) => {
      calls.updateAutomationRunMetadata.push({ automationRunId, updates });
      const existing = automationRuns.get(Number(automationRunId)) || {
        id: Number(automationRunId),
        automation_type: "feature",
        target_id: 100,
        stop_on_incomplete: 0,
        stop_flag: 0,
        current_position: 1,
        automation_status: "running",
        stop_reason: null,
        created_at: "2026-04-04T00:00:00.000Z",
        updated_at: "2026-04-04T00:00:00.000Z"
      };

      const next = {
        ...existing,
        stop_flag: Object.prototype.hasOwnProperty.call(updates, "stopFlag")
          ? (updates.stopFlag ? 1 : 0)
          : existing.stop_flag,
        stop_on_incomplete: Object.prototype.hasOwnProperty.call(updates, "stopOnIncomplete")
          ? (updates.stopOnIncomplete ? 1 : 0)
          : existing.stop_on_incomplete,
        current_position: Object.prototype.hasOwnProperty.call(updates, "currentPosition")
          ? Number(updates.currentPosition)
          : existing.current_position,
        automation_status: Object.prototype.hasOwnProperty.call(updates, "automationStatus")
          ? String(updates.automationStatus)
          : existing.automation_status,
        stop_reason: Object.prototype.hasOwnProperty.call(updates, "stopReason")
          ? (updates.stopReason ?? null)
          : existing.stop_reason,
        updated_at: "2026-04-04T00:02:00.000Z"
      };

      automationRuns.set(next.id, next);
      return next;
    },
    recordAutomationStoryExecution: async () => ({}),
    getStoryAutomationContext: async () => ({
      story_id: 301,
      story_name: "Story 301",
      story_description: "Do work",
      epic_id: 201,
      epic_name: "Epic 201",
      epic_description: "Epic description",
      feature_id: 100,
      feature_name: "Feature 100",
      feature_description: "Feature description"
    }),
    attachRunToStory: async () => {},
    executeRunFlow: async () => ({
      runId: 55,
      responsePayload: {
        completion_status: "complete",
        completion_work: "none"
      }
    }),
    getAutomationRunById: async (automationRunId) => automationRuns.get(Number(automationRunId)) || ({
      id: Number(automationRunId),
      automation_type: "feature",
      target_id: 100,
      stop_on_incomplete: 0,
      stop_flag: 0,
      current_position: 2,
      automation_status: "running",
      stop_reason: null,
      created_at: "2026-04-04T00:00:00.000Z",
      updated_at: "2026-04-04T00:01:00.000Z"
    }),
    getAutomationStoryExecutionsByRunId: async () => ([
      {
        id: 1,
        automation_run_id: 1001,
        story_id: 301,
        position_in_queue: 1,
        execution_status: "completed",
        queue_action: "advanced",
        run_id: 77,
        completion_status: "complete",
        completion_work: "none",
        error: null,
        created_at: "2026-04-04T00:00:30.000Z"
      }
    ]),
    getAutomationQueueStoriesByTarget: async () => ([
      {
        positionInQueue: 1,
        featureId: 100,
        featureTitle: "Feature 100",
        epicId: 201,
        epicTitle: "Epic 201",
        storyId: 301,
        storyTitle: "Story 301",
        storyDescription: "Do setup work",
        storyCreatedAt: "2026-01-01T10:04:00.000Z"
      },
      {
        positionInQueue: 2,
        featureId: 100,
        featureTitle: "Feature 100",
        epicId: 201,
        epicTitle: "Epic 201",
        storyId: 302,
        storyTitle: "Story 302",
        storyDescription: "Do follow-up work",
        storyCreatedAt: "2026-01-01T10:05:00.000Z"
      }
    ]),
    getErrorMessage: (error) => error?.message || String(error),
    runningProjects: new Set(),
    getActiveAutomation: () => activeAutomation,
    setActiveAutomation: (nextValue) => {
      activeAutomation = nextValue;
    },
    runDetached: (task) => {
      calls.detachedTasks.push(task);
    },
    logger: {
      error: () => {}
    },
    ...overrides
  };

  const app = express();
  app.use(express.json());
  app.use("/api/automation", createAutomationStartRouter(deps));

  const server = http.createServer(app);

  return {
    app,
    server,
    calls,
    deps,
    automationRuns,
    runDetachedTasks: async () => {
      for (const task of calls.detachedTasks.splice(0)) {
        await task();
      }
    }
  };
}

async function withServer(harness, fn) {
  await new Promise((resolve) => harness.server.listen(0, resolve));
  const { port } = harness.server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      harness.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("feature/epic/story start endpoints launch automation and return tracking payload", async () => {
  const harness = createServerHarness();

  await withServer(harness, async (baseUrl) => {
    const cases = [
      {
        path: "/api/automation/start/feature/100",
        expectedType: "feature",
        expectedStoryIds: [301, 302]
      },
      {
        path: "/api/automation/start/epic/201",
        expectedType: "epic",
        expectedStoryIds: [301, 302]
      },
      {
        path: "/api/automation/start/story/301",
        expectedType: "story",
        expectedStoryIds: [301]
      }
    ];

    for (const testCase of cases) {
      const response = await fetch(`${baseUrl}${testCase.path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          projectName: "demo-project",
          baseBranch: "main",
          stopOnIncompleteStory: true
        })
      });

      assert.equal(response.status, 202);
      const payload = await response.json();
      assert.equal(payload.projectName, "demo-project");
      assert.equal(payload.baseBranch, "main");
      assert.equal(payload.automationRun.automationType, testCase.expectedType);
      assert.equal(payload.automationRun.stopOnIncomplete, true);
      assert.equal(payload.automationRun.status, "running");
      assert.equal(payload.queue.totalStories, testCase.expectedStoryIds.length);
      assert.deepEqual(payload.queue.storyIds, testCase.expectedStoryIds);
      assert.equal(payload.queue.queueStatus.isValid, true);
    }
  });

  assert.equal(harness.calls.createAutomationRun.length, 3);
  assert.equal(harness.calls.detachedTasks.length, 3);
});

test("start endpoint validates target existence", async () => {
  const harness = createServerHarness({
    getFeaturesTree: async () => createFeaturesFixture()
  });

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/start/feature/999`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main"
      })
    });

    assert.equal(response.status, 404);
    const payload = await response.json();
    assert.match(payload.error, /No feature found for target '999'/);
  });

  assert.equal(harness.calls.createAutomationRun.length, 0);
  assert.equal(harness.calls.detachedTasks.length, 0);
});

test("start endpoint rejects ineligible targets with no runnable stories", async () => {
  const harness = createServerHarness({
    getFeaturesTree: async () => [
      {
        id: 100,
        name: "Feature 100",
        created_at: "2026-01-01T10:00:00.000Z",
        epics: [
          {
            id: 201,
            name: "Epic 201",
            created_at: "2026-01-01T10:03:00.000Z",
            stories: []
          }
        ]
      }
    ]
  });

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/start/epic/201`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main"
      })
    });

    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.match(payload.error, /No runnable stories found for epic '201'/);
  });

  assert.equal(harness.calls.createAutomationRun.length, 0);
  assert.equal(harness.calls.detachedTasks.length, 0);
});

test("status endpoint returns queue progress and current item for running automation", async () => {
  const harness = createServerHarness();

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/status/1001`);

    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.automationRun.id, 1001);
    assert.equal(payload.automationRun.status, "running");
    assert.equal(payload.queue.totalStories, 2);
    assert.equal(payload.queue.processedStories, 1);
    assert.equal(payload.queue.remainingStories, 1);
    assert.equal(payload.queue.currentPosition, 2);
    assert.equal(payload.queue.currentItem.storyId, 302);
    assert.equal(payload.summary.completedCount, 1);
    assert.equal(payload.summary.failedCount, 0);
    assert.equal(payload.completedSteps.length, 1);
    assert.equal(payload.failedSteps.length, 0);
    assert.equal(payload.finalResult, null);
  });
});

test("status endpoint returns final result and handles invalid or missing ids", async () => {
  const harness = createServerHarness({
    getAutomationRunById: async (automationRunId) => {
      if (Number(automationRunId) === 9999) return null;
      return {
        id: Number(automationRunId),
        automation_type: "story",
        target_id: 301,
        stop_on_incomplete: 1,
        stop_flag: 1,
        current_position: 1,
        automation_status: "stopped",
        stop_reason: "story_incomplete",
        created_at: "2026-04-04T00:00:00.000Z",
        updated_at: "2026-04-04T00:01:00.000Z"
      };
    },
    getAutomationStoryExecutionsByRunId: async () => ([
      {
        id: 2,
        automation_run_id: 1002,
        story_id: 301,
        position_in_queue: 1,
        execution_status: "completed",
        queue_action: "stopped",
        run_id: 88,
        completion_status: "incomplete",
        completion_work: "Remaining validation updates.",
        error: null,
        created_at: "2026-04-04T00:00:30.000Z"
      }
    ]),
    getAutomationQueueStoriesByTarget: async () => ([
      {
        positionInQueue: 1,
        featureId: 100,
        featureTitle: "Feature 100",
        epicId: 201,
        epicTitle: "Epic 201",
        storyId: 301,
        storyTitle: "Story 301",
        storyDescription: "Do work",
        storyCreatedAt: "2026-01-01T10:04:00.000Z"
      }
    ])
  });

  await withServer(harness, async (baseUrl) => {
    const completedResponse = await fetch(`${baseUrl}/api/automation/status/1002`);
    assert.equal(completedResponse.status, 200);
    const completedPayload = await completedResponse.json();
    assert.equal(completedPayload.finalResult.status, "stopped");
    assert.equal(completedPayload.finalResult.stopReason, "story_incomplete");

    const invalidResponse = await fetch(`${baseUrl}/api/automation/status/not-a-number`);
    assert.equal(invalidResponse.status, 400);
    const invalidPayload = await invalidResponse.json();
    assert.match(invalidPayload.error, /Invalid automation id/);

    const missingResponse = await fetch(`${baseUrl}/api/automation/status/9999`);
    assert.equal(missingResponse.status, 404);
    const missingPayload = await missingResponse.json();
    assert.match(missingPayload.error, /Automation run not found/);
  });
});

test("stop endpoint marks running automation as manually stopped", async () => {
  const harness = createServerHarness();
  let automationRunId = null;

  await withServer(harness, async (baseUrl) => {
    const startResponse = await fetch(`${baseUrl}/api/automation/start/feature/100`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main"
      })
    });

    assert.equal(startResponse.status, 202);
    const startPayload = await startResponse.json();
    automationRunId = startPayload.automationRun.id;

    const stopResponse = await fetch(`${baseUrl}/api/automation/stop/${automationRunId}`, {
      method: "POST"
    });
    assert.equal(stopResponse.status, 200);
    const stopPayload = await stopResponse.json();

    assert.equal(stopPayload.automationRun.status, "stopped");
    assert.equal(stopPayload.automationRun.stopFlag, true);
    assert.equal(stopPayload.automationRun.stopReason, "manual_stop");
    assert.equal(stopPayload.finalResult.status, "stopped");
    assert.equal(stopPayload.finalResult.stopReason, "manual_stop");
  });

  assert.equal(harness.calls.updateAutomationRunMetadata.length >= 1, true);
  const stopUpdateCall = harness.calls.updateAutomationRunMetadata.find(
    (call) => Number(call.automationRunId) === Number(automationRunId)
      && call.updates?.automationStatus === "stopped"
      && call.updates?.stopReason === "manual_stop"
  );
  assert.ok(stopUpdateCall);
});

test("manual stop prevents automation from starting the next queued story", async () => {
  const firstStoryGate = {};
  firstStoryGate.promise = new Promise((resolve) => {
    firstStoryGate.resolve = resolve;
  });

  let executeRunFlowCalls = 0;
  const harness = createServerHarness({
    executeRunFlow: async () => {
      executeRunFlowCalls += 1;
      if (executeRunFlowCalls === 1) {
        await firstStoryGate.promise;
      }
      return {
        runId: 800 + executeRunFlowCalls,
        responsePayload: {
          completion_status: "complete",
          completion_work: "none"
        }
      };
    },
    runDetached: (task) => {
      harness.backgroundTaskPromise = task();
    }
  });
  harness.backgroundTaskPromise = Promise.resolve();

  await withServer(harness, async (baseUrl) => {
    const startResponse = await fetch(`${baseUrl}/api/automation/start/feature/100`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main"
      })
    });

    assert.equal(startResponse.status, 202);
    const startPayload = await startResponse.json();
    const automationRunId = startPayload.automationRun.id;

    const stopResponse = await fetch(`${baseUrl}/api/automation/stop/${automationRunId}`, {
      method: "POST"
    });
    assert.equal(stopResponse.status, 200);

    firstStoryGate.resolve();
    await harness.backgroundTaskPromise;

    assert.equal(executeRunFlowCalls, 1);

    const statusResponse = await fetch(`${baseUrl}/api/automation/status/${automationRunId}`);
    assert.equal(statusResponse.status, 200);
    const statusPayload = await statusResponse.json();
    assert.equal(statusPayload.finalResult.status, "stopped");
    assert.equal(statusPayload.finalResult.stopReason, "manual_stop");
  });
});
