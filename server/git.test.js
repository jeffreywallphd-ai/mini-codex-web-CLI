const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  buildSpawnContext,
  cleanupMergedCodexBranch,
  formatCommand,
  mergeBranch,
  parseStatusEntries,
  pullRepository,
  shouldAutoDeleteCodexBranch
} = require("./git");

test("formatCommand quotes arguments that need escaping", () => {
  assert.equal(
    formatCommand("codex", ["exec", "--sandbox", "workspace-write", "fix README.md"]),
    'codex exec --sandbox workspace-write "fix README.md"'
  );
});

test("non-windows codex commands are logged directly", () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "linux" });

  try {
    const result = buildSpawnContext("codex", ["exec", "hello world"]);
    assert.equal(result.actualCommand, "codex");
    assert.deepEqual(result.actualArgs, ["exec", "hello world"]);
    assert.equal(result.executedCommand, 'codex exec "hello world"');
    assert.equal(result.spawnCommand, 'codex exec "hello world"');
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }
});

test("windows codex commands log both requested and cmd.exe wrapped forms", () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "win32" });

  try {
    const result = buildSpawnContext("codex", ["exec", "--full-auto", "hello world"]);
    assert.equal(result.actualCommand, "cmd.exe");
    assert.deepEqual(result.actualArgs, [
      "/d",
      "/s",
      "/c",
      'codex exec --full-auto "hello world"'
    ]);
    assert.equal(result.executedCommand, 'codex exec --full-auto "hello world"');
    assert.equal(
      result.spawnCommand,
      'cmd.exe /d /s /c "codex exec --full-auto \\"hello world\\""'
    );
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }
});

test("git status porcelain output is parsed into clickable file entries", () => {
  const files = parseStatusEntries(`## codex-123\n M web/app.js\n?? web/run-details.js\nR  old.js -> new.js`);

  assert.deepEqual(files, [
    {
      indexStatus: " ",
      workTreeStatus: "M",
      path: "web/app.js",
      rawPath: "web/app.js"
    },
    {
      indexStatus: "?",
      workTreeStatus: "?",
      path: "web/run-details.js",
      rawPath: "web/run-details.js"
    },
    {
      indexStatus: "R",
      workTreeStatus: " ",
      path: "new.js",
      rawPath: "old.js -> new.js"
    }
  ]);
});

test("pullRepository pulls latest changes from origin and returns updated status", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mini-codex-git-test-"));
  const remotePath = path.join(tempRoot, "remote.git");
  const seedPath = path.join(tempRoot, "seed");
  const localPath = path.join(tempRoot, "local");
  const incomingPath = path.join(tempRoot, "incoming");
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Codex Test",
    GIT_AUTHOR_EMAIL: "codex@example.com",
    GIT_COMMITTER_NAME: "Codex Test",
    GIT_COMMITTER_EMAIL: "codex@example.com"
  };

  const git = (cwd, ...args) => execFileSync("git", args, {
    cwd,
    env: gitEnv,
    stdio: "pipe",
    encoding: "utf8"
  }).trim();

  fs.mkdirSync(seedPath, { recursive: true });
  git(tempRoot, "init", "--bare", remotePath);
  git(tempRoot, "clone", remotePath, seedPath);
  git(seedPath, "checkout", "-b", "main");
  fs.writeFileSync(path.join(seedPath, "README.md"), "hello\n");
  git(seedPath, "add", "README.md");
  git(seedPath, "commit", "-m", "Initial commit");
  git(seedPath, "push", "-u", "origin", "main");

  git(tempRoot, "clone", remotePath, localPath);
  git(localPath, "checkout", "main");

  git(tempRoot, "clone", remotePath, incomingPath);
  git(incomingPath, "checkout", "main");
  fs.writeFileSync(path.join(incomingPath, "README.md"), "hello\nworld\n");
  git(incomingPath, "add", "README.md");
  git(incomingPath, "commit", "-m", "Update remote");
  git(incomingPath, "push", "origin", "main");

  const result = await pullRepository(localPath);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /(Updating|Fast-forward|Already up to date\.)/);
  assert.match(result.gitStatus, /^## main/);
  assert.equal(fs.readFileSync(path.join(localPath, "README.md"), "utf8"), "hello\nworld\n");
});

