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
    findRunningAutomationByScope: [],
    recordAutomationRunQueueItems: [],
    listLocalBranches: [],
    getFeaturesTree: [],
    detachedTasks: [],
    updateAutomationRunMetadata: [],
    executeAutomatedStoryRun: [],
    mergeAutomationStoryRun: [],
    automationLifecycleLogs: []
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
        project_name: input.projectName ?? null,
        base_branch: input.baseBranch ?? null,
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
    findRunningAutomationByScope: async (scope = {}) => {
      calls.findRunningAutomationByScope.push(scope);
      const automationType = String(scope?.automationType || "").trim().toLowerCase();
      const targetId = Number.parseInt(scope?.targetId, 10);
      const projectName = String(scope?.projectName || "").trim();
      const baseBranch = String(scope?.baseBranch || "").trim();
      const excludeAutomationRunId = Number.parseInt(scope?.excludeAutomationRunId, 10);

      for (const runRecord of automationRuns.values()) {
        if (String(runRecord?.automation_type || "").trim().toLowerCase() !== automationType) continue;
        if (Number.parseInt(runRecord?.target_id, 10) !== targetId) continue;
        if (String(runRecord?.project_name || "").trim() !== projectName) continue;
        if (String(runRecord?.base_branch || "").trim() !== baseBranch) continue;
        if (String(runRecord?.automation_status || "").trim().toLowerCase() !== "running") continue;
        if (Number.isInteger(excludeAutomationRunId) && excludeAutomationRunId > 0 && Number(runRecord.id) === excludeAutomationRunId) {
          continue;
        }
        return runRecord;
      }

      return null;
    },
    recordAutomationRunQueueItems: async (input) => {
      calls.recordAutomationRunQueueItems.push(input);
      return true;
    },
    updateAutomationRunMetadata: async (automationRunId, updates = {}) => {
      calls.updateAutomationRunMetadata.push({ automationRunId, updates });
      const existing = automationRuns.get(Number(automationRunId)) || {
        id: Number(automationRunId),
        automation_type: "feature",
        target_id: 100,
        project_name: "demo-project",
        base_branch: "main",
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
    executeAutomatedStoryRun: async (input) => {
      calls.executeAutomatedStoryRun.push(input);
      return {
        storyContext: {
          story_id: Number(input.storyId),
          story_name: `Story ${input.storyId}`,
          story_description: "Do work",
          epic_id: 201,
          epic_name: "Epic 201",
          epic_description: "Epic description",
          feature_id: 100,
          feature_name: "Feature 100",
          feature_description: "Feature description"
        },
        prompt: `Story ${input.storyId} prompt`,
        runId: 55,
        responsePayload: {
          branchName: `codex-story-${input.storyId}`,
          changeTitle: `Story ${input.storyId} changes`,
          changeDescription: "Story automation output",
          completion_status: "complete",
          completion_work: "none"
        },
        completionStatus: "complete",
        completionWork: "none"
      };
    },
    mergeAutomationStoryRun: async (input) => {
      calls.mergeAutomationStoryRun.push(input);
      return {
        code: 0,
        stdout: "merged",
        stderr: "",
        gitStatus: ""
      };
    },
    getAutomationRunById: async (automationRunId) => automationRuns.get(Number(automationRunId)) || ({
      id: Number(automationRunId),
      automation_type: "feature",
      target_id: 100,
      project_name: "demo-project",
      base_branch: "main",
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
    getAutomationRunQueueItemsByRunId: async () => ([
      {
        id: 1,
        automationRunId: 1001,
        positionInQueue: 1,
        featureId: 100,
        featureTitle: "Feature 100",
        epicId: 201,
        epicTitle: "Epic 201",
        storyId: 301,
        storyTitle: "Story 301",
        storyDescription: "Do setup work",
        storyCreatedAt: "2026-01-01T10:04:00.000Z",
        createdAt: "2026-04-04T00:00:00.000Z"
      },
      {
        id: 2,
        automationRunId: 1001,
        positionInQueue: 2,
        featureId: 100,
        featureTitle: "Feature 100",
        epicId: 201,
        epicTitle: "Epic 201",
        storyId: 302,
        storyTitle: "Story 302",
        storyDescription: "Do follow-up work",
        storyCreatedAt: "2026-01-01T10:05:00.000Z",
        createdAt: "2026-04-04T00:00:00.000Z"
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
      error: () => {},
      info: (message, payload) => {
        calls.automationLifecycleLogs.push({ message, payload });
      }
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
      assert.equal(payload.launchMode, "start");
      assert.equal(payload.automationRun.automationType, testCase.expectedType);
      assert.equal(payload.automationRun.projectName, "demo-project");
      assert.equal(payload.automationRun.baseBranch, "main");
      assert.equal(payload.automationRun.stopOnIncomplete, true);
      assert.equal(payload.automationRun.status, "running");
      assert.equal(payload.queue.totalStories, testCase.expectedStoryIds.length);
      assert.deepEqual(payload.queue.storyIds, testCase.expectedStoryIds);
      assert.equal(payload.queue.queueStatus.isValid, true);
    }
  });

  assert.equal(harness.calls.createAutomationRun.length, 3);
  assert.equal(harness.calls.recordAutomationRunQueueItems.length, 3);
  assert.deepEqual(
    harness.calls.recordAutomationRunQueueItems.map((call) => call.stories.length),
    [2, 2, 1]
  );
  assert.ok(
    harness.calls.createAutomationRun.every((call) => (
      call.projectName === "demo-project"
      && call.baseBranch === "main"
    ))
  );
  assert.equal(harness.calls.detachedTasks.length, 3);
  assert.equal(harness.calls.executeAutomatedStoryRun.length, 0);

  await harness.runDetachedTasks();

  assert.equal(harness.calls.executeAutomatedStoryRun.length, 5);
  assert.equal(harness.calls.mergeAutomationStoryRun.length, 5);
  assert.ok(
    harness.calls.executeAutomatedStoryRun.every((call) => (
      call.projectName === "demo-project"
      && call.baseBranch === "main"
      && call.executionMode === "write"
    ))
  );
});

test("automation lifecycle logging includes launch, story execution, stop reason, and final outcome", async () => {
  const harness = createServerHarness();
  let automationRunId = null;

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/start/feature/100`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main"
      })
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    automationRunId = payload.automationRun.id;
  });

  await harness.runDetachedTasks();

  const lifecycleEvents = harness.calls.automationLifecycleLogs.map((entry) => entry.payload?.eventType);
  assert.ok(lifecycleEvents.includes("automation_launch_accepted"));
  assert.ok(lifecycleEvents.includes("automation_started"));
  assert.ok(lifecycleEvents.includes("story_queue_started"));
  assert.ok(lifecycleEvents.includes("story_execution_completed"));
  assert.ok(lifecycleEvents.includes("automation_stop_reason"));
  assert.ok(lifecycleEvents.includes("automation_final_result"));

  const launchEvent = harness.calls.automationLifecycleLogs.find(
    (entry) => entry.payload?.eventType === "automation_launch_accepted"
      && entry.payload?.automationRunId === automationRunId
  );
  assert.equal(launchEvent?.payload?.projectName, "demo-project");
  assert.equal(launchEvent?.payload?.baseBranch, "main");
  assert.equal(launchEvent?.payload?.queuedStories, 2);

  const storyStartEvents = harness.calls.automationLifecycleLogs.filter(
    (entry) => entry.payload?.eventType === "story_queue_started"
  );
  assert.equal(storyStartEvents.length, 2);
  assert.deepEqual(
    storyStartEvents.map((entry) => entry.payload?.positionInQueue),
    [1, 2]
  );
  assert.deepEqual(
    storyStartEvents.map((entry) => entry.payload?.storyId),
    [301, 302]
  );

  const storyCompletionEvents = harness.calls.automationLifecycleLogs.filter(
    (entry) => entry.payload?.eventType === "story_execution_completed"
  );
  assert.equal(storyCompletionEvents.length, 2);
  assert.ok(storyCompletionEvents.every((entry) => entry.payload?.executionStatus === "completed"));
  assert.ok(storyCompletionEvents.every((entry) => entry.payload?.queueAction === "advanced"));

  const stopEvent = harness.calls.automationLifecycleLogs.find(
    (entry) => entry.payload?.eventType === "automation_stop_reason"
  );
  assert.equal(stopEvent?.payload?.stopReason, "all_work_complete");

  const finalEvent = harness.calls.automationLifecycleLogs.find(
    (entry) => entry.payload?.eventType === "automation_final_result"
  );
  assert.equal(finalEvent?.payload?.status, "completed");
  assert.equal(finalEvent?.payload?.stopReason, "all_work_complete");
});

test("automation lifecycle logging records failure stop reason and error details", async () => {
  const harness = createServerHarness({
    executeAutomatedStoryRun: async () => {
      throw new Error("codex execution timeout");
    }
  });

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/start/feature/100`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main"
      })
    });

    assert.equal(response.status, 202);
  });

  await harness.runDetachedTasks();

  const stopEvent = harness.calls.automationLifecycleLogs.find(
    (entry) => entry.payload?.eventType === "automation_stop_reason"
      && entry.payload?.stopReason === "execution_failed"
  );
  assert.ok(stopEvent);

  const finalEvent = harness.calls.automationLifecycleLogs.find(
    (entry) => entry.payload?.eventType === "automation_final_result"
      && entry.payload?.status === "failed"
  );
  assert.ok(finalEvent);
  assert.equal(finalEvent.payload.stopReason, "execution_failed");
  assert.match(finalEvent.payload.error, /codex execution timeout/);
});

