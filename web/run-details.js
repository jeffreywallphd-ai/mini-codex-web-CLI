const backButton = document.getElementById("backButton");
const mergeButton = document.getElementById("mergeButton");
const promptDetail = document.getElementById("promptDetail");
const gitStatusDetail = document.getElementById("gitStatusDetail");
const stderrDetail = document.getElementById("stderrDetail");
const mergeDetail = document.getElementById("mergeDetail");
const runDetail = document.getElementById("runDetail");
const runSummary = document.getElementById("runSummary");
const statusBox = document.getElementById("statusBox");

let activeRun = null;

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
  const mergeOutput = [run.merge_stdout, run.merge_stderr].filter(Boolean).join("\n\n").trim();
  const executionMode = run.execution_mode === "write" ? "Write Mode" : "Read Mode";

  runSummary.innerHTML = `
    <div><strong>Run ID</strong><span>${run.id}</span></div>
    <div><strong>Project</strong><span>${run.project_name}</span></div>
    <div><strong>Mode</strong><span>${executionMode}</span></div>
    <div><strong>Base Branch</strong><span>${run.base_branch || "main"}</span></div>
    <div><strong>Run Branch</strong><span>${run.branch_name || "(unknown)"}</span></div>
    <div><strong>Credits</strong><span>${credits}</span></div>
    <div><strong>Usage</strong><span>${usage}</span></div>
    <div><strong>Exit Code</strong><span>${run.code}</span></div>
    <div><strong>Created</strong><span>${run.created_at || ""}</span></div>
  `;

  promptDetail.textContent = run.prompt || "(none)";
  gitStatusDetail.textContent = run.git_status || "(none)";
  stderrDetail.textContent = run.stderr || "(none)";
  mergeDetail.textContent = mergeOutput || "No merge attempted.";

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

loadRun();
