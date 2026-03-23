const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { buildSpawnContext, formatCommand, parseStatusEntries, pullRepository } = require("./git");

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
