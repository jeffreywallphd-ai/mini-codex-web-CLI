const test = require("node:test");
const assert = require("node:assert/strict");

const { createAutomatedStoryRunExecutor } = require("./automatedStoryRunPipeline");

test("automated story runner reuses existing run flow and links run to story", async () => {
  const calls = {
    getStoryAutomationContext: [],
    executeRunFlow: [],
    attachRunToStory: []
  };

  const executeAutomatedStoryRun = createAutomatedStoryRunExecutor({
    getStoryAutomationContext: async (storyId, scope) => {
      calls.getStoryAutomationContext.push({ storyId, scope });
      return {
        story_id: storyId,
        story_name: "Story A",
        story_description: "Implement A",
        epic_name: "Epic A",
        feature_name: "Feature A"
      };
    },
    executeRunFlow: async (input) => {
      calls.executeRunFlow.push(input);
      return {
        runId: 42,
        responsePayload: {
          completion_status: "complete",
          completion_work: "none"
        }
      };
    },
    attachRunToStory: async (storyId, runId) => {
      calls.attachRunToStory.push({ storyId, runId });
    }
  });

  const result = await executeAutomatedStoryRun({
    storyId: 12,
    projectName: "demo-project",
    baseBranch: "main",
    executionMode: "write",
    streamId: "stream-1"
  });

  assert.equal(calls.getStoryAutomationContext.length, 1);
  assert.deepEqual(calls.getStoryAutomationContext[0], {
    storyId: 12,
    scope: {
      projectName: "demo-project",
      baseBranch: "main"
    }
  });

  assert.equal(calls.executeRunFlow.length, 1);
  assert.equal(calls.executeRunFlow[0].projectName, "demo-project");
  assert.equal(calls.executeRunFlow[0].baseBranch, "main");
  assert.equal(calls.executeRunFlow[0].executionMode, "write");
  assert.equal(calls.executeRunFlow[0].streamId, "stream-1");
  assert.match(calls.executeRunFlow[0].prompt, /Story A/);

  assert.deepEqual(calls.attachRunToStory, [{ storyId: 12, runId: 42 }]);
  assert.equal(result.runId, 42);
  assert.equal(result.completionStatus, "complete");
  assert.equal(result.completionWork, "none");
});

test("automated story runner throws prompt_generation_failed when prompt build fails", async () => {
  const executeAutomatedStoryRun = createAutomatedStoryRunExecutor({
    getStoryAutomationContext: async () => ({
      story_id: 1,
      story_name: "Story Missing Description",
      story_description: ""
    }),
    executeRunFlow: async () => ({ runId: 1, responsePayload: {} }),
    attachRunToStory: async () => {}
  });

  await assert.rejects(
    () => executeAutomatedStoryRun({
      storyId: 1,
      projectName: "demo-project",
      baseBranch: "main"
    }),
    (error) => error && error.code === "prompt_generation_failed"
  );
});

test("automated story runner throws when story is missing from scoped project context", async () => {
  const executeAutomatedStoryRun = createAutomatedStoryRunExecutor({
    getStoryAutomationContext: async () => null,
    executeRunFlow: async () => ({ runId: 1, responsePayload: {} }),
    attachRunToStory: async () => {}
  });

  await assert.rejects(
    () => executeAutomatedStoryRun({
      storyId: 999,
      projectName: "demo-project",
      baseBranch: "main"
    }),
    /Story #999 was not found/
  );
});
