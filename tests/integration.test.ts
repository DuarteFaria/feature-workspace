import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  test("create uses the source repo current branch as the default base ref", () => {
    withTempDir((workspaceRoot) => {
      const sourceRoot = path.join(workspaceRoot, "sources");
      const worktreeRoot = path.join(workspaceRoot, "worktrees", "{workspace}");
      const sourceRepo = path.join(sourceRoot, "repo-a");
      const targetRepo = path.join(workspaceRoot, "worktrees", "DEV-830", "repo-a");

      createGitRepo(sourceRepo);
      git(sourceRepo, ["checkout", "-B", "DEV-790"]);
      writeConfig(workspaceRoot, {
        sourceRoot,
        worktreeRoot,
        copyIgnored: [".env"],
      });

      const create = runCli(workspaceRoot, ["create", "DEV-830", "--repos", "repo-a"], "n\n");
      expect(create.status).toBe(0);
      expect(create.stdout).toContain("create from: DEV-790");
      expect(create.stdout).toContain("worktree add -b DEV-830");
      expect(create.stdout).toContain("DEV-790");
      expect(existsSync(targetRepo)).toBe(false);

      const manifestPath = path.join(workspaceRoot, ".fw", "workspaces", "DEV-830.yaml");
      expect(existsSync(manifestPath)).toBe(true);
      expect(readFileSync(manifestPath, "utf8")).toContain("createFrom: DEV-790");
      expect(readFileSync(manifestPath, "utf8")).toContain("copyIgnored:");
    });
  });

  test("create accepts an explicit base ref override", () => {
    withTempDir((workspaceRoot) => {
      const sourceRoot = path.join(workspaceRoot, "sources");
      const worktreeRoot = path.join(workspaceRoot, "worktrees", "{workspace}");
      const sourceRepo = path.join(sourceRoot, "repo-a");

      createGitRepo(sourceRepo);
      git(sourceRepo, ["checkout", "-B", "DEV-790"]);
      writeConfig(workspaceRoot, {
        sourceRoot,
        worktreeRoot,
      });

      const create = runCli(workspaceRoot, ["create", "DEV-830", "--repos", "repo-a", "--create-from", "main"], "n\n");
      expect(create.status).toBe(0);
      expect(create.stdout).toContain("create from: main");
      expect(create.stdout).toContain("worktree add -b DEV-830");

      const manifestPath = path.join(workspaceRoot, ".fw", "workspaces", "DEV-830.yaml");
      expect(readFileSync(manifestPath, "utf8")).toContain("createFrom: main");
    });
  });

  test("create copies default ignored runtime files when config omits copyIgnored", () => {
    withTempDir((workspaceRoot) => {
      const sourceRoot = path.join(workspaceRoot, "sources");
      const worktreeRoot = path.join(workspaceRoot, "worktrees", "{workspace}");
      const sourceRepo = path.join(sourceRoot, "repo-a");
      const targetRepo = path.join(workspaceRoot, "worktrees", "DEV-830", "repo-a");

      createGitRepo(sourceRepo);
      writeFileSync(path.join(sourceRepo, ".gitignore"), ".env\n.npmrc\nsecrets/\nnode_modules/\n");
      git(sourceRepo, ["add", ".gitignore"]);
      git(sourceRepo, [
        "-c",
        "user.name=Feature Workspace Tests",
        "-c",
        "user.email=fw-tests@example.test",
        "commit",
        "-m",
        "Ignore runtime files",
      ]);
      writeFileSync(path.join(sourceRepo, ".env"), "TOKEN=source\n");
      writeFileSync(path.join(sourceRepo, ".npmrc"), "//registry.example.test/:_authToken=source\n");
      mkdirSync(path.join(sourceRepo, "secrets"), { recursive: true });
      writeFileSync(path.join(sourceRepo, "secrets", "jwtKey"), "private-key\n");
      writeFileSync(path.join(sourceRepo, "secrets", "jwtKey.pub"), "public-key\n");
      mkdirSync(path.join(sourceRepo, "node_modules"), { recursive: true });
      writeFileSync(path.join(sourceRepo, "node_modules", "ignored.js"), "module.exports = true;\n");
      writeConfig(workspaceRoot, {
        sourceRoot,
        worktreeRoot,
      });

      const create = runCli(workspaceRoot, ["create", "DEV-830", "--repos", "repo-a"], "y\n");
      expect(create.status).toBe(0);
      expect(create.stdout).toContain("planned ignored file copies:");
      expect(create.stdout).toContain(".env ->");
      expect(create.stdout).toContain(".npmrc ->");
      expect(create.stdout).toContain("secrets/jwtKey ->");
      expect(create.stdout).toContain("secrets/jwtKey.pub ->");
      expect(create.stdout).not.toContain("node_modules");
      expect(create.stdout).toContain("Apply complete.");
      expect(readFileSync(path.join(targetRepo, ".env"), "utf8")).toBe("TOKEN=source\n");
      expect(readFileSync(path.join(targetRepo, ".npmrc"), "utf8")).toBe("//registry.example.test/:_authToken=source\n");
      expect(readFileSync(path.join(targetRepo, "secrets", "jwtKey"), "utf8")).toBe("private-key\n");
      expect(readFileSync(path.join(targetRepo, "secrets", "jwtKey.pub"), "utf8")).toBe("public-key\n");
      expect(existsSync(path.join(targetRepo, "node_modules", "ignored.js"))).toBe(false);

      const manifestPath = path.join(workspaceRoot, ".fw", "workspaces", "DEV-830.yaml");
      const manifest = readFileSync(manifestPath, "utf8");
      expect(manifest).toContain("copyIgnored:");
      expect(manifest).toContain("- .env");
      expect(manifest).toContain("- .npmrc");
      expect(manifest).toContain("- secrets/jwtKey");
      expect(manifest).toContain("- secrets/jwtKey.pub");
    });
  });

  test("create checks out an existing workspace branch when its worktree is missing", () => {
    withTempDir((workspaceRoot) => {
      const sourceRoot = path.join(workspaceRoot, "sources");
      const worktreeRoot = path.join(workspaceRoot, "worktrees", "{workspace}");
      const sourceRepo = path.join(sourceRoot, "repo-a");
      const targetRepo = path.join(workspaceRoot, "worktrees", "DEV-830", "repo-a");

      createGitRepo(sourceRepo);
      git(sourceRepo, ["branch", "DEV-830"]);
      git(sourceRepo, ["checkout", "-B", "DEV-790"]);
      writeConfig(workspaceRoot, {
        sourceRoot,
        worktreeRoot,
      });

      const create = runCli(workspaceRoot, ["create", "DEV-830", "--repos", "repo-a", "--create-from", "DEV-790"], "y\n");
      expect(create.status).toBe(0);
      expect(create.stdout).toContain("worktree add");
      expect(create.stdout).toContain("DEV-830");
      expect(create.stdout).not.toContain("worktree add -b DEV-830");
      expect(create.stdout).not.toContain("requested base ref DEV-790 cannot be used because DEV-830 already exists");
      expect(create.stdout).toContain("Apply complete.");
      expect(existsSync(targetRepo)).toBe(true);
    });
  });

  test("apply copies configured ignored files into worktrees", () => {
    withTempDir((workspaceRoot) => {
      const sourceRoot = path.join(workspaceRoot, "sources");
      const worktreeRoot = path.join(workspaceRoot, "worktrees", "{workspace}");
      const sourceRepo = path.join(sourceRoot, "repo-a");
      const targetRepo = path.join(workspaceRoot, "worktrees", "DEV-123", "repo-a");
      const targetEnv = path.join(targetRepo, ".env");

      createGitRepo(sourceRepo);
      writeFileSync(path.join(sourceRepo, ".gitignore"), ".env\n.env.local\nnode_modules/\n");
      git(sourceRepo, ["add", ".gitignore"]);
      git(sourceRepo, [
        "-c",
        "user.name=Feature Workspace Tests",
        "-c",
        "user.email=fw-tests@example.test",
        "commit",
        "-m",
        "Ignore runtime files",
      ]);
      writeFileSync(path.join(sourceRepo, ".env"), "TOKEN=source\n");
      writeFileSync(path.join(sourceRepo, ".env.local"), "LOCAL=true\n");
      mkdirSync(path.join(sourceRepo, "node_modules"), { recursive: true });
      writeFileSync(path.join(sourceRepo, "node_modules", "ignored.js"), "module.exports = true;\n");
      writeManifest(workspaceRoot, {
        sourceRoot,
        worktreeRoot,
        copyIgnored: [".env"],
      });

      const plan = runCli(workspaceRoot, ["plan", "DEV-123"]);
      expect(plan.status).toBe(0);
      expect(plan.stdout).toContain("planned ignored file copies:");
      expect(plan.stdout).toContain(".env ->");
      expect(plan.stdout).not.toContain(".env.local ->");
      expect(plan.stdout).not.toContain("node_modules");

      const apply = runCli(workspaceRoot, ["apply", "DEV-123"], "y\n");
      expect(apply.status).toBe(0);
      expect(apply.stdout).toContain("Copying for repo-a: .env ->");
      expect(readFileSync(targetEnv, "utf8")).toBe("TOKEN=source\n");
      expect(existsSync(path.join(targetRepo, ".env.local"))).toBe(false);
      expect(existsSync(path.join(targetRepo, "node_modules", "ignored.js"))).toBe(false);

      rmSync(targetEnv);
      const reapply = runCli(workspaceRoot, ["apply", "DEV-123"], "y\n");
      expect(reapply.status).toBe(0);
      expect(reapply.stdout).toContain("Copying for repo-a: .env ->");
      expect(readFileSync(targetEnv, "utf8")).toBe("TOKEN=source\n");
    });
  });

  test("open starts configured tmux runtime after opening the editor", () => {
    withTempDir((workspaceRoot) => {
      const sourceRoot = path.join(workspaceRoot, "sources");
      const worktreeRoot = path.join(workspaceRoot, "worktrees", "{workspace}");
      const sourceRepo = path.join(sourceRoot, "repo-a");
      const authBackend = path.join(sourceRoot, "auth-backend");
      const fakeBin = path.join(workspaceRoot, "bin");
      const tmuxLog = path.join(workspaceRoot, "tmux.log");

      createGitRepo(sourceRepo);
      mkdirSync(authBackend, { recursive: true });
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(
        path.join(fakeBin, "tmux"),
        `#!/bin/sh
printf '%s\\n' "$*" >> "$TMUX_LOG"
if [ "$1" = "list-windows" ]; then
  printf '0: repo-a*\\n1: auth-backend\\n'
fi
exit 0
`,
      );
      chmodSync(path.join(fakeBin, "tmux"), 0o755);
      writeManifest(workspaceRoot, {
        sourceRoot,
        worktreeRoot,
        worktree: false,
        runtime: `runtime:
  tmux:
    enabled: true
    sessionName: "{workspaceLower}"
    killExisting: true
    killProcessPatterns: []
    startupDelaySeconds: 0
    shellPrefix: "source ~/.nvm/nvm.sh && nvm use --silent"
    windows:
      - name: repo-a
        repo: repo-a
        install: yarn install
        command: yarn dev
      - name: auth-backend
        path: "{sourceRoot}/auth-backend"
        install: yarn install
        command: yarn dev
`,
      });

      const open = runCli(
        workspaceRoot,
        ["open", "DEV-123"],
        undefined,
        {
          PATH: `${fakeBin}:${process.env.PATH}`,
          TMUX_LOG: tmuxLog,
        },
      );

      expect(open.status).toBe(0);
      expect(open.stdout).toContain("tmux session:");
      expect(open.stdout).toContain("name: dev-123");
      expect(open.stdout).toContain("tmux repo-a: cd");
      expect(open.stdout).toContain("yarn install && yarn dev");
      expect(open.stdout).toContain("0: repo-a*");
      expect(open.stdout).toContain("Opening editor:");
      expect(open.stdout.indexOf("Opening editor:")).toBeLessThan(open.stdout.indexOf("0: repo-a*"));

      const tmuxCommands = readFileSync(tmuxLog, "utf8");
      expect(tmuxCommands).toContain("has-session -t dev-123");
      expect(tmuxCommands).toContain("new-session -d -s dev-123 -n repo-a");
      expect(tmuxCommands).toContain("new-window -t dev-123 -n auth-backend");
      expect(tmuxCommands).toContain(`cd ${sourceRepo} && source ~/.nvm/nvm.sh && nvm use --silent && yarn install && yarn dev`);
      expect(tmuxCommands).toContain(`cd ${authBackend} && source ~/.nvm/nvm.sh && nvm use --silent && yarn install && yarn dev`);
    });
  });

  test("open preserves editor-only behavior when manifest omits runtime", () => {
    withTempDir((workspaceRoot) => {
      const sourceRoot = path.join(workspaceRoot, "sources");
      const worktreeRoot = path.join(workspaceRoot, "worktrees", "{workspace}");
      const sourceRepo = path.join(sourceRoot, "repo-a");

      createGitRepo(sourceRepo);
      writeManifest(workspaceRoot, {
        sourceRoot,
        worktreeRoot,
        worktree: false,
      });

      const open = runCli(
        workspaceRoot,
        ["open", "DEV-123"],
        undefined,
        {
          PATH: "/usr/bin:/bin",
        },
      );

      expect(open.status).toBe(0);
      expect(open.stdout).not.toContain("tmux session:");
      expect(open.stdout).toContain("Opening editor:");
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

function runCli(cwd: string, args: string[], input?: string, env: Record<string, string | undefined> = {}): CommandResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      ...env,
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
    worktree?: boolean;
    copyIgnored?: string[];
    runtime?: string;
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
  worktree: ${input.worktree ?? true}
  sourceRoot: ${input.sourceRoot}
  worktreeRoot: ${input.worktreeRoot}
${formatCopyIgnoredConfig(input.copyIgnored)}

editor:
  command: "true"
  newWindow: false

${input.runtime ?? ""}
repositories:
  - name: repo-a
    sourcePath: repo-a
`,
  );
}

function writeConfig(
  workspaceRoot: string,
  input: {
    sourceRoot: string;
    worktreeRoot: string;
    copyIgnored?: string[];
  },
): void {
  const fwDir = path.join(workspaceRoot, ".fw");
  mkdirSync(fwDir, { recursive: true });
  writeFileSync(
    path.join(fwDir, "config.yaml"),
    `archive:
  ttlDays: 7

defaults:
  worktree: true
  sourceRoot: ${input.sourceRoot}
  worktreeRoot: ${input.worktreeRoot}
${formatCopyIgnoredConfig(input.copyIgnored)}

editor:
  command: "true"
  newWindow: false
`,
  );
}

function formatCopyIgnoredConfig(patterns: string[] | undefined): string {
  if (!patterns) {
    return "";
  }

  return `  copyIgnored:\n${patterns.map((pattern) => `    - ${pattern}`).join("\n")}`;
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
