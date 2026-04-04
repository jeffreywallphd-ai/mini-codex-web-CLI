# Mini Codex Web CLI

A lightweight LAN-first web interface for running Codex CLI from a desktop PC and controlling it from a mobile browser on the same local network.

## Overview

Mini Codex Web CLI keeps the workflow intentionally small:

- pick a local repository that lives on the LAN host machine
- choose a Codex execution mode
- create an isolated working branch before each run
- send a prompt to Codex via `@openai/codex-sdk`
- review that single run on its own details page
- optionally merge the generated branch back into `main`

The app is designed for personal LAN use, not for public internet exposure or multi-user hosting.

## Features

- Repository picker for local Git repositories
- One-tap `git pull` action for the currently selected repository on the index page
- Codex execution mode selector with Read Mode and Write Mode (SDK thread options use `workspace-write` sandboxing and `on-failure` approvals in write mode)
- Automatic branch creation from `main` before every run using `codex-<10 hex chars>` naming
- Dedicated run details page for each prompt run
- Git status display and one-tap merge action from the run details page
- Recent run history with search
- Basic usage tracking when the SDK returns usage data
- Automation queue generation utilities for deterministic `feature -> epic -> story` ordering
- Automation metadata persistence for orchestration state (`automation_type`, `target_id`, `project_name`, `base_branch`, `stop_on_incomplete`, `stop_flag`, `current_position`, `automation_status`, `stop_reason`)
- Automation story execution outcome persistence for status reporting (`automation_story_executions` with run linkage and queue outcome state)
- Automation failure detail persistence at run scope (`failed_story_id`, `failure_summary`) for quick troubleshooting context
- Sequential automation runner for server-driven queue execution (`server/automationRunner.js`)
- Shared queue-position ordering utilities reused by runner/API orchestration (`server/automationQueuePosition.js`)
- Shared automated story run pipeline that reuses manual run creation/execution persistence (`server/automatedStoryRunPipeline.js`)
- Automated run-origin linkage persisted on each run (`automation_origin_type`, `automation_origin_id`, `automation_run_id`) for feature/epic/story traceability
- Context bundle schema + model persistence with ordered multi-part composition (`context_bundles`, `context_bundle_parts`) and reusable metadata (`intended_use`, `tags`, `project_name`, `summary`, `updated_at`)
- Run and automation API payloads include selected context bundle linkage (`context_bundle_id`) and resolved title metadata (`context_bundle_title` / `contextBundleTitle`) for execution traceability
- Index page run form includes an optional single-bundle selector with concise metadata hints (title/intended use/summary) plus a compact selected-bundle summary card (summary/intended use/project affinity) so manual runs can include one bundle or none
- Feature card automation control in **Not Yet Implemented** for launching feature-wide automation (`Complete with Automation`)
- Feature-management automation launch controls (feature/epic/story) include a compact optional single-bundle selector powered by the same context-bundle list API as the index page (`/api/context-bundles?includeParts=false`), and send the selected `contextBundleId` with start/resume requests
- Feature/epic/story automation summaries display concise associated bundle labels (`title` + id when available, or `none`) so active and completed automation context remains transparent in feature-management status views
- Feature/epic/story automation summaries include concise stop reasons for early stops (`execution_failed`, `story_incomplete`, `manual_stop`) when backend state provides one
- SQLite storage with no external database
- Mobile-friendly, lightweight UI intended for LAN access

## Project Structure

```text
mini-codex-web-CLI/
├── server/
├── web/
├── data/
├── .env
└── package.json
```

Your local repositories should live in a separate projects directory referenced by `PROJECTS_DIR`.

## Prerequisites

- Node.js 18+
- npm
- Git available on the machine that runs this server
- Codex SDK installed with the app dependencies (`@openai/codex-sdk`), which launches the local Codex CLI binary bundled by `@openai/codex`

## Installation