test("automation run stops with merge_failed when auto-merge fails for a story", async () => {
  const harness = createServerHarness({
    mergeAutomationStoryRun: async () => {
      throw new Error("merge conflict in feature branch");
    }
  });
  let automationRunId = null;

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/start/feature/100`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main"
      })
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    automationRunId = payload.automationRun.id;
  });

  await harness.runDetachedTasks();

  const updatedRun = harness.automationRuns.get(automationRunId);
  assert.equal(updatedRun?.automation_status, "failed");
  assert.equal(updatedRun?.stop_reason, "merge_failed");

  const finalEvent = harness.calls.automationLifecycleLogs.find(
    (entry) => entry.payload?.eventType === "automation_final_result"
      && entry.payload?.automationRunId === automationRunId
  );
  assert.equal(finalEvent?.payload?.status, "failed");
  assert.equal(finalEvent?.payload?.stopReason, "merge_failed");
  assert.match(String(finalEvent?.payload?.error || ""), /merge conflict/i);
});

test("feature automation executes stories in the same deterministic order returned by queue generation", async () => {
  const harness = createServerHarness({
    getFeaturesTree: async () => ([
      {
        id: 100,
        name: "Feature 100",
        created_at: "2026-01-01T10:00:00.000Z",
        epics: [
          {
            id: 202,
            name: "Epic 202",
            created_at: "2026-01-01T10:10:00.000Z",
            stories: [
              {
                id: 304,
                name: "Story 304",
                created_at: "2026-01-01T10:12:00.000Z"
              },
              {
                id: 303,
                name: "Story 303",
                created_at: "2026-01-01T10:11:00.000Z"
              }
            ]
          },
          {
            id: 201,
            name: "Epic 201",
            created_at: "2026-01-01T10:03:00.000Z",
            stories: [
              {
                id: 302,
                name: "Story 302",
                created_at: "2026-01-01T10:05:00.000Z"
              },
              {
                id: 301,
                name: "Story 301",
                created_at: "2026-01-01T10:04:00.000Z"
              }
            ]
          }
        ]
      }
    ])
  });

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/start/feature/100`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main"
      })
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.deepEqual(payload.queue.storyIds, [301, 302, 303, 304]);
  });

  await harness.runDetachedTasks();
  assert.deepEqual(
    harness.calls.executeAutomatedStoryRun.map((call) => call.storyId),
    [301, 302, 303, 304]
  );
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