function createGitHarness(prefix = "mini-codex-merge-test-") {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const remotePath = path.join(tempRoot, "remote.git");
  const seedPath = path.join(tempRoot, "seed");
  const localPath = path.join(tempRoot, "local");
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Codex Test",
    GIT_AUTHOR_EMAIL: "codex@example.com",
    GIT_COMMITTER_NAME: "Codex Test",
    GIT_COMMITTER_EMAIL: "codex@example.com"
  };

  const git = (cwd, ...args) => execFileSync("git", args, {
    cwd,
    env: gitEnv,
    stdio: "pipe",
    encoding: "utf8"
  }).trim();

  fs.mkdirSync(seedPath, { recursive: true });
  git(tempRoot, "init", "--bare", remotePath);
  git(tempRoot, "clone", remotePath, seedPath);
  git(seedPath, "checkout", "-b", "main");
  fs.writeFileSync(path.join(seedPath, "README.md"), "hello\n");
  git(seedPath, "add", "README.md");
  git(seedPath, "commit", "-m", "Initial commit");
  git(seedPath, "push", "-u", "origin", "main");

  git(tempRoot, "clone", remotePath, localPath);
  git(localPath, "checkout", "main");

  return {
    tempRoot,
    remotePath,
    seedPath,
    localPath,
    git
  };
}

function createCommitOnBranch(git, repoPath, branchName, fileName, fileContents, {
  push = true,
  baseBranch = "main"
} = {}) {
  git(repoPath, "checkout", "-b", branchName, baseBranch);
  fs.writeFileSync(path.join(repoPath, fileName), fileContents);
  git(repoPath, "add", fileName);
  git(repoPath, "commit", "-m", `Update ${fileName}`);
  if (push) {
    git(repoPath, "push", "-u", "origin", branchName);
  }
}

test("shouldAutoDeleteCodexBranch enforces strict source/target/prefix checks", () => {
  assert.deepEqual(
    shouldAutoDeleteCodexBranch({
      sourceBranch: "codex/my-feature",
      targetBranch: "main"
    }),
    {
      shouldDelete: true,
      reason: null,
      sourceBranch: "codex/my-feature",
      targetBranch: "main"
    }
  );

  assert.equal(
    shouldAutoDeleteCodexBranch({
      sourceBranch: "feature/my-feature",
      targetBranch: "main"
    }).reason,
    "source_not_codex_branch"
  );
  assert.equal(
    shouldAutoDeleteCodexBranch({
      sourceBranch: "codex/my-feature",
      targetBranch: "codex/my-feature"
    }).reason,
    "source_equals_target"
  );
});

test("mergeBranch succeeds and deletes eligible codex source branch locally and remotely", async () => {
  const harness = createGitHarness();
  createCommitOnBranch(
    harness.git,
    harness.localPath,
    "codex/cleanup-success",
    "README.md",
    "hello\nmerged\n",
    { push: true }
  );
  harness.git(harness.localPath, "checkout", "main");

  const result = await mergeBranch(
    harness.localPath,
    "codex/cleanup-success",
    "main",
    "Merge codex branch",
    ""
  );

  assert.equal(result.code, 0);
  assert.equal(result.mergeResult.succeeded, true);
  assert.equal(result.pushResult.succeeded, true);
  assert.equal(result.cleanupResult.local.succeeded, true);
  assert.equal(result.cleanupResult.remote.succeeded, true);
  assert.equal(result.hasCleanupWarnings, false);

  const localBranchExists = harness.git(harness.localPath, "branch", "--list", "codex/cleanup-success");
  assert.equal(localBranchExists, "");
  const remoteBranchRef = harness.git(harness.localPath, "ls-remote", "--heads", "origin", "codex/cleanup-success");
  assert.equal(remoteBranchRef, "");
});

test("mergeBranch keeps merge successful when remote cleanup fails", async () => {
  const harness = createGitHarness();
  createCommitOnBranch(
    harness.git,
    harness.localPath,
    "codex/remote-delete-fails",
    "README.md",
    "hello\nremote delete will fail\n",
    { push: false }
  );
  harness.git(harness.localPath, "checkout", "main");

  const result = await mergeBranch(
    harness.localPath,
    "codex/remote-delete-fails",
    "main",
    "Merge codex branch",
    ""
  );

  assert.equal(result.code, 0);
  assert.equal(result.cleanupResult.local.succeeded, true);
  assert.equal(result.cleanupResult.remote.succeeded, false);
  assert.equal(result.hasCleanupWarnings, true);
});