1. Clone this repository.
2. Run `npm install`.
3. Create a `.env` file in the project root:

   ```env
   CODEX_API_KEY=your_api_key_here
   PORT=3000
   PROJECTS_DIR=../../projects
   ```

4. Make sure `PROJECTS_DIR` points at the folder containing the local repositories you want to expose in the UI.
5. Keep `.env` out of version control.
6. If you receive errors about the environment being read-only, you will need to find the /.codex/config.toml file (possibly in Users/[youruser]/.codex). If the file doesn't exist, create it. On Windows add the following two lines:
[windows]
sandbox = "elevated"

## Running the Application

Start the server:

```bash
npm run dev
```

or:

```bash
npm start
```

Open the UI from the host machine:

```text
http://localhost:3000
```

Or from another device on the same LAN:

```text
http://192.168.x.x:3000
```

## Usage Flow

1. Select a repository.
2. Optionally click **Git Pull Selected Repo** to fetch and integrate the latest remote changes on the repository's current branch.
3. Select Read Mode for a standard Codex SDK turn, or Write Mode to run with `workspace-write` sandboxing plus `on-failure` approvals through the SDK.
4. Enter a prompt.
5. Optionally select one context bundle (or leave **No context bundle**) in the run form.
6. Click **Run**.
7. The server checks out local `main`, creates a new `codex-xxxxxxxxxx` branch, then runs Codex in the selected mode.
8. Open the run from **Recent Runs** to review output, git status, and merge controls.
9. Click **Merge Changes** on the run details page when you want to merge that branch into `main`.

## Git Behavior

- Every run starts from the repository's local `main` branch.
- The index page can run `git pull` against the selected repository before starting a Codex run.
- The app creates a new branch named `codex-<10 hex chars>`.
- Codex executes only after the branch checkout succeeds.
- The run details page shows the stored `git status --short --branch` output.
- Merge runs are performed by the server with Git and recorded in SQLite.
- If a merge succeeds, the merge button is disabled for that run.

## Context Bundles

Context bundles are persisted with a parent-child data model in SQLite:

- `context_bundles` stores bundle-level metadata (`title`, `description`, `status`) plus optional reuse/selection metadata (`intended_use`, `tags`, `project_name`, `summary`) and freshness timestamps (`updated_at`, `created_at`), with nullable extensibility fields (`token_estimate`, `is_active`, `last_used_at`).
- `context_bundle_parts` stores ordered bundle parts linked by `bundle_id` with explicit `position`, semantic fields (`part_type`, `title`, `content`), optional authoring metadata (`instructions`, `notes`), and inclusion flags (`include_in_compiled`, `include_in_preview`).
- `part_type` is a controlled server-validated value (centralized in `server/contextBundlePartTypes.js`) with this canonical set:
  - `repository_context`
  - `architecture_guidance`
  - `coding_standards`
  - `documentation_standards`
  - `domain_glossary`
  - `implementation_constraints`
  - `testing_expectations`
  - `feature_background`
  - `user_notes`
- Bundle part records include `part_type_label` in model responses so UI surfaces can display the selected type with a stable human-readable label.
- Ordering is deterministic and explicit (`position`) rather than inferred from creation order.
- Validation is centralized in `server/contextBundleValidation.js` and enforced from bundle/part persistence helpers before writes:
  - bundle `title` and `description` are required and length-limited
  - part `part_type`, `title`, `content`, and `position` are validated, including content-size limits
  - part ordering must be unique within each bundle (`position` cannot collide)
  - validation failures return frontend-friendly payloads (`error` + `validationErrors[]`) from context bundle API routes
