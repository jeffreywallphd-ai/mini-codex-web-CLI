const { spawn } = require("child_process");

function extractCreditsRemaining(text) {
  if (!text) return null;

  // Try common patterns (CLI may change format)
  const match =
    text.match(/remaining[:\s]+([\d.]+)/i) ||
    text.match(/credits[:\s]+([\d.]+)/i);

  return match ? parseFloat(match[1]) : null;
}

function runCommand(repoPath, commandArgs) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const child = spawn("cmd.exe", ["/c", ...commandArgs], {
      cwd: repoPath,
      env: { ...process.env }
    });

    child.stdout.on("data", d => stdout += d.toString());
    child.stderr.on("data", d => stderr += d.toString());

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function runCodexWithUsage(repoPath, prompt) {
  const statusBefore = await runCommand(repoPath, ["codex", "status"]);
  const beforeCredits = extractCreditsRemaining(statusBefore.stdout);

  const result = await runCommand(repoPath, ["codex", "exec", prompt]);

  const statusAfter = await runCommand(repoPath, ["codex", "status"]);
  const afterCredits = extractCreditsRemaining(statusAfter.stdout);

  let usageDelta = null;

  if (beforeCredits !== null && afterCredits !== null) {
    usageDelta = (beforeCredits - afterCredits).toFixed(4);
  }

  return {
    ...result,
    statusBefore: statusBefore.stdout,
    statusAfter: statusAfter.stdout,
    usageDelta,
    creditsRemaining: afterCredits
  };
}

module.exports = { runCodexWithUsage };