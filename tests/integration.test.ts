import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const CLI_PATH = path.join(PROJECT_ROOT, "src/cli.ts");

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

describe("fw CLI integration", () => {
  test("read-only commands do not initialize .fw in an empty directory", () => {
    withTempDir((workspaceRoot) => {
      expect(runCli(workspaceRoot, ["--help"]).status).toBe(0);
      expect(existsSync(path.join(workspaceRoot, ".fw"))).toBe(false);

      expect(runCli(workspaceRoot, ["gc"]).status).toBe(0);
      expect(existsSync(path.join(workspaceRoot, ".fw"))).toBe(false);

      const missingPlan = runCli(workspaceRoot, ["plan", "MISSING"]);
      expect(missingPlan.status).not.toBe(0);
      expect(existsSync(path.join(workspaceRoot, ".fw"))).toBe(false);
    });
  });

  test("plans, applies, statuses, archives, and previews GC for a temp Git repo workspace", () => {
    withTempDir((workspaceRoot) => {
      const sourceRoot = path.join(workspaceRoot, "sources");
      const worktreeRoot = path.join(workspaceRoot, "worktrees", "{workspace}");
      const sourceRepo = path.join(sourceRoot, "repo-a");
      const editorRoot = path.join(workspaceRoot, "worktrees", "DEV-123");
      const targetRepo = path.join(workspaceRoot, "worktrees", "DEV-123", "repo-a");

      createGitRepo(sourceRepo);
      writeManifest(workspaceRoot, {
        sourceRoot,
        worktreeRoot,
      });

      const plan = runCli(workspaceRoot, ["plan", "DEV-123"]);
      expect(plan.status).toBe(0);
      expect(plan.stdout).toContain("Feature Workspace: DEV-123");
      expect(plan.stdout).toContain("git -C");
      expect(plan.stdout).toContain("worktree add -b DEV-123");
      expect(plan.stdout).toContain(`Editor command:\ntrue ${editorRoot}`);
      expect(plan.stdout).toContain("No filesystem changes were made.");
      expect(existsSync(targetRepo)).toBe(false);

      const apply = runCli(workspaceRoot, ["apply", "DEV-123"], "y\n");
      expect(apply.status).toBe(0);
      expect(apply.stdout).toContain("Apply complete.");
      expect(existsSync(targetRepo)).toBe(true);

      const status = runCli(workspaceRoot, ["status", "DEV-123"]);
      expect(status.status).toBe(0);
      expect(status.stdout).toContain("branch: DEV-123");
      expect(status.stdout).toContain("branch matches: yes");
      expect(status.stdout).toContain("dirty: no");

      const archive = runCli(workspaceRoot, ["archive", "DEV-123"]);
      expect(archive.status).toBe(0);
      expect(archive.stdout).toContain("Archived workspace manifest");
      expect(existsSync(path.join(workspaceRoot, ".fw/workspaces/DEV-123.yaml"))).toBe(false);
      expect(existsSync(path.join(workspaceRoot, ".fw/archive/DEV-123/DEV-123.yaml"))).toBe(true);
      expect(existsSync(path.join(workspaceRoot, ".fw/archive/DEV-123/metadata.json"))).toBe(true);

      const gc = runCli(workspaceRoot, ["gc"]);
      expect(gc.status).toBe(0);
      expect(gc.stdout).toContain("Mode: dry-run");
      expect(gc.stdout).toContain("- DEV-123");
      expect(gc.stdout).toContain("keep repo-a: clean archived worktree");
      expect(existsSync(targetRepo)).toBe(true);
    });
  });
});

function withTempDir(run: (workspaceRoot: string) => void): void {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "fw-integration-"));

  try {
    run(workspaceRoot);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

function runCli(cwd: string, args: string[], input?: string): CommandResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
    },
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function createGitRepo(repoPath: string): void {
  mkdirSync(repoPath, { recursive: true });
  git(repoPath, ["init"]);
  git(repoPath, ["checkout", "-B", "main"]);
  writeFileSync(path.join(repoPath, "README.md"), "# Repo A\n");
  git(repoPath, ["add", "README.md"]);
  git(repoPath, ["-c", "user.name=Feature Workspace Tests", "-c", "user.email=fw-tests@example.test", "commit", "-m", "Initial commit"]);
}

function writeManifest(
  workspaceRoot: string,
  input: {
    sourceRoot: string;
    worktreeRoot: string;
  },
): void {
  const manifestDir = path.join(workspaceRoot, ".fw", "workspaces");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    path.join(manifestDir, "DEV-123.yaml"),
    `name: DEV-123

archive:
  ttlDays: 7

defaults:
  ref: DEV-123
  createFrom: main
  worktree: true
  sourceRoot: ${input.sourceRoot}
  worktreeRoot: ${input.worktreeRoot}

editor:
  command: "true"
  newWindow: false

repositories:
  - name: repo-a
    sourcePath: repo-a
`,
  );
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed with exit code ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}