- Bundle and part CRUD persistence is implemented in `server/db.js` with migration-backed schema evolution (no reset required).
- Bundle metadata authoring UI is available at `/context-bundles.html` and supports in-page create/edit/delete flows for bundle title + description, metadata display for `intended_use`, `tags`, `project_name`, `summary`, and `updated_at`, plus clear validation feedback when required fields are missing.
- Bundle list cards and the selected-bundle detail panel surface `intended_use` + `summary` with lightweight selection guidance copy; the fields remain optional but the UI encourages concise summary text and explicit intended use to improve bundle selection clarity.
- Saved bundle cards include maintenance actions for `Edit Bundle`, `Duplicate Bundle`, and `Delete Bundle`; duplicate clones the bundle plus all ordered parts into a new `(Copy)` bundle, and delete is confirmation-protected to reduce accidental removal.
- Bundle authoring UI includes explicit bundle-part card management for state-of-the-art context composition: add multiple parts, edit type/title/content, toggle include-in-compiled output, remove parts, and reorder deterministically with move up/down controls.
- Bundle authoring UI includes an in-page **Compiled Preview** panel that renders `/api/context-bundles/:bundleId/preview` output in monospaced formatting, with manual refresh and clean error messaging so users can inspect the exact saved compiled context before runs.
- Bundle preview payloads are available from the API and include deterministic part ordering, section labels, explicit instruction/constraint/reference boundaries, and a compiled context string so the UI can render the exact run-context shape before execution.
- Bundle compilation is centralized in `server/contextBundleCompilation.js`; outputs include `compiledText`/`compiledString`, ordered part id metadata, type-aware grouping metadata (`typeGroups`), and compilation section groups (`compilationGroups`) that layer content under standard headings: `Implementation Constraints`, `Architecture Guidance`, `Documentation Standards`, `Background Context`, and `Glossary`.
- Bundle compilation now includes lightweight size awareness metadata (`sizeEstimate`, `partSizeEstimates`, `compilerNotes`) using approximate character and token estimates (default approximation: 4 characters per token) so oversized context can be surfaced before execution.
- Bundle compilation now includes simple context-quality advisory warnings (`qualityWarnings`, `qualityWarningSummary`) for common issues such as missing high-value sections, low-signal parts, duplicate/near-duplicate content, potential contradictory directives, and oversized bundle estimates; warnings are previewed in the authoring UI and are non-blocking unless data is clearly invalid.
- Optional compile limits (`maxCompiledChars` or token-equivalent options) apply deterministic prefix-preserving truncation: higher-priority compilation sections are preserved first, then earlier ordered parts, with explainable truncation metadata (`truncation.preservedPartIds`, `truncation.partiallyTruncatedPartIds`, `truncation.omittedPartIds`).
- Run preparation can now accept an optional `contextBundleId`; when provided, the selected bundle is compiled during run creation using the same `compileContextBundle(...)` path used by preview.
- Run preparation now validates selected bundles before execution starts (manual run and story automation): bundle id shape, bundle existence, and compile-readiness are checked up front; unusable bundles return `errorType: "context_bundle_compile_failed"` with optional `validationErrors[]` for UI rendering.
- The index page manual run form now includes a lightweight single-select context bundle control (`No context bundle` or exactly one saved bundle) that lists bundle title plus concise metadata hints (intended use and summary when available).
- When a bundle is selected on the index page, a compact metadata summary card appears under the selector and updates on selection changes, showing summary/intended use/project affinity with safe `(none)` fallbacks when optional metadata is missing.
- Index and feature-management bundle selectors now surface a non-blocking project-affinity warning when a selected bundle's `project_name` metadata appears mismatched with the current project scope; users can still proceed, and missing metadata does not produce warnings.
- Run and automation records persist nullable `context_bundle_id` linkage so bundle-backed and non-bundle executions remain backward compatible in one explicit model.
- Run and automation APIs surface both bundle id and bundle title metadata (`context_bundle_id` + `context_bundle_title`, and camelCase variants in automation route payloads) so historical runs can be traced to bundle context selection.
- Bundle model responses now include lightweight usage cues (`last_used_at`, `usage_total_count`, `usage_recent_count`, `usage_recent_success_count`) computed from run + automation history without requiring analytics infrastructure.
- Bundle usage metadata (`last_used_at`) is automatically updated after manual/automated runs that use a bundle and when a bundle is attached to an automation run.
- Recent run cards on the index page and run details summaries show concise selected-bundle metadata (bundle title, with id in run details when available) so the context source used for each run remains visible for troubleshooting.
- Bundle selectors and bundle cards now surface lightweight usage cues (last used timestamp and recent successful usage count) to help users quickly differentiate and reuse effective bundles.
- Prompt assembly uses a stable rule: compiled bundle context is injected **before** the task prompt using `bundle_context_before_task_prompt_v1` in `server/runPromptContext.js`.
- The index page includes a **Manage Context Bundles** navigation action that routes to `/context-bundles.html`, making it the central bundle authoring/management page.
- Context bundle API endpoints:
  - `GET /api/context-bundles` (supports `includeParts=false`)
  - `POST /api/context-bundles`
  - `GET /api/context-bundles/:bundleId` (supports `includeParts=false`)
  - `GET /api/context-bundles/:bundleId/preview` (returns `{ bundle, preview }` with deterministic compiled ordering)
  - `PATCH /api/context-bundles/:bundleId`
  - `DELETE /api/context-bundles/:bundleId`
  - `POST /api/context-bundles/:bundleId/duplicate`
  - `GET /api/context-bundles/:bundleId/parts`
  - `GET /api/context-bundles/:bundleId/parts/:partId`
  - `POST /api/context-bundles/:bundleId/parts`
  - `PATCH /api/context-bundles/:bundleId/parts/:partId`
  - `DELETE /api/context-bundles/:bundleId/parts/:partId`

