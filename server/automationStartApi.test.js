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

  const calls = {
    createAutomationRun: [],
    listLocalBranches: [],
    getFeaturesTree: [],
    detachedTasks: []
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
      return {
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
    },
    updateAutomationRunMetadata: async () => ({}),
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