test("cleanupMergedCodexBranch continues to remote cleanup when local safe delete fails", async () => {
  const harness = createGitHarness("mini-codex-cleanup-helper-");
  createCommitOnBranch(
    harness.git,
    harness.localPath,
    "codex/local-delete-fails",
    "feature.txt",
    "unmerged change\n",
    { push: true }
  );
  harness.git(harness.localPath, "checkout", "main");

  const cleanup = await cleanupMergedCodexBranch(harness.localPath, {
    sourceBranch: "codex/local-delete-fails",
    targetBranch: "main"
  });

  assert.equal(cleanup.local.attempted, true);
  assert.equal(cleanup.local.succeeded, false);
  assert.equal(cleanup.remote.attempted, true);
  assert.equal(cleanup.remote.succeeded, true);
  assert.equal(cleanup.warnings.length >= 1, true);
});

test("cleanupMergedCodexBranch records warnings when both local and remote cleanup fail", async () => {
  const harness = createGitHarness("mini-codex-cleanup-both-fail-");
  createCommitOnBranch(
    harness.git,
    harness.localPath,
    "codex/both-cleanup-fail",
    "both-fail.txt",
    "unmerged branch\n",
    { push: false }
  );
  harness.git(harness.localPath, "checkout", "main");

  const cleanup = await cleanupMergedCodexBranch(harness.localPath, {
    sourceBranch: "codex/both-cleanup-fail",
    targetBranch: "main",
    remoteName: "origin"
  });

  assert.equal(cleanup.local.succeeded, false);
  assert.equal(cleanup.remote.succeeded, false);
  assert.equal(cleanup.warnings.length >= 2, true);
});

test("cleanupMergedCodexBranch skips local deletion when source branch is checked out", async () => {
  const harness = createGitHarness("mini-codex-cleanup-current-");
  createCommitOnBranch(
    harness.git,
    harness.localPath,
    "codex/current-branch",
    "checkedout.txt",
    "checked out\n",
    { push: true }
  );

  const cleanup = await cleanupMergedCodexBranch(harness.localPath, {
    sourceBranch: "codex/current-branch",
    targetBranch: "main"
  });

  assert.equal(cleanup.local.attempted, false);
  assert.equal(cleanup.local.skippedReason, "source_is_current_branch");
  assert.equal(cleanup.remote.attempted, true);
});

test("mergeBranch does not auto-delete non-codex source branches", async () => {
  const harness = createGitHarness("mini-codex-noncodex-");
  createCommitOnBranch(
    harness.git,
    harness.localPath,
    "feature/no-auto-delete",
    "README.md",
    "hello\nno cleanup expected\n",
    { push: true }
  );
  harness.git(harness.localPath, "checkout", "main");

  const result = await mergeBranch(
    harness.localPath,
    "feature/no-auto-delete",
    "main",
    "Merge feature branch",
    ""
  );

  assert.equal(result.code, 0);
  assert.equal(result.cleanupResult.eligible, false);
  assert.equal(result.cleanupResult.reason, "source_not_codex_branch");
  const localBranchExists = harness.git(harness.localPath, "branch", "--list", "feature/no-auto-delete");
  assert.match(localBranchExists, /feature\/no-auto-delete/);
});

test("mergeBranch keeps merge failure fatal and does not delete source branch", async () => {
  const harness = createGitHarness("mini-codex-merge-failure-");
  createCommitOnBranch(
    harness.git,
    harness.localPath,
    "codex/merge-conflict",
    "README.md",
    "hello\nfrom codex branch\n",
    { push: true }
  );
  harness.git(harness.localPath, "checkout", "main");
  fs.writeFileSync(path.join(harness.localPath, "README.md"), "hello\nfrom main branch\n");
  harness.git(harness.localPath, "add", "README.md");
  harness.git(harness.localPath, "commit", "-m", "Conflicting main change");
  harness.git(harness.localPath, "push", "origin", "main");

  await assert.rejects(
    mergeBranch(
      harness.localPath,
      "codex/merge-conflict",
      "main",
      "Merge conflict branch",
      ""
    ),
    /Failed to merge/
  );

  const localBranchExists = harness.git(harness.localPath, "branch", "--list", "codex/merge-conflict");
  assert.match(localBranchExists, /codex\/merge-conflict/);
  const remoteBranchRef = harness.git(harness.localPath, "ls-remote", "--heads", "origin", "codex/merge-conflict");
  assert.match(remoteBranchRef, /codex\/merge-conflict/);
});