## Automation Queue Planning

Shared automation planning rules are defined in `server/automationQueue.js`.

- `AUTOMATION_SCOPE` defines supported automation levels:
  - `feature`
  - `epic`
  - `story`
- `DEFAULT_AUTOMATION_RULES` defines the stable execution contract used by queue
  planning and stop-evaluation logic:
  - ordering strategy: `original-creation-asc-stable`
  - feature scope includes all stories in all epics for the selected feature
  - epic scope includes all stories in the selected epic
  - story scope includes only the selected story
  - stop controls include:
    - `stopOnExecutionFailure` (default `true`)
    - `stopOnManualStop` (default `true`)
    - `stopOnIncompleteStory` (default `false`, user-configurable "Stop Run For Incomplete Stories")
- `defineAutomationExecutionPlan(features, selection, overrides)` builds a
  scope-aware plan for a selected `automationType` + `targetId`.
- `buildScopedStoryExecutionQueue(features, selection)` returns deterministic
  queues, a flattened list of stories with `positionInQueue`, and
  `queueStatus` (`ready`, `target_not_found`, `empty_queue`, `target_ineligible`, `validation_failed`)
  so invalid/empty/ineligible queue states are surfaced cleanly.
- Queue traversal order is deterministic and stable for both queue planning and
  execution handoff:
  - feature automation processes epics in original creation order
  - feature/epic automation process stories in original creation order within
    each epic
  - tie-breaks use explicit `order` (when present) and then id so ordering does
    not depend on accidental database return order
- Automation eligibility is intentionally simple: a story is eligible when it is
  not marked `complete`; completed stories are filtered out of feature/epic
  queues and story-target automation rejects completed stories.
- Story prompt readiness is validated before queue launch: each runnable story
  must include both story title and story description; otherwise that story is
  excluded and returned in `validationErrors` with missing field details.
- Queue story items include execution/reporting metadata:
  - `automationType`
  - `targetId`
  - `featureId`, `epicId`, `storyId`
  - `featureTitle`, `epicTitle`, `storyTitle`
  - `storyDescription`, `storyCreatedAt`
  - `completionStatus`
- `evaluateAutomationStopCondition(event, rules)` supports these stop outcomes:
  - run complete (`queue_complete` -> `all_work_complete`)
  - execution failure (`execution_failed` -> `execution_failed`)
  - manual stop (`manual_stop` -> `manual_stop`)
  - incomplete story status when enabled (`story_completed` with completion status not `complete` -> `story_incomplete`)