test("start endpoint rejects mismatched automation scope or target ids cleanly", async () => {
  const harness = createServerHarness();

  await withServer(harness, async (baseUrl) => {
    const scopeMismatchResponse = await fetch(`${baseUrl}/api/automation/start/feature/100`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main",
        automationType: "epic",
        targetId: 100
      })
    });
    assert.equal(scopeMismatchResponse.status, 400);
    const scopeMismatchPayload = await scopeMismatchResponse.json();
    assert.match(scopeMismatchPayload.error, /Automation scope mismatch/);

    const targetMismatchResponse = await fetch(`${baseUrl}/api/automation/start/epic/201`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main",
        automationType: "epic",
        targetId: 999
      })
    });
    assert.equal(targetMismatchResponse.status, 400);
    const targetMismatchPayload = await targetMismatchResponse.json();
    assert.match(targetMismatchPayload.error, /Target mismatch/);

    const scopedBodyMismatchResponse = await fetch(`${baseUrl}/api/automation/start/story/301`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main",
        automationType: "story",
        targetId: 301,
        storyId: 302
      })
    });
    assert.equal(scopedBodyMismatchResponse.status, 400);
    const scopedBodyMismatchPayload = await scopedBodyMismatchResponse.json();
    assert.match(scopedBodyMismatchPayload.error, /Target mismatch/);

    const invalidBodyTargetResponse = await fetch(`${baseUrl}/api/automation/start/feature/100`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main",
        automationType: "feature",
        targetId: "not-a-number"
      })
    });
    assert.equal(invalidBodyTargetResponse.status, 400);
    const invalidBodyTargetPayload = await invalidBodyTargetResponse.json();
    assert.match(invalidBodyTargetPayload.error, /Invalid target id/);
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

    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.errorType, "target_ineligible");
    assert.equal(payload.queueStatus?.code, "empty_queue");
    assert.match(payload.error, /No runnable stories found for epic '201'/);
  });

  assert.equal(harness.calls.createAutomationRun.length, 0);
  assert.equal(harness.calls.detachedTasks.length, 0);
});

