const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function quoteForDisplay(arg) {
  if (arg === "") return '""';
  if (!/[\s"]/u.test(arg)) return arg;
  return `"${String(arg).replace(/"/g, '\\"')}"`;
}

function formatCommand(command, args) {
  return [command, ...args].map((arg) => quoteForDisplay(String(arg))).join(" ");
}

function buildSpawnContext(command, args) {
  const isWindows = process.platform === "win32";
  const isCodexCommand = command === "codex";
  const requestedCommand = formatCommand(command, args);

  if (isWindows && isCodexCommand) {
    return {
      actualCommand: "cmd.exe",
      actualArgs: ["/d", "/s", "/c", requestedCommand],
      executedCommand: requestedCommand,
      spawnCommand: formatCommand("cmd.exe", ["/d", "/s", "/c", requestedCommand]),
      useShell: false
    };
  }

  return {
    actualCommand: command,
    actualArgs: args,
    executedCommand: requestedCommand,
    spawnCommand: requestedCommand,
    useShell: false
  };
}

function runProcess(repoPath, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const {
      actualCommand,
      actualArgs,
      executedCommand,
      spawnCommand,
      useShell
    } = buildSpawnContext(command, args);

    console.log("RUN", {
      cwd: repoPath,
      executedCommand,
      spawnCommand,
      useShell,
      args: actualArgs
    });

    const child = spawn(actualCommand, actualArgs, {
      cwd: repoPath,
      env: { ...process.env },
      shell: useShell,
      windowsHide: true
    });

    child.on("error", reject);

    if (child.stdout) {
      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }

    if (child.stdin) {
      if (typeof options.input === "string") {
        child.stdin.end(options.input);
      } else {
        child.stdin.end();
      }
    }

    child.on("close", (code) => {
      resolve({ code, stdout, stderr, executedCommand, spawnCommand });
    });
  });
}

async function runGit(repoPath, args) {
  return runProcess(repoPath, "git", args);
}

function parseStatusEntries(statusText) {
  const lines = String(statusText || "").split("\n").slice(1).filter(Boolean);

  return lines.map((line) => {
    const indexStatus = line.slice(0, 1);
    const workTreeStatus = line.slice(1, 2);
    const rawPath = line.slice(3).trim();
    const pathText = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() : rawPath;

    return {
      indexStatus,
      workTreeStatus,
      path: pathText,
      rawPath
    };
  });
}

async function getDiffForPath(repoPath, relativePath) {
  const trackedDiff = await runGit(repoPath, ["diff", "--", relativePath]);
  const stagedDiff = await runGit(repoPath, ["diff", "--cached", "--", relativePath]);
  const combined = [stagedDiff.stdout, trackedDiff.stdout].filter(Boolean).join("\n").trim();

  if (combined) {
    return combined;
  }

  const absolutePath = path.join(repoPath, relativePath);

  if (fs.existsSync(absolutePath)) {
    const untrackedDiff = await runGit(repoPath, ["diff", "--no-index", "--", "/dev/null", relativePath]);
    if (untrackedDiff.stdout || untrackedDiff.stderr) {
      return [untrackedDiff.stdout, untrackedDiff.stderr].filter(Boolean).join("\n").trim();
    }
  }

  return "";
}

async function getGitSnapshot(repoPath) {
  const statusResult = await runGit(repoPath, ["status", "--short", "--branch"]);
  const files = parseStatusEntries(statusResult.stdout);
  const diffs = {};

  for (const file of files) {
    diffs[file.path] = await getDiffForPath(repoPath, file.path);
  }

  return {
    gitStatus: [statusResult.stdout, statusResult.stderr].filter(Boolean).join("\n").trim(),
    files,
    diffs
  };
}

async function hasStagedChanges(repoPath) {
  const result = await runGit(repoPath, ["diff", "--cached", "--quiet"]);
  return result.code === 1;
}

async function stageAllChanges(repoPath) {
  const result = await runGit(repoPath, ["add", "-A"]);

  if (result.code !== 0) {
    throw new Error(`Failed to stage changes.\n${result.stderr || result.stdout}`.trim());
  }
}

async function commitAllChanges(repoPath, title, description = "") {
  await stageAllChanges(repoPath);

  if (!(await hasStagedChanges(repoPath))) {
    return {
      code: 0,
      stdout: "No changes to commit.",
      stderr: "",
      skipped: true
    };
  }

  const args = ["commit", "-m", title];

  if (description.trim()) {
    args.push("-m", description.trim());
  }

  const result = await runGit(repoPath, args);

  if (result.code !== 0) {
    throw new Error(`Failed to commit changes.\n${result.stderr || result.stdout}`.trim());
  }

  return result;
}

async function assertLocalBranchExists(repoPath, branchName) {
  const result = await runGit(repoPath, ["rev-parse", "--verify", branchName]);

  if (result.code !== 0) {
    throw new Error(
      `The selected repository does not have a local '${branchName}' branch. ` +
      `Create or fetch it before running Codex.`
    );
  }
}