- Story completion status evaluation is normalized from
  `COMPLETION_STATUS`/`completion_status`/`run_completion_status`/`is_complete`
  so stop-on-incomplete behavior is consistent.
- Automation run orchestration metadata is persisted in SQLite table
  `automation_runs` with:
  - `automation_type` (`feature`, `epic`, or `story`)
  - `target_id`
  - `project_name`
  - `base_branch`
  - `stop_on_incomplete`
  - `stop_flag`
  - `current_position`
  - `automation_status` (`pending`, `running`, `completed`, `failed`, or `stopped`)
  - `context_bundle_id` (nullable selected context bundle linkage)
  - `stop_reason` (final outcome reason, such as `all_work_complete`,
    `execution_failed`, or `story_incomplete`)
  - `failed_story_id` (failed story identifier when the run ends in failure)
  - `failure_summary` (compact failure reason captured from the failing step/error path)
- Per-story automation execution outcomes are persisted in SQLite table
  `automation_story_executions` with:
  - `automation_run_id`
  - `story_id`
  - `position_in_queue`
  - `execution_status` (`completed` or `failed`)
  - `queue_action` (`advanced`, `stopped`, or `failed`)
  - `run_id` (linked run when available)
  - `completion_status` and `completion_work` (when available)
  - `error` (actionable failure summary when execution failed, including cause context when available)
- Per-run queue snapshots are persisted in SQLite table
  `automation_run_queue_items` with:
  - `automation_run_id`
  - `position_in_queue`
  - `feature_id`, `feature_title`
  - `epic_id`, `epic_title`
  - `story_id`, `story_title`, `story_description`, `story_created_at`
  This keeps queue composition stable for progress reporting and restart behavior,
  even if feature tree data changes after automation starts.
- Automated runs also persist origin linkage directly in `runs`:
  - `automation_origin_type` (`feature`, `epic`, or `story`)
  - `automation_origin_id` (selected planning entity id)
  - `automation_run_id` (orchestration run id when available)
  This keeps existing run records backward-compatible while allowing frontend
  queries from execution results back to planning scope.

## Automation Execution Runner

`server/automationRunner.js` provides a lightweight sequential queue runner that
is compatible with the existing story run lifecycle.

- `runSequentialStoryQueue({ stories, executeStory, stopOnIncompleteStory, onProgress, onStoryStart })`
  executes queued stories strictly one at a time.
- Story execution order is enforced by `positionInQueue` (ascending, stable
  tie-break by original list index) so execution always matches generated queue
  order, even if story arrays are reloaded in a different order.
- The next story does not start until the current `executeStory` call resolves
  (terminal completion for that run).
- The runner stops when:
  - all queued stories complete (`all_work_complete`)
  - execution throws (`execution_failed`)
  - `stopOnIncompleteStory` is enabled and a story completion status is not
    `complete` (`story_incomplete`)
- Final runner output includes `stopReason` so automation outcomes can be
  persisted and displayed.
- `onProgress` is invoked after each story to support persistence of queue
  progress (for example, updating `automation_runs.current_position`).
- `onStoryStart` is invoked immediately before each queued story begins so
  orchestration can emit lifecycle logs and diagnostics with deterministic queue
  position context.
- `onStoryResult` is invoked after each story with deterministic
  `queueAction` (`advanced`, `stopped`, `failed`) and completion fields so
  each story outcome can be persisted for automation status displays.
- Queue position parsing/sorting is shared with the API layer through
  `server/automationQueuePosition.js`, reducing duplicated ordering logic while
  keeping the implementation dependency-free and small.

## Automated Story Run Pipeline

`server/automatedStoryRunPipeline.js` is the shared integration point between
automation and the existing run pipeline.

- resolves story context in project/branch scope
- builds the story automation prompt
- executes story work via the same `executeRunFlow` path used by manual run
  creation/execution
- persists run output through the standard `runs` table lifecycle and then
  links the run to the story (`attachRunToStory`)