test("start endpoint rejects overlapping automation for the same scoped target with a clear conflict payload", async () => {
  const harness = createServerHarness();
  harness.automationRuns.set(7001, {
    id: 7001,
    automation_type: "feature",
    target_id: 100,
    project_name: "demo-project",
    base_branch: "main",
    stop_on_incomplete: 0,
    stop_flag: 0,
    current_position: 1,
    automation_status: "running",
    stop_reason: null,
    created_at: "2026-04-04T00:00:00.000Z",
    updated_at: "2026-04-04T00:00:00.000Z"
  });

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/start/feature/100`, {
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
    assert.equal(payload.errorType, "automation_target_conflict");
    assert.match(payload.error, /already running/i);
    assert.equal(payload.conflict.automationRunId, 7001);
    assert.equal(payload.conflict.automationType, "feature");
    assert.equal(payload.conflict.targetId, 100);
    assert.equal(payload.conflict.projectName, "demo-project");
    assert.equal(payload.conflict.baseBranch, "main");
    assert.equal(payload.conflict.status, "running");
  });

  assert.equal(harness.calls.createAutomationRun.length, 0);
  assert.equal(harness.calls.detachedTasks.length, 0);
});

test("start endpoint still allows a different target when no same-target conflict exists", async () => {
  const harness = createServerHarness();
  harness.automationRuns.set(7010, {
    id: 7010,
    automation_type: "feature",
    target_id: 999,
    project_name: "demo-project",
    base_branch: "main",
    stop_on_incomplete: 0,
    stop_flag: 0,
    current_position: 1,
    automation_status: "running",
    stop_reason: null,
    created_at: "2026-04-04T00:00:00.000Z",
    updated_at: "2026-04-04T00:00:00.000Z"
  });

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/start/feature/100`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main"
      })
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.automationRun.automationType, "feature");
    assert.equal(payload.automationRun.targetId, 100);
  });

  assert.equal(harness.calls.createAutomationRun.length, 1);
  assert.equal(harness.calls.detachedTasks.length, 1);
});

test("start endpoint rejects completed targets as ineligible for automation", async () => {
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
            stories: [
              {
                id: 301,
                name: "Story 301",
                created_at: "2026-01-01T10:04:00.000Z",
                completion_status: "complete"
              }
            ]
          }
        ]
      }
    ]
  });

  await withServer(harness, async (baseUrl) => {
    const featureResponse = await fetch(`${baseUrl}/api/automation/start/feature/100`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main"
      })
    });
    assert.equal(featureResponse.status, 422);
    const featurePayload = await featureResponse.json();
    assert.equal(featurePayload.errorType, "target_ineligible");
    assert.equal(featurePayload.queueStatus?.code, "target_ineligible");
    assert.match(featurePayload.error, /not eligible for automation/i);

    const epicResponse = await fetch(`${baseUrl}/api/automation/start/epic/201`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main"
      })
    });
    assert.equal(epicResponse.status, 422);
    const epicPayload = await epicResponse.json();
    assert.equal(epicPayload.errorType, "target_ineligible");
    assert.equal(epicPayload.queueStatus?.code, "target_ineligible");
    assert.match(epicPayload.error, /not eligible for automation/i);

    const storyResponse = await fetch(`${baseUrl}/api/automation/start/story/301`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main"
      })
    });
    assert.equal(storyResponse.status, 422);
    const storyPayload = await storyResponse.json();
    assert.equal(storyPayload.errorType, "target_ineligible");
    assert.equal(storyPayload.queueStatus?.code, "target_ineligible");
    assert.match(storyPayload.error, /not eligible for automation/i);
  });

  assert.equal(harness.calls.createAutomationRun.length, 0);
  assert.equal(harness.calls.detachedTasks.length, 0);
});

