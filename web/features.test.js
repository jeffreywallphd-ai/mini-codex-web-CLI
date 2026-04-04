const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FEATURES_JS_PATH = path.resolve(__dirname, "features.js");

function readFeaturesScript() {
  return fs.readFileSync(FEATURES_JS_PATH, "utf8");
}

test("feature automation button starts feature-scoped automation endpoint", () => {
  const source = readFeaturesScript();

  assert.match(
    source,
    /fetch\(`\/api\/automation\/start\/feature\/\$\{encodeURIComponent\(String\(featureId\)\)\}`,\s*\{\s*method:\s*"POST"/m
  );
  assert.match(source, /automationType:\s*"feature"/);
  assert.match(source, /targetId:\s*featureId/);
  assert.match(source, /featureId/);
  assert.match(source, /contextBundleId/);
  assert.match(
    source,
    /assertAutomationStartScope\(result,\s*\{\s*automationType:\s*"feature",\s*targetId:\s*feature\.id\s*\}\);/m
  );
});

test("epic automation button starts epic-scoped automation endpoint with epic identifier", () => {
  const source = readFeaturesScript();

  assert.match(
    source,
    /fetch\(`\/api\/automation\/start\/epic\/\$\{encodeURIComponent\(String\(epicId\)\)\}`,\s*\{\s*method:\s*"POST"/m
  );
  assert.match(source, /automationType:\s*"epic"/);
  assert.match(source, /targetId:\s*epicId/);
  assert.match(source, /epicId/);
  assert.match(
    source,
    /const result = await startEpicAutomation\(epic\.id,\s*\{\s*stopOnIncompleteStory:\s*stopOnIncompleteCheckbox\.checked,\s*contextBundleId:\s*selectedContextBundleId\s*\}\);/m
  );
  assert.match(
    source,
    /assertAutomationStartScope\(result,\s*\{\s*automationType:\s*"epic",\s*targetId:\s*epic\.id\s*\}\);/m
  );
});

test("story automation button starts story-scoped automation endpoint and queues one story", () => {
  const source = readFeaturesScript();

  assert.match(
    source,
    /fetch\(`\/api\/automation\/start\/story\/\$\{encodeURIComponent\(String\(storyId\)\)\}`,\s*\{\s*method:\s*"POST"/m
  );
  assert.match(source, /automationType:\s*"story"/);
  assert.match(source, /targetId:\s*storyId/);
  assert.match(source, /storyId/);
  assert.match(source, /const selectedContextBundleId = parseSelectedContextBundleId\(contextBundleSelect\.value\);/);
  assert.match(
    source,
    /assertAutomationStartScope\(result,\s*\{\s*automationType:\s*"story",\s*targetId:\s*story\.id,\s*enforceSingleStory:\s*true\s*\}\);/m
  );
  assert.doesNotMatch(source, /\/api\/stories\/\$\{story\.id\}\/complete-with-automation/);
  assert.match(source, /"Complete with Automation"/);
});

test("frontend validates start response scope alignment before reporting launch", () => {
  const source = readFeaturesScript();

  assert.match(source, /function assertAutomationStartScope\(result,\s*\{\s*automationType,\s*targetId,\s*enforceSingleStory = false\s*\} = \{\}\)/m);
  assert.match(source, /Automation scope mismatch:/);
  assert.match(source, /Automation target mismatch:/);
});

test("frontend formats structured automation validation errors into clear status text", () => {
  const source = readFeaturesScript();

  assert.match(source, /function formatAutomationStartError\(result,\s*fallbackMessage\)/);
  assert.match(source, /const conflictRunId = parseRunId\(result\?\.conflict\?\.automationRunId\);/);
  assert.match(source, /if \(result\?\.errorType === "automation_target_conflict" && conflictRunId\)/);
  assert.match(source, /Active run #\$\{conflictRunId\}/);
  assert.match(source, /const validationErrors = Array\.isArray\(result\?\.validationErrors\) \? result\.validationErrors : \[\];/);
  assert.match(source, /validationErrors\s*\.slice\(0,\s*3\)/m);
  assert.match(source, /throw new Error\(formatAutomationStartError\(result,\s*"Unable to start feature automation\."\)\);/);
  assert.match(source, /throw new Error\(formatAutomationStartError\(result,\s*"Unable to start epic automation\."\)\);/);
  assert.match(source, /throw new Error\(formatAutomationStartError\(result,\s*"Unable to start story automation\."\)\);/);
});

test("feature card automation UI keeps existing card copy and eligibility affordance", () => {
  const source = readFeaturesScript();

  assert.match(source, /button\.textContent\s*=\s*isActiveFeatureRun \|\| isFeatureStartInFlight\s*\?\s*"Automation Running\.\.\."\s*:\s*"Complete with Automation"/m);
  assert.match(source, /"Stop Run For Incomplete Stories"/);
  assert.match(source, /function getAutomationIneligibleHint\(entityType,\s*summary = \{\}\)/);
  assert.match(source, /Automation unavailable: this \$\{label\} has no stories to automate\./);
  assert.match(source, /Automation unavailable: all stories in this \$\{label\} are already complete\./);
});

test("epic card automation UI adds complete-with-automation control and status summary", () => {
  const source = readFeaturesScript();

  assert.match(source, /function createEpicAutomationUi\(content,\s*epic\)/);
  assert.match(source, /getAutomationIneligibleHint\("epic",\s*epicEligibilitySummary\)/);
  assert.match(source, /createEpicAutomationStatusSummary\(content,\s*epic\);/);
  assert.match(source, /button\.textContent\s*=\s*isActiveEpicRun \|\| isEpicStartInFlight\s*\?\s*"Automation Running\.\.\."\s*:\s*"Complete with Automation"/m);
  assert.match(source, /stopRunForIncompleteStoriesByEpicId\.get\(epic\.id\)/);
  assert.match(source, /"Stop Run For Incomplete Stories"/);
});

test("automation start controls guard duplicate starts per target while preserving lightweight scope", () => {
  const source = readFeaturesScript();

  assert.match(source, /const featureAutomationStartInFlight = new Set\(\);/);
  assert.match(source, /const epicAutomationStartInFlight = new Set\(\);/);
  assert.match(source, /const storyAutomationInFlight = new Set\(\);/);
  assert.match(source, /if \(featureAutomationStartInFlight\.has\(feature\.id\)\)/);
  assert.match(source, /if \(epicAutomationStartInFlight\.has\(epic\.id\)\)/);
  assert.match(source, /if \(storyAutomationInFlight\.has\(story\.id\)\)/);
  assert.match(source, /featureAutomationStartInFlight\.add\(feature\.id\);/);
  assert.match(source, /epicAutomationStartInFlight\.add\(epic\.id\);/);
  assert.match(source, /storyAutomationInFlight\.add\(story\.id\);/);
  assert.match(source, /featureAutomationStartInFlight\.delete\(feature\.id\);/);
  assert.match(source, /epicAutomationStartInFlight\.delete\(epic\.id\);/);
  assert.match(source, /storyAutomationInFlight\.delete\(story\.id\);/);
  assert.match(source, /"Feature automation start is already being requested for this feature\."/);
  assert.match(source, /"Epic automation start is already being requested for this epic\."/);
  assert.match(source, /"Story automation start is already being requested for this story\."/);
});

test("feature card shows compact automation status summary with required states and fallback", () => {
  const source = readFeaturesScript();

  assert.match(source, /function getFeatureAutomationStatus\(/);
  assert.match(source, /if \(rawStatus === "running"\) return "running";/);
  assert.match(source, /if \(rawStatus === "completed"\) return "completed";/);
  assert.match(source, /if \(rawStatus === "stopped"\) return "stopped";/);
  assert.match(source, /if \(rawStatus === "failed"\) return "failed";/);
  assert.match(source, /return "not_started";/);
  assert.match(source, /className = "feature-automation-status-row"/);
  assert.match(source, /className = `automation-status-pill automation-status-pill--\$\{status\}`/);
  assert.match(source, /createFeatureAutomationStatusSummary\(content, feature\);/);
});

test("story card automation UI stays lightweight without story-level stop-on-incomplete toggle", () => {
  const source = readFeaturesScript();

  assert.match(source, /function createStoryAutomationUi\(content,\s*story\)/);
  assert.match(source, /function createStoryAutomationStatusSummary\(content,\s*story\)/);
  assert.match(source, /function getStoryAutomationStatus\(story\)/);
  assert.match(source, /if \(rawStatus === "running"\) return "running";/);
  assert.match(source, /if \(rawStatus === "completed"\) return "completed";/);
  assert.match(source, /if \(rawStatus === "stopped"\) return "stopped";/);
  assert.match(source, /if \(rawStatus === "failed"\) return "failed";/);
  assert.match(source, /createStoryAutomationStatusSummary\(content,\s*story\);/);
  assert.match(source, /className = `automation-status-pill automation-status-pill--\$\{status\}`/);
  assert.match(source, /return "not_started";/);
  assert.doesNotMatch(source, /Stop Merge if Story Implementation is Incomplete/);
});

test("frontend story eligibility mirrors backend completion normalization", () => {
  const source = readFeaturesScript();

  assert.match(source, /function normalizeStoryCompletionStatus\(story = \{\}\)/);
  assert.match(source, /const rawStatus = story\?\.COMPLETION_STATUS/);
  assert.match(source, /story\?\.completion_status/);
  assert.match(source, /story\?\.run_completion_status/);
  assert.match(source, /function isStoryEligibleForAutomation\(story\)/);
  assert.match(source, /return normalizeStoryCompletionStatus\(story\) !== "complete";/);
  assert.match(source, /function getAutomationEligibleStorySummary\(stories = \[\]\)/);
  assert.match(source, /eligibleStoryCount = normalizedStories\.filter\(\(story\) => isStoryEligibleForAutomation\(story\)\)\.length/);
  assert.match(source, /"Automation unavailable: this story is already complete\."/);
});

test("automation status summaries show persisted stop reasons for failure, incomplete stop, and manual stop", () => {
  const source = readFeaturesScript();

  assert.match(source, /function getAutomationStopReasonSummary\(stopReason\)/);
  assert.match(source, /if \(normalizedReason === "execution_failed"\)/);
  assert.match(source, /if \(normalizedReason === "story_incomplete"\)/);
  assert.match(source, /if \(normalizedReason === "manual_stop"\)/);
  assert.match(source, /Stopped because a story execution failed\./);
  assert.match(source, /Stopped because an incomplete story was found with stop-on-incomplete enabled\./);
  assert.match(source, /Stopped because a manual stop was requested\./);
  assert.match(source, /if \(status !== "stopped" && status !== "failed"\)/);
  assert.match(source, /if \(!summary\)/);
  assert.match(source, /row\.textContent = `Stop reason: \$\{summary\}`;/);
  assert.match(source, /stopReason: feature\?\.feature_automation_stop_reason/);
  assert.match(source, /stopReason: epic\?\.epic_automation_stop_reason/);
  assert.match(source, /stopReason: story\?\.story_automation_stop_reason/);
});

test("automation summaries render current executing story from backend status payload", () => {
  const source = readFeaturesScript();

  assert.match(source, /function getCurrentExecutingStorySummary\(automationType,\s*targetId\)/);
  assert.match(source, /const currentItem = globalAutomationStatus\?\.queue\?\.currentItem;/);
  assert.match(source, /if \(String\(activeRun\.status \|\| ""\)\.toLowerCase\(\) !== "running"\)/);
  assert.match(source, /row\.textContent = `Current story: \$\{summary\}`;/);
  assert.match(source, /appendCurrentExecutingStoryLine\(content,\s*"feature",\s*feature\?\.id\);/);
  assert.match(source, /appendCurrentExecutingStoryLine\(content,\s*"epic",\s*epic\?\.id\);/);
  assert.match(source, /createRunDetailsLink\(linkedRunId,\s*"Run details"\)/);
});

test("automation summaries display associated context bundle for traceability", () => {
  const source = readFeaturesScript();

  assert.match(source, /function normalizeAutomationBundleAssociation\(contextBundleId,\s*contextBundleTitle\)/);
  assert.match(source, /function resolveAutomationBundleAssociation\(automationType,\s*targetId,\s*fallback = \{\}\)/);
  assert.match(source, /function appendAutomationBundleAssociationLine\(content,\s*\{ status,\s*automationType,\s*targetId,\s*fallback \} = \{\}\)/);
  assert.match(source, /row\.textContent = `Context bundle: \$\{bundleLabel\}`;/);
  assert.match(source, /row\.textContent = "Context bundle: none";/);
  assert.match(source, /contextBundleId: feature\?\.feature_automation_context_bundle_id,/);
  assert.match(source, /contextBundleTitle: feature\?\.feature_automation_context_bundle_title/);
  assert.match(source, /contextBundleId: epic\?\.epic_automation_context_bundle_id,/);
  assert.match(source, /contextBundleTitle: epic\?\.epic_automation_context_bundle_title/);
  assert.match(source, /contextBundleId: story\?\.story_automation_context_bundle_id,/);
  assert.match(source, /contextBundleTitle: story\?\.story_automation_context_bundle_title/);
});

test("frontend polls automation status endpoint using active backend automation run id", () => {
  const source = readFeaturesScript();

  assert.match(source, /async function loadAutomationStatus\(\)/);
  assert.match(source, /const activeRunId = Number\.parseInt\(globalAutomationLock\?\.automationRunId,\s*10\);/);
  assert.match(source, /const persistedRunId = parsePersistedAutomationRunId\(automationScope\);/);
  assert.match(source, /const runId = Number\.isInteger\(activeRunId\) && activeRunId > 0\s*\?\s*activeRunId\s*:\s*persistedRunId;/m);
  assert.match(source, /fetch\(`\/api\/automation\/status\/\$\{encodeURIComponent\(String\(runId\)\)\}`\)/);
  assert.match(source, /globalAutomationStatus = result;/);
  assert.match(source, /await loadAutomationLock\(\);\s*await loadAutomationStatus\(\);\s*renderFeatureLists\(\);/m);
});

test("feature automation UI persists latest run id and cached status for refresh recovery", () => {
  const source = readFeaturesScript();

  assert.match(source, /const AUTOMATION_UI_STATE_KEY = "mini-codex-feature-automation-ui-state";/);
  assert.match(source, /function parsePersistedAutomationRunId\(scope = automationScope\)/);
  assert.match(source, /function hydrateAutomationStatusFromPersistence\(\)/);
  assert.match(source, /const statusSnapshot = persistedState\.lastAutomationStatus;/);
  assert.match(source, /globalAutomationStatus = statusSnapshot;/);
  assert.match(source, /persistAutomationStateSnapshot\(automationScope,\s*\{\s*lastAutomationRunId:\s*activeRunId\s*\}\);/m);
  assert.match(source, /persistAutomationStateSnapshot\(statusScope,\s*\{\s*lastAutomationRunId:\s*statusRunId,\s*lastAutomationStatus:\s*result\s*\}\);/m);
  assert.match(source, /hydrateAutomationStatusFromPersistence\(\);\s*renderScopeHint\(\);\s*renderFeatureLists\(\);/m);
});

test("automation status and history expose run-details links with graceful fallback", () => {
  const source = readFeaturesScript();

  assert.match(source, /function createRunDetailsLink\(runId,\s*label = "View run details"\)/);
  assert.match(source, /link\.href = `\/run-details\.html\?id=\$\{encodeURIComponent\(String\(runId\)\)\}`;/);
  assert.match(source, /unavailable\.textContent = "Run details unavailable";/);
  assert.match(source, /function appendAutomationExecutionHistory\(content,\s*automationType,\s*targetId\)/);
  assert.match(source, /heading\.textContent = "Recent story runs:";/);
  assert.match(source, /storyTitle: String\(item\?\.storyTitle \|\| ""\)\.trim\(\) \|\| null,/);
  assert.match(source, /error: String\(item\?\.error \|\| ""\)\.trim\(\) \|\| null/);
  assert.match(source, /appendRunDetailsInline\(line,\s*item\.runId\);/);
  assert.match(source, /errorLine\.textContent = `Failure reason: \$\{item\.error\}`;/);
  assert.match(source, /appendAutomationExecutionHistory\(content,\s*"feature",\s*feature\?\.id\);/);
  assert.match(source, /appendAutomationExecutionHistory\(content,\s*"epic",\s*epic\?\.id\);/);
  assert.match(source, /appendAutomationExecutionHistory\(content,\s*"story",\s*story\?\.id\);/);
});

test("story cards link associated runs to run-details page", () => {
  const source = readFeaturesScript();

  assert.match(source, /function appendStoryRunLinkLine\(content,\s*story,\s*\{ includeLabel = true \} = \{\}\)/);
  assert.match(source, /appendRunDetailsInline\(row,\s*story\?\.run_id\);/);
  assert.match(source, /appendStoryRunLinkLine\(content,\s*story\);/);
});

test("feature/epic/story automation controls support explicit resume mode from persisted run id", () => {
  const source = readFeaturesScript();

  assert.match(source, /async function resumeAutomationRun\(automationRunId,\s*options = \{\}\)/);
  assert.match(source, /body:\s*JSON\.stringify\(\{\s*contextBundleId\s*\}\)/m);
  assert.match(source, /fetch\(`\/api\/automation\/resume\/\$\{encodeURIComponent\(String\(normalizedRunId\)\)\}`,\s*\{\s*method:\s*"POST"/m);
  assert.match(source, /button\.textContent = isActiveFeatureRun \|\| isFeatureStartInFlight[\s\S]*"Resume Automation" : "Complete with Automation"/m);
  assert.match(source, /button\.textContent = isActiveEpicRun \|\| isEpicStartInFlight[\s\S]*"Resume Automation" : "Complete with Automation"/m);
  assert.match(source, /automationButton\.textContent = isStoryStartInFlight \|\| isActiveStoryRun[\s\S]*"Resume Automation" : "Complete with Automation"/m);
  assert.match(source, /const isResumeLaunch = String\(result\?\.launchMode \|\| ""\)\.toLowerCase\(\) === "resume";/);
});

test("feature page automation controls include a single-bundle selector loaded from context bundle API", () => {
  const source = readFeaturesScript();

  assert.match(source, /function createAutomationContextBundleSelector\(\{ idPrefix, automationLabel, disabled = false \} = \{\}\)/);
  assert.match(source, /defaultOption\.textContent = "No context bundle";/);
  assert.match(source, /fetch\("\/api\/context-bundles\?includeParts=false"\)/);
  assert.match(source, /await loadAutomationContextBundles\(\);/);
  assert.match(source, /createAutomationContextBundleSelector\(\{\s*idPrefix:\s*`feature-\$\{feature\.id\}`,\s*automationLabel:\s*"feature"/m);
  assert.match(source, /createAutomationContextBundleSelector\(\{\s*idPrefix:\s*`epic-\$\{epic\.id\}`,\s*automationLabel:\s*"epic"/m);
  assert.match(source, /createAutomationContextBundleSelector\(\{\s*idPrefix:\s*`story-\$\{story\.id\}`,\s*automationLabel:\s*"story"/m);
});

test("feature page syncs open cards with active queue story and auto-collapses completed nodes", () => {
  const source = readFeaturesScript();

  assert.match(source, /function syncAutomationDrivenCardState\(\)/);
  assert.match(source, /openCards\.add\(`feature:\$\{activeStory\.featureId\}`\);/);
  assert.match(source, /openCards\.add\(`epic:\$\{activeStory\.epicId\}`\);/);
  assert.match(source, /openCards\.add\(`story:\$\{activeStory\.storyId\}`\);/);
  assert.match(source, /openCards\.delete\(`story:\$\{storyId\}`\);/);
  assert.match(source, /if \(isEpicComplete\(epic\)\) \{\s*openCards\.delete\(`epic:\$\{epic\.id\}`\);/m);
  assert.match(source, /removeFeatureDescendantOpenCards\(activeRun\.targetId\);/);
});

test("feature page shows active story elapsed time and fixed-size running command box", () => {
  const source = readFeaturesScript();

  assert.match(source, /function appendActiveStoryRuntime\(content,\s*story\)/);
  assert.match(source, /Time elapsed: \$\{elapsedText\}/);
  assert.match(source, /commandBox\.className = "active-story-command-box";/);
  assert.match(source, /commandBox\.textContent = activeStory\.runningCodexCommand \|\| "Waiting for command output\.\.\.";/);
  assert.match(source, /setInterval\(\(\) => \{\s*refreshActiveStoryRuntimeIndicators\(\);\s*\}, 1000\);/m);
  assert.match(source, /card\.scrollIntoView\(\{ block: "start", behavior: "smooth" \}\);/);
});

test("feature page refresh reloads tree data so completion pills update without manual browser refresh", () => {
  const source = readFeaturesScript();

  assert.match(source, /async function refreshAutomationState\(\)/);
  assert.match(source, /await loadFeatures\(\{ shouldRender: false \}\);/);
  assert.match(source, /renderFeatureLists\(\);/);
});

test("automation stop reason summary includes merge failure guidance", () => {
  const source = readFeaturesScript();

  assert.match(source, /if \(normalizedReason === "merge_failed"\)/);
  assert.match(source, /Stopped because a story auto-merge failed\./);
  assert.match(source, /Automation stopped due to an auto-merge failure/);
});
