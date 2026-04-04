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
- Automation metadata persistence for orchestration state (`automation_type`, `target_id`, `stop_on_incomplete`, `stop_flag`, `current_position`, `automation_status`, `stop_reason`)
- Automation story execution outcome persistence for status reporting (`automation_story_executions` with run linkage and queue outcome state)
- Sequential automation runner for server-driven queue execution (`server/automationRunner.js`)
- Shared automated story run pipeline that reuses manual run creation/execution persistence (`server/automatedStoryRunPipeline.js`)
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
5. Click **Run**.
6. The server checks out local `main`, creates a new `codex-xxxxxxxxxx` branch, then runs Codex in the selected mode.
7. Open the run from **Recent Runs** to review output, git status, and merge controls.
8. Click **Merge Changes** on the run details page when you want to merge that branch into `main`.

## Git Behavior

- Every run starts from the repository's local `main` branch.
- The index page can run `git pull` against the selected repository before starting a Codex run.
- The app creates a new branch named `codex-<10 hex chars>`.
- Codex executes only after the branch checkout succeeds.
- The run details page shows the stored `git status --short --branch` output.
- Merge runs are performed by the server with Git and recorded in SQLite.
- If a merge succeeds, the merge button is disabled for that run.

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
  `queueStatus` (`ready`, `target_not_found`, `empty_queue`) so invalid/empty
  queue states are surfaced cleanly.
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
  - `stop_on_incomplete`
  - `stop_flag`
  - `current_position`
  - `automation_status` (`pending`, `running`, `completed`, `failed`, or `stopped`)
  - `stop_reason` (final outcome reason, such as `all_work_complete`,
    `execution_failed`, or `story_incomplete`)
- Per-story automation execution outcomes are persisted in SQLite table
  `automation_story_executions` with:
  - `automation_run_id`
  - `story_id`
  - `position_in_queue`
  - `execution_status` (`completed` or `failed`)
  - `queue_action` (`advanced`, `stopped`, or `failed`)
  - `run_id` (linked run when available)
  - `completion_status` and `completion_work` (when available)
  - `error` (failure detail when execution failed)

## Automation Execution Runner

`server/automationRunner.js` provides a lightweight sequential queue runner that
is compatible with the existing story run lifecycle.

- `runSequentialStoryQueue({ stories, executeStory, stopOnIncompleteStory, onProgress })`
  executes queued stories strictly one at a time.
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
- `onStoryResult` is invoked after each story with deterministic
  `queueAction` (`advanced`, `stopped`, `failed`) and completion fields so
  each story outcome can be persisted for automation status displays.

## Automated Story Run Pipeline

`server/automatedStoryRunPipeline.js` is the shared integration point between
automation and the existing run pipeline.

- resolves story context in project/branch scope
- builds the story automation prompt
- executes story work via the same `executeRunFlow` path used by manual run
  creation/execution
- persists run output through the standard `runs` table lifecycle and then
  links the run to the story (`attachRunToStory`)
- returns normalized completion metadata consumed by queue orchestration

## Automation Start API

`server/automationStartApi.js` exposes minimal endpoints for launching
automation runs by scope:

- `POST /api/automation/start/feature/:featureId`
- `POST /api/automation/start/epic/:epicId`
- `POST /api/automation/start/story/:storyId`
- `POST /api/automation/stop/:automationRunId`
- `GET /api/automation/status/:automationRunId`

Each endpoint:

- validates `projectName` and `baseBranch`
- validates the scoped target exists (`featureId`, `epicId`, or `storyId`)
- validates the selected target is eligible (non-empty runnable queue)
- creates an `automation_runs` record with initial state
- initializes a deterministic queue from `defineAutomationExecutionPlan`
- starts background execution using the shared automated story run pipeline
  (`createAutomatedStoryRunExecutor` + `executeRunFlow` + sequential queue runner)

Request body fields:

- `projectName` (required)
- `baseBranch` (required)
- `stopOnIncompleteStory` (optional boolean, default `false`)

Success response (`202 Accepted`) includes tracking metadata for the UI:

- `automationRun` (id, type, target, status, stop flags, timestamps)
- `queue` (`totalStories`, `storyIds`, and queue readiness metadata)
- `projectName`
- `baseBranch`

Automation status response (`200 OK`) includes polling-friendly state:

- `automationRun` (id, type, target, stop flags, current queue position, status, timestamps)
- `queue` (`totalStories`, `processedStories`, `remainingStories`, and `currentItem` while running)
- `summary` (completed/failed/stopped execution counts)
- `completedSteps` and `failedSteps` (per-story summarized outcomes with run linkage)
- `finalResult` (`status` + `stopReason`) when automation is no longer running

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