test("start endpoint returns structured validation failures when scoped stories are missing required prompt fields", async () => {
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
            stories: [
              {
                id: 301,
                name: "Story 301",
                description: "",
                created_at: "2026-01-01T10:04:00.000Z",
                completion_status: "incomplete"
              }
            ]
          }
        ]
      }
    ]
  });

  await withServer(harness, async (baseUrl) => {
    const featureResponse = await fetch(`${baseUrl}/api/automation/start/feature/100`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main"
      })
    });
    assert.equal(featureResponse.status, 422);
    const featurePayload = await featureResponse.json();
    assert.equal(featurePayload.errorType, "validation_failed");
    assert.equal(featurePayload.queueStatus.code, "validation_failed");
    assert.equal(Array.isArray(featurePayload.validationErrors), true);
    assert.equal(featurePayload.validationErrors.length, 1);
    assert.deepEqual(featurePayload.validationErrors[0].missingFields, ["story_description"]);

    const epicResponse = await fetch(`${baseUrl}/api/automation/start/epic/201`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main"
      })
    });
    assert.equal(epicResponse.status, 422);
    const epicPayload = await epicResponse.json();
    assert.equal(epicPayload.errorType, "validation_failed");
    assert.equal(epicPayload.queueStatus.code, "validation_failed");
    assert.equal(Array.isArray(epicPayload.validationErrors), true);
    assert.equal(epicPayload.validationErrors.length, 1);
    assert.deepEqual(epicPayload.validationErrors[0].missingFields, ["story_description"]);

    const storyResponse = await fetch(`${baseUrl}/api/automation/start/story/301`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "main"
      })
    });
    assert.equal(storyResponse.status, 422);
    const storyPayload = await storyResponse.json();
    assert.equal(storyPayload.errorType, "validation_failed");
    assert.equal(storyPayload.queueStatus.code, "validation_failed");
    assert.equal(Array.isArray(storyPayload.validationErrors), true);
    assert.equal(storyPayload.validationErrors.length, 1);
    assert.deepEqual(storyPayload.validationErrors[0].missingFields, ["story_description"]);
    assert.match(storyPayload.error, /missing required prompt fields/i);
  });

  assert.equal(harness.calls.createAutomationRun.length, 0);
  assert.equal(harness.calls.detachedTasks.length, 0);
});

test("start endpoint rejects missing or invalid project/branch context before queue execution", async () => {
  const harness = createServerHarness({
    isValidProject: (projectName) => projectName === "demo-project",
    listLocalBranches: async () => ({ branches: ["main"], currentBranch: "main" })
  });

  await withServer(harness, async (baseUrl) => {
    const invalidProjectResponse = await fetch(`${baseUrl}/api/automation/start/feature/100`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "unknown-project",
        baseBranch: "main"
      })
    });
    assert.equal(invalidProjectResponse.status, 400);
    const invalidProjectPayload = await invalidProjectResponse.json();
    assert.match(invalidProjectPayload.error, /valid project name is required/i);

    const invalidBranchResponse = await fetch(`${baseUrl}/api/automation/start/feature/100`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectName: "demo-project",
        baseBranch: "release/unknown"
      })
    });
    assert.equal(invalidBranchResponse.status, 400);
    const invalidBranchPayload = await invalidBranchResponse.json();
    assert.match(invalidBranchPayload.error, /Invalid base branch 'release\/unknown'/);
  });

  assert.equal(harness.calls.createAutomationRun.length, 0);
  assert.equal(harness.calls.detachedTasks.length, 0);
  assert.equal(harness.calls.executeAutomatedStoryRun.length, 0);
});

test("status endpoint returns queue progress and current item for running automation", async () => {
  const harness = createServerHarness();

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/status/1001`);

    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.automationRun.id, 1001);
    assert.equal(payload.automationRun.status, "running");
    assert.equal(payload.automationRun.projectName, "demo-project");
    assert.equal(payload.automationRun.baseBranch, "main");
    assert.equal(payload.queue.totalStories, 2);
    assert.equal(payload.queue.processedStories, 1);
    assert.equal(payload.queue.remainingStories, 1);
    assert.equal(payload.queue.currentPosition, 2);
    assert.equal(payload.queue.currentItem.storyId, 302);
    assert.equal(payload.queue.currentItem.storyTitle, "Story 302");
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
        project_name: "demo-project",
        base_branch: "main",
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
    assert.equal(completedPayload.queue.currentItem, null);
    assert.equal(completedPayload.automationRun.projectName, "demo-project");
    assert.equal(completedPayload.automationRun.baseBranch, "main");

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

test("status endpoint surfaces failed step story and failure reason for troubleshooting", async () => {
  const harness = createServerHarness({
    getAutomationRunById: async (automationRunId) => ({
      id: Number(automationRunId),
      automation_type: "feature",
      target_id: 100,
      project_name: "demo-project",
      base_branch: "main",
      stop_on_incomplete: 0,
      stop_flag: 1,
      current_position: 1,
      automation_status: "failed",
      stop_reason: "execution_failed",
      created_at: "2026-04-04T00:00:00.000Z",
      updated_at: "2026-04-04T00:01:00.000Z"
    }),
    getAutomationStoryExecutionsByRunId: async () => ([
      {
        id: 9,
        automation_run_id: 1009,
        story_id: 301,
        position_in_queue: 1,
        execution_status: "failed",
        queue_action: "failed",
        run_id: null,
        completion_status: "unknown",
        completion_work: null,
        error: "Prompt generation failed (cause: missing story description)",
        created_at: "2026-04-04T00:00:30.000Z"
      }
    ])
  });

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/status/1009`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.finalResult.status, "failed");
    assert.equal(payload.finalResult.stopReason, "execution_failed");
    assert.equal(payload.failedSteps.length, 1);
    assert.equal(payload.failedSteps[0].storyId, 301);
    assert.equal(payload.failedSteps[0].storyTitle, "Story 301");
    assert.equal(payload.failedSteps[0].error, "Prompt generation failed (cause: missing story description)");
  });
});

