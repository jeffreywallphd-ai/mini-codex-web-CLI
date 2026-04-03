const backButton = document.getElementById("backButton");
const mergeButton = document.getElementById("mergeButton");
const pullRepoButton = document.getElementById("pullRepoButton");
const promptDetail = document.getElementById("promptDetail");
const gitStatusDetail = document.getElementById("gitStatusDetail");
const commandDetail = document.getElementById("commandDetail");
const stderrDetail = document.getElementById("stderrDetail");
const mergeDetail = document.getElementById("mergeDetail");
const runDetail = document.getElementById("runDetail");
const runSummary = document.getElementById("runSummary");
const statusBox = document.getElementById("statusBox");
const gitFilesList = document.getElementById("gitFilesList");
const diffModal = document.getElementById("diffModal");
const diffModalTitle = document.getElementById("diffModalTitle");
const diffModalBody = document.getElementById("diffModalBody");
const closeDiffButton = document.getElementById("closeDiffButton");

let activeRun = null;
let isPullingRepo = false;

function getRunId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function cleanOutput(text) {
  if (!text) return "";

  if (text.includes("--------")) {
    return text.split("--------").pop().trim();
  }

  return text.trim();
}

function renderStatus(run, message) {
  if (message) {
    statusBox.textContent = message;
    return;
  }

  if (run.error) {
    statusBox.textContent = `Request failed: ${run.error}`;
    return;
  }

  if (run.merged_at) {
    statusBox.textContent = `Merged into ${run.base_branch || "main"} on ${run.merged_at}.`;
    return;
  }

  if (run.code === 0) {
    statusBox.textContent = `Run completed on ${run.branch_name}.`;
    return;
  }

  statusBox.textContent = `Run exited with code ${run.code}.`;
}

function renderRun(run) {
  activeRun = run;
  renderStatus(run);

  const usage = run.usage_delta ?? "(not calculated)";
  const credits = run.credits_remaining ?? "(not available)";
  const mergeOutput = [
    run.merge_stdout,
    run.merge_stderr,
    run.merge_git_status ? `Final Git Status\n--------\n${run.merge_git_status}` : ""
  ].filter(Boolean).join("\n\n").trim();
  const executionMode = run.execution_mode === "write" ? "Write Mode" : "Read Mode";
  const executedCommand = [run.executed_command, run.spawn_command]
    .filter(Boolean)
    .map((command, index) => (index === 0 ? `Requested: ${command}` : `Spawned:   ${command}`))
    .join("\n");
  const commandText = executedCommand || "Handled internally by @openai/codex-sdk.";
  const commitBody = escapeHtml(run.change_description || "(not captured)").replace(/\n/g, "<br>");
  const changeTitle = escapeHtml(run.change_title || "(not captured)");

  runSummary.innerHTML = `
    <div><strong>Run ID</strong><span>${run.id}</span></div>
    <div><strong>Project</strong><span>${run.project_name}</span></div>
    <div><strong>Mode</strong><span>${executionMode}</span></div>
    <div><strong>Base Branch</strong><span>${run.base_branch || "main"}</span></div>
    <div><strong>Run Branch</strong><span>${run.branch_name || "(unknown)"}</span></div>
    <div><strong>Change Title</strong><span>${changeTitle}</span></div>
    <div><strong>Commit Notes</strong><span>${commitBody.replace(/\n/g, "<br>")}</span></div>
    <div><strong>Credits</strong><span>${credits}</span></div>
    <div><strong>Usage</strong><span>${usage}</span></div>
    <div><strong>Exit Code</strong><span>${run.code}</span></div>
    <div><strong>Created</strong><span>${run.created_at || ""}</span></div>
  `;

  promptDetail.textContent = run.prompt || "(none)";
  gitStatusDetail.textContent = run.git_status || "(none)";
  commandDetail.textContent = commandText;
  stderrDetail.textContent = run.stderr || "(none)";
  mergeDetail.textContent = mergeOutput || "No merge attempted.";
  renderGitFiles(run.git_status_files || []);

  runDetail.textContent = [
    "Response",
    "--------",
    cleanOutput(run.stdout) || "(none)",
    "",
    "Status Before",
    "--------",
    run.status_before || "(none)",
    "",
    "Status After",
    "--------",
    run.status_after || "(none)"
  ].join("\n");

  mergeButton.disabled = Boolean(run.merged_at);
  pullRepoButton.disabled = isPullingRepo || !run.project_name;
}

