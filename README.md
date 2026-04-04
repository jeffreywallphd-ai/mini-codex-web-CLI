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

Story queue planning utilities are available in `server/automationQueue.js` for the
automation domain.

- `generateStoryExecutionQueues(features)` transforms a feature/epic/story hierarchy
  into ordered epic-level story queues.
- Ordering is deterministic and stable:
  - features sort by `order` ascending, then original input position
  - epics sort by `order` ascending, then original input position
  - stories sort by `order` ascending, then original input position
- `flattenStoryExecutionQueues(queues)` returns one flat execution list with
  `positionInQueue` for strict run sequencing.

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
