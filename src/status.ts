import { spawnSync } from "node:child_process";
import type { RepositoryPlan, RepositoryStatus, WorkspacePlan, WorkspaceStatus } from "./domain";

export function buildStatus(plan: WorkspacePlan): WorkspaceStatus {
  const repositories = plan.repositories.map(statusRepository);
  const editorReady = repositories.every((repository) => repository.targetExists && repository.gitStatus === "git-repo");

  return {
    workspaceName: plan.workspaceName,
    repositories,
    editorReady,
  };
}

export function formatStatus(status: WorkspaceStatus): string {
  const lines: string[] = [];

  lines.push(`Feature Workspace: ${status.workspaceName}`);
  lines.push("");
  lines.push("Repositories:");

  for (const repository of status.repositories) {
    lines.push(`- ${repository.name}`);
    lines.push(`  target: ${repository.targetExists ? "exists" : "missing"}`);
    lines.push(`  path: ${repository.targetPath}`);
    lines.push(`  git: ${repository.gitStatus}`);
    lines.push(`  branch: ${repository.currentBranch ?? "unknown"}`);
    lines.push(`  expected branch: ${repository.expectedRef}`);
    lines.push(`  branch matches: ${formatNullableBoolean(repository.branchMatches)}`);
    lines.push(`  dirty: ${formatNullableBoolean(repository.dirty)}`);
    lines.push(`  upstream: ${repository.upstream ?? "none"}`);
    lines.push(`  ahead/behind: ${formatAheadBehind(repository)}`);
  }

  lines.push("");
  lines.push("Editor:");
  lines.push(`  ready: ${status.editorReady ? "yes" : "no"}`);

  return lines.join("\n");
}

export function hasLocalChanges(status: WorkspaceStatus): boolean {
  return status.repositories.some((repository) => repository.dirty === true || (repository.ahead ?? 0) > 0);
}

function statusRepository(repository: RepositoryPlan): RepositoryStatus {
  return statusTargetPath({
    name: repository.name,
    targetPath: repository.targetPath,
    expectedRef: repository.ref,
    targetExists: repository.targetExists,
  });
}

export function statusTargetPath(input: {
  name: string;
  targetPath: string;
  expectedRef: string;
  targetExists: boolean;
}): RepositoryStatus {
  if (!input.targetExists) {
    return {
      name: input.name,
      targetPath: input.targetPath,
      expectedRef: input.expectedRef,
      targetExists: false,
      gitStatus: "missing",
      currentBranch: null,
      branchMatches: null,
      dirty: null,
      upstream: null,
      ahead: null,
      behind: null,
    };
  }

  const isGitRepo = git(input.targetPath, ["rev-parse", "--is-inside-work-tree"]);

  if (isGitRepo.status !== 0 || isGitRepo.stdout.trim() !== "true") {
    return {
      name: input.name,
      targetPath: input.targetPath,
      expectedRef: input.expectedRef,
      targetExists: true,
      gitStatus: "not-git-repo",
      currentBranch: null,
      branchMatches: null,
      dirty: null,
      upstream: null,
      ahead: null,
      behind: null,
    };
  }

  const currentBranch = git(input.targetPath, ["branch", "--show-current"]).stdout.trim() || null;
  const dirty = git(input.targetPath, ["status", "--porcelain"]).stdout.trim() !== "";
  const upstream = resolveUpstream(input.targetPath);
  const aheadBehind = upstream ? resolveAheadBehind(input.targetPath, upstream) : { ahead: null, behind: null };

  return {
    name: input.name,
    targetPath: input.targetPath,
    expectedRef: input.expectedRef,
    targetExists: true,
    gitStatus: "git-repo",
    currentBranch,
    branchMatches: currentBranch === input.expectedRef,
    dirty,
    upstream,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
  };
}

function resolveUpstream(targetPath: string): string | null {
  const result = git(targetPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim() || null;
}

function resolveAheadBehind(targetPath: string, upstream: string): { ahead: number | null; behind: number | null } {
  const result = git(targetPath, ["rev-list", "--left-right", "--count", `${upstream}...HEAD`]);

  if (result.status !== 0) {
    return { ahead: null, behind: null };
  }

  const [behindRaw, aheadRaw] = result.stdout.trim().split(/\s+/);
  const ahead = aheadRaw ? Number.parseInt(aheadRaw, 10) : null;
  const behind = behindRaw ? Number.parseInt(behindRaw, 10) : null;

  return {
    ahead: Number.isNaN(ahead) ? null : ahead,
    behind: Number.isNaN(behind) ? null : behind,
  };
}

function git(targetPath: string, args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync("git", ["-C", targetPath, ...args], {
    encoding: "utf8",
  });

  return {
    status: result.status,
    stdout: result.stdout,
  };
}

function formatNullableBoolean(value: boolean | null): string {
  if (value === null) {
    return "unknown";
  }

  return value ? "yes" : "no";
}

function formatAheadBehind(repository: RepositoryStatus): string {
  if (repository.ahead === null || repository.behind === null) {
    return "unknown";
  }

  return `${repository.ahead} ahead, ${repository.behind} behind`;
}