async function listLocalBranches(repoPath) {
  const branchesResult = await runGit(repoPath, ["for-each-ref", "refs/heads", "--format=%(refname:short)"]);

  if (branchesResult.code !== 0) {
    throw new Error(`Failed to list local branches.\n${branchesResult.stderr || branchesResult.stdout}`.trim());
  }

  const currentBranchResult = await runGit(repoPath, ["branch", "--show-current"]);

  if (currentBranchResult.code !== 0) {
    throw new Error(`Failed to detect current branch.\n${currentBranchResult.stderr || currentBranchResult.stdout}`.trim());
  }

  return {
    branches: branchesResult.stdout
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean),
    currentBranch: currentBranchResult.stdout.trim() || null
  };
}

async function checkoutBranch(repoPath, branchName) {
  const result = await runGit(repoPath, ["checkout", branchName]);

  if (result.code !== 0) {
    throw new Error(
      `Failed to check out '${branchName}'.\n${result.stderr || result.stdout}`.trim()
    );
  }
}

async function createCodexBranch(repoPath, baseBranch = "main") {
  await assertLocalBranchExists(repoPath, baseBranch);
  await checkoutBranch(repoPath, baseBranch);

  const branchName = `codex-${crypto.randomBytes(5).toString("hex")}`;
  const createResult = await runGit(repoPath, ["checkout", "-b", branchName]);

  if (createResult.code !== 0) {
    throw new Error(
      `Failed to create branch '${branchName}'.\n${createResult.stderr || createResult.stdout}`.trim()
    );
  }

  return { branchName, baseBranch };
}

async function getGitStatus(repoPath) {
  const snapshot = await getGitSnapshot(repoPath);
  return snapshot.gitStatus;
}

async function pullRepository(repoPath) {
  const pullResult = await runGit(repoPath, ["pull"]);

  if (pullResult.code !== 0) {
    throw new Error(`Failed to pull latest changes.\n${pullResult.stderr || pullResult.stdout}`.trim());
  }

  const gitStatus = await getGitStatus(repoPath);

  return {
    ...pullResult,
    gitStatus
  };
}

async function mergeBranch(
  repoPath,
  branchName,
  baseBranch = "main",
  title = "Codex changes",
  description = ""
) {
  await assertLocalBranchExists(repoPath, baseBranch);
  await assertLocalBranchExists(repoPath, branchName);
  await checkoutBranch(repoPath, branchName);

  const branchCommit = await commitAllChanges(repoPath, title, description);
  await checkoutBranch(repoPath, baseBranch);

  const mergeArgs = ["merge", "--no-ff", branchName, "-m", title];
  if (description.trim()) {
    mergeArgs.push("-m", description.trim());
  }

  const mergeResult = await runGit(repoPath, mergeArgs);

  if (mergeResult.code !== 0) {
    throw new Error(`Failed to merge '${branchName}' into '${baseBranch}'.\n${mergeResult.stderr || mergeResult.stdout}`.trim());
  }

  const postMergeCommit = await commitAllChanges(repoPath, title, description);
  const pushResult = await runGit(repoPath, ["push", "origin", baseBranch]);

  if (pushResult.code !== 0) {
    throw new Error(`Failed to push '${baseBranch}' to origin.\n${pushResult.stderr || pushResult.stdout}`.trim());
  }

  const deleteResult = await runGit(repoPath, ["branch", "-d", branchName]);

  if (deleteResult.code !== 0) {
    throw new Error(`Failed to delete branch '${branchName}'.\n${deleteResult.stderr || deleteResult.stdout}`.trim());
  }

  const gitStatus = await getGitStatus(repoPath);
  const stdout = [
    "Branch Commit",
    "--------",
    branchCommit.stdout || "No changes to commit.",
    "",
    "Merge",
    "--------",
    mergeResult.stdout || "(none)",
    "",
    "Post-Merge Commit",
    "--------",
    postMergeCommit.stdout || "No changes to commit.",
    "",
    "Push",
    "--------",
    pushResult.stdout || "(none)",
    "",
    "Delete Branch",
    "--------",
    deleteResult.stdout || "(none)"
  ].join("\n").trim();
  const stderr = [
    branchCommit.stderr,
    mergeResult.stderr,
    postMergeCommit.stderr,
    pushResult.stderr,
    deleteResult.stderr
  ].filter(Boolean).join("\n\n").trim();

  return {
    ...mergeResult,
    stdout,
    stderr,
    gitStatus,
    pushStdout: pushResult.stdout,
    pushStderr: pushResult.stderr,
    deleteStdout: deleteResult.stdout,
    deleteStderr: deleteResult.stderr
  };
}

module.exports = {
  buildSpawnContext,
  commitAllChanges,
  createCodexBranch,
  formatCommand,
  getGitStatus,
  getGitSnapshot,
  listLocalBranches,
  mergeBranch,
  parseStatusEntries,
  pullRepository,
  runProcess
};