function renderGitFiles(files) {
  gitFilesList.innerHTML = "";

  if (!files.length) {
    return;
  }

  const heading = document.createElement("p");
  heading.className = "git-files-list__heading";
  heading.textContent = "Changed files";
  gitFilesList.appendChild(heading);

  for (const file of files) {
    const button = document.createElement("button");
    button.className = "secondary-button git-file-button";
    button.textContent = `${file.indexStatus}${file.workTreeStatus} ${file.path}`;
    button.addEventListener("click", () => openDiff(file.path));
    gitFilesList.appendChild(button);
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderDiff(diffText) {
  const lines = String(diffText || "").split("\n");
  return lines.map((line) => {
    let className = "diff-line";

    if (line.startsWith("diff --git")) className += " diff-meta";
    else if (line.startsWith("@@")) className += " diff-hunk";
    else if (line.startsWith("+") && !line.startsWith("+++")) className += " diff-add";
    else if (line.startsWith("-") && !line.startsWith("---")) className += " diff-remove";
    else if (line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) className += " diff-header";

    return `<div class="${className}">${escapeHtml(line) || "&nbsp;"}</div>`;
  }).join("");
}

async function openDiff(filePath) {
  if (!activeRun) return;

  diffModalTitle.textContent = filePath;
  diffModalBody.innerHTML = "Loading diff…";
  diffModal.classList.remove("hidden");
  diffModal.setAttribute("aria-hidden", "false");

  const response = await fetch(`/api/runs/${activeRun.id}/diff?file=${encodeURIComponent(filePath)}`);
  const result = await response.json();

  if (!response.ok) {
    diffModalBody.textContent = result.error || "Unable to load diff.";
    return;
  }

  diffModalBody.innerHTML = `<div class="diff-viewer">${renderDiff(result.diff)}</div>`;
}

function closeDiff() {
  diffModal.classList.add("hidden");
  diffModal.setAttribute("aria-hidden", "true");
}

async function loadRun() {
  const runId = getRunId();
  if (!runId) {
    renderStatus({ error: "Missing run id" });
    return;
  }

  const response = await fetch(`/api/runs/${runId}`);
  const run = await response.json();
  renderRun(run);
}

backButton.addEventListener("click", () => {
  window.location.href = "/";
});

closeDiffButton.addEventListener("click", closeDiff);
diffModal.addEventListener("click", (event) => {
  if (event.target === diffModal) {
    closeDiff();
  }
});

mergeButton.addEventListener("click", async () => {
  if (!activeRun || activeRun.merged_at) return;

  mergeButton.disabled = true;
  renderStatus(activeRun, `Merging ${activeRun.branch_name} into ${activeRun.base_branch || "main"}...`);

  try {
    const response = await fetch(`/api/runs/${activeRun.id}/merge`, {
      method: "POST"
    });
    const run = await response.json();

    if (!response.ok) {
      mergeButton.disabled = false;
      renderStatus(run);
      mergeDetail.textContent = run.error || "Merge failed.";
      return;
    }

    renderRun(run);
  } catch (error) {
    mergeButton.disabled = false;
    renderStatus({ error: error.message });
  }
});

pullRepoButton.addEventListener("click", async () => {
  if (!activeRun || !activeRun.project_name || isPullingRepo) return;

  isPullingRepo = true;
  pullRepoButton.disabled = true;
  pullRepoButton.textContent = "Pulling...";
  renderStatus(activeRun, `Pulling latest changes for ${activeRun.project_name}...`);

  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(activeRun.project_name)}/pull`, {
      method: "POST"
    });
    const result = await response.json();

    if (!response.ok) {
      renderStatus({ error: result.error || "Git pull failed." });
      return;
    }

    const summary = (result.stdout || "Git pull finished.").trim().split("\n").find(Boolean);
    const branchStatus = (result.gitStatus || "").split("\n").find(Boolean);
    renderStatus(activeRun, [summary, branchStatus].filter(Boolean).join(" "));
    await loadRun();
  } catch (error) {
    renderStatus({ error: `Git pull failed: ${error.message}` });
  } finally {
    isPullingRepo = false;
    pullRepoButton.textContent = "Git Pull Repo";
    if (activeRun) {
      pullRepoButton.disabled = false;
    }
  }
});

loadRun();