- requires project and base-branch context before execution starts so invalid
  scope is rejected early
- returns normalized completion metadata consumed by queue orchestration

## Automation Start API

`server/automationStartApi.js` exposes minimal endpoints for launching
automation runs by scope:

- `POST /api/automation/start/feature/:featureId`
- `POST /api/automation/start/epic/:epicId`
- `POST /api/automation/start/story/:storyId`
- `POST /api/automation/resume/:automationRunId`
- `POST /api/automation/stop/:automationRunId`
- `GET /api/automation/status/:automationRunId`

Each endpoint:

- validates `projectName` and `baseBranch`
- validates `projectName` maps to a known local project and `baseBranch`
  exists in that repository before queue execution starts
- validates the scoped target exists (`featureId`, `epicId`, or `storyId`)
- validates scope consistency between route and request body when
  `automationType`, `targetId`, or scoped ids are supplied
- validates the selected target is eligible (non-empty runnable queue)
- validates runnable stories include required prompt data before automation starts
- rejects completed targets as ineligible when all scoped stories are already
  complete (prevents accidental re-runs without deliberate action)
- returns `422` with `errorType: "target_ineligible"` plus `queueStatus` when
  a selected feature/epic/story has no eligible not-yet-implemented stories (or
  contains no stories)
- rejects concurrent launches for the same automation target
  (`automationType` + `targetId`) while a run is already `running`, returning a
  frontend-friendly `409` conflict payload
  (`errorType: "automation_target_conflict"` plus `conflict` metadata)
- enforces this safeguard at the database layer with a unique active-target
  index (`idx_automation_runs_active_target`), so overlapping same-target
  launches are rejected even under concurrent request races
- creates an `automation_runs` record with initial state
- initializes a deterministic queue from `defineAutomationExecutionPlan`
- starts background execution using the shared automated story run pipeline
  (`createAutomatedStoryRunExecutor` + `executeRunFlow` + sequential queue runner)
- keeps start/resume launch orchestration in a shared lightweight code path
  (lock activation, detached execution handoff, lifecycle launch logging, and
  launch-response shape) to reduce duplication without adding extra layers
- emits lightweight structured lifecycle logs through `logger.info` for:
  - launch accepted (`start` or `resume`)
  - background automation start
  - story start and story completion
  - stop reason
  - final automation result (including outcome and error context on failures)

Request body fields:

- `projectName` (required)
- `baseBranch` (required)
- `stopOnIncompleteStory` (optional boolean, default `false`)
- `automationType` (optional but validated against route scope when provided)
- `targetId` (optional but validated against route id when provided)
- scoped id field (`featureId`, `epicId`, `storyId`) (optional but validated against route id when provided)
- `contextBundleId` (optional positive integer; when provided, each queued run compiles and injects that bundle into final run prompt context)
- automation execution uses the persisted automation-run bundle selection for every queued story run, so one automation run maps to one bundle context with no per-story bundle override
- automation start/resume requests enforce a single-bundle API shape: `contextBundleId` only (plural/multi-reference payload fields are rejected)
- automation start/resume performs bundle preflight validation before queue launch: missing bundles are rejected with `404` (`errorType: "context_bundle_not_found"`), invalid ids with `400` (`errorType: "context_bundle_invalid_id"`), and compile-usability failures with `422` (`errorType: "context_bundle_compile_failed"` + optional `validationErrors[]`)

Success response (`202 Accepted`) includes tracking metadata for the UI:

- `launchMode` (`start` for fresh launches)
- `automationRun` (id, type, target, status, stop flags, timestamps)
- `automationRun.contextBundleId` (nullable single selected bundle id persisted for this automation run)
- `automationRun.projectName` and `automationRun.baseBranch` for traceability
- `queue` (`totalStories`, `storyIds`, and queue readiness metadata)
- `projectName`
- `baseBranch`

Resume behavior (`POST /api/automation/resume/:automationRunId`):