test("status endpoint derives queue progress from persisted run queue snapshot", async () => {
  const harness = createServerHarness({
    getAutomationRunById: async (automationRunId) => ({
      id: Number(automationRunId),
      automation_type: "feature",
      target_id: 100,
      project_name: "demo-project",
      base_branch: "main",
      stop_on_incomplete: 0,
      stop_flag: 0,
      current_position: 2,
      automation_status: "running",
      stop_reason: null,
      created_at: "2026-04-04T00:00:00.000Z",
      updated_at: "2026-04-04T00:01:00.000Z"
    }),
    getAutomationRunQueueItemsByRunId: async () => ([
      {
        id: 201,
        automationRunId: 3001,
        positionInQueue: 1,
        featureId: 100,
        featureTitle: "Feature 100",
        epicId: 201,
        epicTitle: "Epic 201",
        storyId: 701,
        storyTitle: "Persisted Story 701",
        storyDescription: "Persisted snapshot item 1",
        storyCreatedAt: "2026-01-01T10:00:00.000Z",
        createdAt: "2026-04-04T00:00:00.000Z"
      },
      {
        id: 202,
        automationRunId: 3001,
        positionInQueue: 2,
        featureId: 100,
        featureTitle: "Feature 100",
        epicId: 201,
        epicTitle: "Epic 201",
        storyId: 702,
        storyTitle: "Persisted Story 702",
        storyDescription: "Persisted snapshot item 2",
        storyCreatedAt: "2026-01-01T10:01:00.000Z",
        createdAt: "2026-04-04T00:00:00.000Z"
      },
      {
        id: 203,
        automationRunId: 3001,
        positionInQueue: 3,
        featureId: 100,
        featureTitle: "Feature 100",
        epicId: 201,
        epicTitle: "Epic 201",
        storyId: 703,
        storyTitle: "Persisted Story 703",
        storyDescription: "Persisted snapshot item 3",
        storyCreatedAt: "2026-01-01T10:02:00.000Z",
        createdAt: "2026-04-04T00:00:00.000Z"
      }
    ]),
    getAutomationStoryExecutionsByRunId: async () => ([
      {
        id: 301,
        automation_run_id: 3001,
        story_id: 701,
        position_in_queue: 1,
        execution_status: "completed",
        queue_action: "advanced",
        run_id: 501,
        completion_status: "complete",
        completion_work: "none",
        error: null,
        created_at: "2026-04-04T00:00:30.000Z"
      }
    ]),
    getAutomationQueueStoriesByTarget: async () => ([
      {
        positionInQueue: 1,
        storyId: 999,
        storyTitle: "Live Story 999"
      }
    ])
  });

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/status/3001`);
    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.queue.totalStories, 3);
    assert.equal(payload.queue.processedStories, 1);
    assert.equal(payload.queue.remainingStories, 2);
    assert.equal(payload.queue.currentPosition, 2);
    assert.equal(payload.queue.currentItem.storyId, 702);
    assert.equal(payload.queue.currentItem.storyTitle, "Persisted Story 702");
    assert.equal(payload.completedSteps.length, 1);
    assert.equal(payload.completedSteps[0].storyId, 701);
    assert.equal(payload.completedSteps[0].storyTitle, "Persisted Story 701");
  });
});

test("status endpoint uses queue position ordering when persisted queue rows are unsorted", async () => {
  const harness = createServerHarness({
    getAutomationRunById: async (automationRunId) => ({
      id: Number(automationRunId),
      automation_type: "feature",
      target_id: 100,
      project_name: "demo-project",
      base_branch: "main",
      stop_on_incomplete: 0,
      stop_flag: 0,
      current_position: 2,
      automation_status: "running",
      stop_reason: null,
      created_at: "2026-04-04T00:00:00.000Z",
      updated_at: "2026-04-04T00:01:00.000Z"
    }),
    getAutomationRunQueueItemsByRunId: async () => ([
      {
        id: 803,
        automationRunId: 4801,
        positionInQueue: 3,
        featureId: 100,
        featureTitle: "Feature 100",
        epicId: 201,
        epicTitle: "Epic 201",
        storyId: 1303,
        storyTitle: "Story 1303",
        storyDescription: "Third",
        storyCreatedAt: "2026-01-01T10:03:00.000Z",
        createdAt: "2026-04-04T00:00:00.000Z"
      },
      {
        id: 801,
        automationRunId: 4801,
        positionInQueue: 1,
        featureId: 100,
        featureTitle: "Feature 100",
        epicId: 201,
        epicTitle: "Epic 201",
        storyId: 1301,
        storyTitle: "Story 1301",
        storyDescription: "First",
        storyCreatedAt: "2026-01-01T10:01:00.000Z",
        createdAt: "2026-04-04T00:00:00.000Z"
      },
      {
        id: 802,
        automationRunId: 4801,
        positionInQueue: 2,
        featureId: 100,
        featureTitle: "Feature 100",
        epicId: 201,
        epicTitle: "Epic 201",
        storyId: 1302,
        storyTitle: "Story 1302",
        storyDescription: "Second",
        storyCreatedAt: "2026-01-01T10:02:00.000Z",
        createdAt: "2026-04-04T00:00:00.000Z"
      }
    ]),
    getAutomationStoryExecutionsByRunId: async () => ([
      {
        id: 901,
        automation_run_id: 4801,
        story_id: 1301,
        position_in_queue: 1,
        execution_status: "completed",
        queue_action: "advanced",
        run_id: 5001,
        completion_status: "complete",
        completion_work: "none",
        error: null,
        created_at: "2026-04-04T00:00:20.000Z"
      }
    ])
  });

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/status/4801`);
    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.queue.totalStories, 3);
    assert.equal(payload.queue.currentPosition, 2);
    assert.equal(payload.queue.currentItem.storyId, 1302);
    assert.equal(payload.completedSteps[0].storyId, 1301);
    assert.equal(payload.completedSteps[0].storyTitle, "Story 1301");
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

  let executeAutomatedStoryRunCalls = 0;
  const harness = createServerHarness({
    executeAutomatedStoryRun: async (input) => {
      executeAutomatedStoryRunCalls += 1;
      if (executeAutomatedStoryRunCalls === 1) {
        await firstStoryGate.promise;
      }
      return {
        storyContext: {
          story_id: Number(input.storyId),
          story_name: `Story ${input.storyId}`,
          story_description: "Do work"
        },
        prompt: `Story ${input.storyId} prompt`,
        runId: 800 + executeAutomatedStoryRunCalls,
        responsePayload: {
          completion_status: "complete",
          completion_work: "none"
        },
        completionStatus: "complete",
        completionWork: "none"
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

    assert.equal(executeAutomatedStoryRunCalls, 1);

    const statusResponse = await fetch(`${baseUrl}/api/automation/status/${automationRunId}`);
    assert.equal(statusResponse.status, 200);
    const statusPayload = await statusResponse.json();
    assert.equal(statusPayload.finalResult.status, "stopped");
    assert.equal(statusPayload.finalResult.stopReason, "manual_stop");
  });
});

