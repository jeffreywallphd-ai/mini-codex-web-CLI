const { spawn } = require("child_process");
const crypto = require("crypto");

function quoteArg(arg) {
  if (arg === "") return '""';
  if (!/[\s"^&|<>]/.test(arg)) return arg;
  return `"${String(arg).replace(/(["\\])/g, "\\$1")}"`;
}

function formatCommand(command, args) {
  return [command, ...args].map((arg) => quoteArg(String(arg))).join(" ");
}

function buildSpawnContext(command, args) {
  const isWindows = process.platform === "win32";
  const isCodexCommand = command === "codex" || command === "codex.cmd";

  if (isWindows && isCodexCommand) {
    const innerCommand = formatCommand("codex", args);
    return {
      actualCommand: "cmd.exe",
      actualArgs: ["/d", "/s", "/c", innerCommand],
      executedCommand: innerCommand,
      spawnCommand: formatCommand("cmd.exe", ["/d", "/s", "/c", innerCommand])
    };
  }

  return {
    actualCommand: command,
    actualArgs: args,
    executedCommand: formatCommand(command, args),
    spawnCommand: formatCommand(command, args)
  };
}

function runProcess(repoPath, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const { actualCommand, actualArgs, executedCommand, spawnCommand } = buildSpawnContext(
      command,
      args
    );

    console.log("RUN", {
      cwd: repoPath,
      executedCommand,
      spawnCommand
    });

    const child = spawn(actualCommand, actualArgs, {
      cwd: repoPath,
      env: { ...process.env },
      shell: false,
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

    if (typeof options.input === "string") {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }

    child.on("close", (code) => {
      resolve({ code, stdout, stderr, executedCommand, spawnCommand });
    });
  });
}

async function runGit(repoPath, args) {
  return runProcess(repoPath, "git", args);
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

async function checkoutBranch(repoPath, branchName) {
  const result = await runGit(repoPath, ["checkout", branchName]);

  if (result.code !== 0) {
    throw new Error(`Failed to check out '${branchName}'.\n${result.stderr || result.stdout}`.trim());
  }
}

async function createCodexBranch(repoPath, baseBranch = "main") {
  await assertLocalBranchExists(repoPath, baseBranch);
  await checkoutBranch(repoPath, baseBranch);

  const branchName = `codex-${crypto.randomBytes(5).toString("hex")}`;
  const createResult = await runGit(repoPath, ["checkout", "-b", branchName]);

  if (createResult.code !== 0) {
    throw new Error(`Failed to create branch '${branchName}'.\n${createResult.stderr || createResult.stdout}`.trim());
  }

  return { branchName, baseBranch };
}

async function getGitStatus(repoPath) {
  const result = await runGit(repoPath, ["status", "--short", "--branch"]);
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

async function mergeBranch(repoPath, branchName, baseBranch = "main") {
  await assertLocalBranchExists(repoPath, baseBranch);
  await checkoutBranch(repoPath, baseBranch);

  const mergeResult = await runGit(repoPath, ["merge", branchName]);
  const gitStatus = await getGitStatus(repoPath);

  return {
    ...mergeResult,
    gitStatus
  };
}

module.exports = {
  buildSpawnContext,
  createCodexBranch,
  formatCommand,
  getGitStatus,
  mergeBranch,
  runProcess
};