- accepts only stopped/failed runs and rejects non-resumable statuses (including running/completed)
- accepts optional `contextBundleId` to apply bundle-compiled context to resumed queued story runs
- when resume omits `contextBundleId`, the automation run reuses its persisted `context_bundle_id`; when provided, it replaces that single selection
- uses persisted queue snapshot (`automation_run_queue_items`) plus persisted
  story outcomes (`automation_story_executions`) to compute remaining work
- normalizes persisted queue and execution rows by `position_in_queue` so resume
  order remains deterministic even if storage read order changes
- skips previously completed story executions by default during resume
- restarts the same automation run id in `running` state with updated
  `current_position` and clears prior stop flags/reasons for the resumed pass
- returns `launchMode: "resume"` plus queue summary
  (`totalStoriesInRunQueue`, `skippedCompletedStories`) so UI can clearly show
  that the action is a resume, not a fresh start

Validation failure response (`422 Unprocessable Entity`) is returned when a
target exists but has no runnable stories because required prompt fields are
missing:

- `errorType: "validation_failed"`
- `error` (human-readable summary)
- `queueStatus` (includes `code: "validation_failed"`)
- `validationErrors` (per-story missing prompt field details, including
  automation scope and missing required prompt field names)

Feature Management UI integration:

- incomplete feature cards surface a **Complete with Automation** button
- the feature button starts automation via `POST /api/automation/start/feature/:featureId`
- feature automation requests include explicit scope metadata (`automationType`, `targetId`, `featureId`) so backend scope validation can reject mismatched launches
- feature launch controls include a compact optional single-bundle selector (`No context bundle` or one saved bundle) so each automation start/resume can explicitly attach one bundle
- feature cards include a `Stop Run For Incomplete Stories` checkbox that controls `stopOnIncompleteStory` in the start request (defaults to unchecked)
- feature cards include a compact automation status summary badge sourced from backend feature automation state (`not_started`, `running`, `completed`, `stopped`, `failed`) with graceful fallback to `not_started` when status data is missing
- feature/epic/story automation status summaries include a compact `Context bundle` line sourced from automation metadata (`context_bundle_id` + `context_bundle_title`) so users can quickly identify the bundle attached to each automation run
- running feature/epic automation summaries include a concise `Current story` line sourced from `GET /api/automation/status/:automationRunId` queue status data (`queue.currentItem`)
- feature/epic/story automation summaries and recent execution history include run-details links (`/run-details.html?id=<runId>`) when run ids are available, with a graceful `Run details unavailable` fallback when they are not
- feature automation UI stores a lightweight per-scope (`projectName` + `baseBranch`) snapshot of the latest automation run id and status payload in `localStorage`, allowing cards to recover recent automation context after page refresh without introducing a client-side state library
- the button is hidden for completed features and replaced with a lightweight
  ineligible hint when the feature has no stories or all stories are complete
- incomplete epic cards surface a **Complete with Automation** button
- the epic button starts automation via `POST /api/automation/start/epic/:epicId`
- epic automation requests include explicit scope metadata (`automationType`, `targetId`, `epicId`) so backend scope validation can reject mismatched launches
- epic launch controls use the same optional single-bundle selector pattern and send `contextBundleId` with start/resume requests
- epic cards include a `Stop Run For Incomplete Stories` checkbox that controls `stopOnIncompleteStory` in the start request (defaults to unchecked)
- epic cards include the same compact automation status summary badge pattern (`not_started`, `running`, `completed`, `stopped`, `failed`) and show active-run context when an epic run is in progress
- epic cards show the same ineligible hint pattern when the epic has no stories
  or all stories are complete
- incomplete story cards surface a **Complete with Automation** button
- completed story cards show an explicit ineligible hint instead of an
  automation control