test("resume endpoint restarts stopped automation from remaining persisted queue items", async () => {
  const harness = createServerHarness();
  harness.automationRuns.set(4401, {
    id: 4401,
    automation_type: "feature",
    target_id: 100,
    project_name: "demo-project",
    base_branch: "main",
    stop_on_incomplete: 0,
    stop_flag: 1,
    current_position: 2,
    automation_status: "stopped",
    stop_reason: "manual_stop",
    created_at: "2026-04-04T00:00:00.000Z",
    updated_at: "2026-04-04T00:02:00.000Z"
  });

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/resume/4401`, {
      method: "POST"
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.launchMode, "resume");
    assert.equal(payload.automationRun.id, 4401);
    assert.equal(payload.automationRun.status, "running");
    assert.equal(payload.queue.totalStories, 1);
    assert.deepEqual(payload.queue.storyIds, [302]);
    assert.equal(payload.queue.totalStoriesInRunQueue, 2);
    assert.equal(payload.queue.skippedCompletedStories, 1);
  });

  await harness.runDetachedTasks();
  assert.deepEqual(
    harness.calls.executeAutomatedStoryRun.map((call) => call.storyId),
    [302]
  );
});

test("resume endpoint honors persisted queue position ordering when snapshot rows are unsorted", async () => {
  const harness = createServerHarness({
    getAutomationRunQueueItemsByRunId: async () => ([
      {
        id: 13,
        automationRunId: 5501,
        positionInQueue: 3,
        featureId: 100,
        featureTitle: "Feature 100",
        epicId: 201,
        epicTitle: "Epic 201",
        storyId: 903,
        storyTitle: "Story 903",
        storyDescription: "Third story",
        storyCreatedAt: "2026-01-01T10:03:00.000Z",
        createdAt: "2026-04-04T00:00:00.000Z"
      },
      {
        id: 11,
        automationRunId: 5501,
        positionInQueue: 1,
        featureId: 100,
        featureTitle: "Feature 100",
        epicId: 201,
        epicTitle: "Epic 201",
        storyId: 901,
        storyTitle: "Story 901",
        storyDescription: "First story",
        storyCreatedAt: "2026-01-01T10:01:00.000Z",
        createdAt: "2026-04-04T00:00:00.000Z"
      },
      {
        id: 12,
        automationRunId: 5501,
        positionInQueue: 2,
        featureId: 100,
        featureTitle: "Feature 100",
        epicId: 201,
        epicTitle: "Epic 201",
        storyId: 902,
        storyTitle: "Story 902",
        storyDescription: "Second story",
        storyCreatedAt: "2026-01-01T10:02:00.000Z",
        createdAt: "2026-04-04T00:00:00.000Z"
      }
    ]),
    getAutomationStoryExecutionsByRunId: async () => ([
      {
        id: 401,
        automation_run_id: 5501,
        story_id: 901,
        position_in_queue: 1,
        execution_status: "completed",
        queue_action: "advanced",
        run_id: 7001,
        completion_status: "complete",
        completion_work: "none",
        error: null,
        created_at: "2026-04-04T00:00:30.000Z"
      }
    ])
  });
  harness.automationRuns.set(5501, {
    id: 5501,
    automation_type: "feature",
    target_id: 100,
    project_name: "demo-project",
    base_branch: "main",
    stop_on_incomplete: 0,
    stop_flag: 1,
    current_position: 3,
    automation_status: "stopped",
    stop_reason: "manual_stop",
    created_at: "2026-04-04T00:00:00.000Z",
    updated_at: "2026-04-04T00:02:00.000Z"
  });

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/resume/5501`, {
      method: "POST"
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.launchMode, "resume");
    assert.deepEqual(payload.queue.storyIds, [902, 903]);
    assert.equal(payload.queue.totalStoriesInRunQueue, 3);
    assert.equal(payload.queue.skippedCompletedStories, 1);
  });

  await harness.runDetachedTasks();
  assert.deepEqual(
    harness.calls.executeAutomatedStoryRun.map((call) => call.storyId),
    [902, 903]
  );
});

