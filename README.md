# Mini Codex Web CLI

A lightweight LAN-first web interface for running Codex CLI from a desktop PC and controlling it from a mobile browser on the same local network.

## Overview

Mini Codex Web CLI keeps the workflow intentionally small:

- pick a local repository that lives on the LAN host machine
- choose a Codex execution mode
- create an isolated working branch before each run
- send a prompt to Codex CLI
- review that single run on its own details page
- optionally merge the generated branch back into `main`

The app is designed for personal LAN use, not for public internet exposure or multi-user hosting.

## Features

- Repository picker for local Git repositories
- Codex execution mode selector with Read Mode and Write Mode (`--full-auto`, `--ask-for-approval on-failure`, `--sandbox workspace-write`)
- Automatic branch creation from `main` before every run using `codex-<10 hex chars>` naming
- Dedicated run details page for each prompt run
- Git status display and one-tap merge action from the run details page
- Recent run history with search
- Basic usage tracking (credits remaining + per-run estimate)
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
- Codex CLI installed and available on the server machine PATH

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
2. Select Read Mode for a standard `codex exec` run, or Write Mode to add `--full-auto` plus explicit `--ask-for-approval on-failure --sandbox workspace-write` flags.
3. Enter a prompt.
4. Click **Run**.
5. The server checks out local `main`, creates a new `codex-xxxxxxxxxx` branch, then runs Codex in the selected mode.
6. Open the run from **Recent Runs** to review output, git status, and merge controls.
7. Click **Merge Changes** on the run details page when you want to merge that branch into `main`.

## Git Behavior

- Every run starts from the repository's local `main` branch.
- The app creates a new branch named `codex-<10 hex chars>`.
- Codex executes only after the branch checkout succeeds.
- The run details page shows the stored `git status --short --branch` output.
- The run details page also stores and shows the exact Codex command requested plus the final spawned command line (including the Windows `cmd.exe` wrapper when applicable).
- Merge runs are performed by the server with Git and recorded in SQLite.
- If a merge succeeds, the merge button is disabled for that run.

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
- Usage tracking is best-effort and depends on Codex CLI output format.
- Windows support depends on Node, Git, and Codex CLI being available in the server environment PATH. OpenAI's Codex CLI documentation currently lists Windows 11 via WSL2 as the supported Windows setup, so native `cmd.exe` usage may still be limited by upstream Codex behavior.
- There is no authentication, authorization, or multi-user isolation.

## License

This repository currently does not define a separate license file.