- the story button starts automation via `POST /api/automation/start/story/:storyId`
- story automation requests include explicit scope metadata (`automationType`, `targetId`, `storyId`) so backend scope validation can reject mismatched launches
- story launch controls use the same optional single-bundle selector pattern and send `contextBundleId` with start/resume requests
- story-card automation startup validates that exactly one story is queued for the selected story target
- frontend validates the start response scope (`automationRun.automationType` + `automationRun.targetId`) before reporting launch success
- feature/epic/story automation start controls keep a lightweight per-target in-flight guard to prevent duplicate start clicks while a start request is pending
- repeated starts on the same target show explicit "already being requested" feedback, while backend safeguards enforce same-target conflict rejection for overlapping launches
- story cards include a compact automation status summary badge using the same state model (`not_started`, `running`, `completed`, `stopped`, `failed`) with backend-driven fallback to `not_started` when status data is missing

Automation status response (`200 OK`) includes polling-friendly state:

- `automationRun` (id, type, target, project/branch scope, stop flags, current queue position, status, timestamps)
- `queue` (`totalStories`, `processedStories`, `remainingStories`, and `currentItem` while running)
- queue progress is derived from persisted `automation_run_queue_items` plus
  persisted story execution outcomes, so refresh/restart does not depend on
  reconstructing queue state from mutable feature tree data
- `remainingStories` is derived from persisted queue positions that have not
  reached a persisted `completed` execution outcome yet, so failed attempts stay
  visible as remaining work for restart decisions
- queue snapshots are normalized by `position_in_queue` before calculating
  current/remaining items to avoid relying on accidental row order
- `summary` (completed/failed/stopped execution counts)
- `completedSteps` and `failedSteps` (per-story summarized outcomes with run linkage, failed story id/title, and failure reasons when available)
- `finalResult` (`status` + `stopReason`) when automation is no longer running
- `finalResult` also includes `failedStoryId`, `failedStoryTitle`, and
  `failureSummary` when available so the UI can explain failure context without
  requiring a separate log subsystem
- when no active automation lock exists, the feature page can still request the last persisted run id for the selected scope to recover recent completed/stopped status details after refresh

Automation stop behavior (`POST /api/automation/stop/:automationRunId`):

- valid running runs are marked as stopped immediately in persisted metadata
- stop metadata is explicitly user-initiated (`automation_status: stopped`,
  `stop_flag: true`, `stop_reason: manual_stop`)
- the currently executing story is allowed to finish, but the next queued story
  is not started
- UI polling via `GET /api/automation/status/:automationRunId` can distinguish
  manual stop (`manual_stop`) from failure (`execution_failed`) and
  incomplete-story stop (`story_incomplete`)

## Story Automation Prompt Generation

`server/storyAutomationPrompt.js` is the single source of truth for converting
story automation context into a Codex-ready prompt.

- `buildStoryAutomationPrompt(context)` always includes story title and story
  description in the generated prompt.
- Parent context is included when available (`feature` and `epic` title and
  description).
- The builder accepts both database-shaped context keys (for example
  `story_name`) and queued-story keys (for example `storyTitle`) so queued
  story items can be transformed without additional mapping in handlers.
- Prompt generation failures throw `StoryAutomationPromptError` with code
  `prompt_generation_failed`; story automation treats this as a terminal
  execution failure and stops the run.

## Security

This application is meant for trusted LAN usage only.

- No authentication is built in.
- The server can execute Codex CLI and Git commands against local repositories.
- Traffic is served over plain HTTP by default.
- Any device on the same network that can reach the server can use the UI.

### Recommendations

- Do not expose this app to the public internet.
- Use it only on trusted local networks.
- Consider firewall rules or network segmentation if needed.
- Avoid pointing it at sensitive or production repositories unless you understand the risks.

## Limitations

- The app assumes each selected repository has a local `main` branch.
- Usage tracking comes from the SDK response when available; credits-remaining values are no longer captured separately.
- Windows support depends on Node, Git, and the Codex SDK's bundled Codex CLI binary being usable in the server environment. Upstream Codex platform support still applies.
- There is no authentication, authorization, or multi-user isolation.

## License

This repository currently does not define a separate license file.