test("resume endpoint rejects overlap when another run is already active for the same target", async () => {
  const harness = createServerHarness();
  harness.automationRuns.set(9001, {
    id: 9001,
    automation_type: "story",
    target_id: 301,
    project_name: "demo-project",
    base_branch: "main",
    stop_on_incomplete: 0,
    stop_flag: 1,
    current_position: 1,
    automation_status: "stopped",
    stop_reason: "manual_stop",
    created_at: "2026-04-04T00:00:00.000Z",
    updated_at: "2026-04-04T00:02:00.000Z"
  });
  harness.automationRuns.set(9002, {
    id: 9002,
    automation_type: "story",
    target_id: 301,
    project_name: "demo-project",
    base_branch: "main",
    stop_on_incomplete: 0,
    stop_flag: 0,
    current_position: 1,
    automation_status: "running",
    stop_reason: null,
    created_at: "2026-04-04T00:03:00.000Z",
    updated_at: "2026-04-04T00:03:00.000Z"
  });

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/resume/9001`, {
      method: "POST"
    });

    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.errorType, "automation_target_conflict");
    assert.equal(payload.conflict.automationRunId, 9002);
    assert.equal(payload.conflict.automationType, "story");
    assert.equal(payload.conflict.targetId, 301);
  });

  assert.equal(harness.calls.detachedTasks.length, 0);
});

test("resume endpoint validates persisted branch exists before restarting queue", async () => {
  const harness = createServerHarness({
    listLocalBranches: async () => ({ branches: ["main"], currentBranch: "main" })
  });
  harness.automationRuns.set(9101, {
    id: 9101,
    automation_type: "feature",
    target_id: 100,
    project_name: "demo-project",
    base_branch: "release/missing",
    stop_on_incomplete: 0,
    stop_flag: 1,
    current_position: 2,
    automation_status: "stopped",
    stop_reason: "manual_stop",
    created_at: "2026-04-04T00:00:00.000Z",
    updated_at: "2026-04-04T00:02:00.000Z"
  });

  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/automation/resume/9101`, {
      method: "POST"
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /Invalid base branch 'release\/missing'/);
  });

  assert.equal(harness.calls.detachedTasks.length, 0);
});
