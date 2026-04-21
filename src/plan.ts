import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type {
  PlannedCommand,
  PlanWarning,
  RepositoryManifest,
  RepositoryPlan,
  WorkspaceManifest,
  WorkspacePlan,
} from "./domain";
import { expandPath, expandPathExpression } from "./config";
import { buildEditorCommand } from "./editor";

type FormatPlanOptions = {
  mutationNotice?: string;
};

export function buildPlan(manifest: WorkspaceManifest): WorkspacePlan {
  const archiveTtlDays = manifest.archive?.ttlDays ?? 7;
  const repositories = manifest.repositories.map((repository) => planRepository(manifest, repository));
  const editorCommand = manifest.editor?.command ?? "zed";
  const shouldOpenNewWindow = manifest.editor?.newWindow ?? true;
  const editorCommandPlan = buildEditorCommand(
    editorCommand,
    repositories.map((repository) => repository.targetPath),
    { newWindow: shouldOpenNewWindow },
  );
  const warnings = repositories.flatMap((repository) => repositoryWarnings(repository));

  return {
    workspaceName: manifest.name,
    archiveTtlDays,
    repositories,
    editorCommand: editorCommandPlan,
    warnings,
  };
}

export function formatPlan(plan: WorkspacePlan, options: FormatPlanOptions = {}): string {
  const lines: string[] = [];

  lines.push(`Feature Workspace: ${plan.workspaceName}`);
  lines.push(`Archive TTL: ${plan.archiveTtlDays} days`);
  lines.push("");
  lines.push("Focus repositories:");

  for (const repository of plan.repositories) {
    const strategy = repository.usesWorktree ? "worktree" : "source checkout";
    const targetStatus = repository.targetExists ? "exists" : "planned";

    lines.push(`- ${repository.name}`);
    lines.push(`  ref: ${repository.ref}`);
    lines.push(`  create from: ${repository.createFrom ?? "existing ref"}`);
    lines.push(`  strategy: ${strategy}`);
    lines.push(`  source: ${repository.sourcePath}`);
    lines.push(`  target: ${repository.targetPath} (${targetStatus})`);
    lines.push(`  git: ${repository.gitStatus}`);

    if (repository.plannedCommands.length > 0) {
      lines.push("  planned commands:");
      for (const command of repository.plannedCommands) {
        lines.push(`    ${command.display}`);
      }
    }
  }

  lines.push("");
  lines.push("Editor command:");
  lines.push(plan.editorCommand.display);

  if (plan.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of plan.warnings) {
      lines.push(`- [${warning.severity}] ${warning.message}`);
    }
  }

  lines.push("");
  lines.push(options.mutationNotice ?? "No filesystem changes were made.");

  return lines.join("\n");
}

function planRepository(manifest: WorkspaceManifest, repository: RepositoryManifest): RepositoryPlan {
  const variables = {
    workspace: manifest.name,
    repo: repository.name,
  };
  const ref = repository.ref ?? manifest.defaults?.ref ?? manifest.name;
  const usesWorktree = repository.worktree ?? manifest.defaults?.worktree ?? true;
  const sourcePath = resolveSourcePath(manifest, repository, variables);
  const sourceExists = existsSync(sourcePath);
  const gitStatus = sourceExists ? detectGitStatus(sourcePath) : "missing";
  const refExists = gitStatus === "git-repo" ? hasRef(sourcePath, ref) : null;
  const createFrom =
    gitStatus === "git-repo" && !refExists ? resolveCreateFrom(manifest, repository, sourcePath) : null;
  const targetPath = usesWorktree ? resolveWorktreePath(manifest, repository, variables) : sourcePath;
  const targetExists = existsSync(targetPath);
  const plannedCommands = buildPlannedCommands({
    sourcePath,
    targetPath,
    ref,
    createFrom,
    refExists,
    usesWorktree,
    targetExists,
    gitStatus,
  });

  return {
    name: repository.name,
    sourcePath,
    targetPath,
    ref,
    createFrom,
    refExists,
    usesWorktree,
    sourceExists,
    targetExists,
    gitStatus,
    plannedCommands,
  };
}

function resolveSourcePath(
  manifest: WorkspaceManifest,
  repository: RepositoryManifest,
  variables: Record<string, string>,
): string {
  const expandedSourcePath = expandPathExpression(repository.sourcePath, variables);

  if (path.isAbsolute(expandedSourcePath)) {
    return path.resolve(expandedSourcePath);
  }

  if (!manifest.defaults?.sourceRoot) {
    return path.resolve(expandedSourcePath);
  }

  return path.resolve(path.join(expandPath(manifest.defaults.sourceRoot, variables), expandedSourcePath));
}

function resolveWorktreePath(
  manifest: WorkspaceManifest,
  repository: RepositoryManifest,
  variables: Record<string, string>,
): string {
  if (repository.worktreePath) {
    return expandPath(repository.worktreePath, variables);
  }

  const root = manifest.defaults?.worktreeRoot ?? "~/FeatureWorkspaces/{workspace}";
  return path.join(expandPath(root, variables), repository.name);
}

function detectGitStatus(sourcePath: string): RepositoryPlan["gitStatus"] {
  const result = spawnSync("git", ["-C", sourcePath, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
  });

  return result.status === 0 && result.stdout.trim() === "true" ? "git-repo" : "not-git-repo";
}

function buildPlannedCommands(input: {
  sourcePath: string;
  targetPath: string;
  ref: string;
  createFrom: string | null;
  refExists: boolean | null;
  usesWorktree: boolean;
  targetExists: boolean;
  gitStatus: RepositoryPlan["gitStatus"];
}): PlannedCommand[] {
  if (!input.usesWorktree || input.targetExists || input.gitStatus !== "git-repo") {
    return [];
  }

  if (input.createFrom) {
    return [
      command("git", [
        "-C",
        input.sourcePath,
        "worktree",
        "add",
        "-b",
        input.ref,
        input.targetPath,
        input.createFrom,
      ]),
    ];
  }

  return [
    command("git", ["-C", input.sourcePath, "worktree", "add", input.targetPath, input.ref]),
  ];
}

function repositoryWarnings(repository: RepositoryPlan): PlanWarning[] {
  const warnings: PlanWarning[] = [];

  if (!repository.sourceExists) {
    warnings.push({
      severity: "critical",
      message: `${repository.name}: source path does not exist: ${repository.sourcePath}`,
    });
  }

  if (repository.gitStatus === "not-git-repo") {
    warnings.push({
      severity: "critical",
      message: `${repository.name}: source path is not a Git work tree: ${repository.sourcePath}`,
    });
  }

  if (
    repository.usesWorktree &&
    !repository.targetExists &&
    repository.gitStatus === "git-repo" &&
    !repository.refExists &&
    !repository.createFrom
  ) {
    warnings.push({
      severity: "critical",
      message: `${repository.name}: could not resolve a base ref. Set createFrom for this repository or in defaults.`,
    });
  }

  return warnings;
}

function resolveCreateFrom(
  manifest: WorkspaceManifest,
  repository: RepositoryManifest,
  sourcePath: string,
): string | null {
  const explicitCreateFrom = repository.createFrom ?? manifest.defaults?.createFrom;

  if (explicitCreateFrom) {
    return explicitCreateFrom;
  }

  return (
    getRemoteHead(sourcePath) ??
    firstExistingRef(sourcePath, ["main", "master", "origin/main", "origin/master"])
  );
}

function getRemoteHead(sourcePath: string): string | null {
  const result = spawnSync("git", ["-C", sourcePath, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  const ref = result.stdout.trim();
  return ref === "" ? null : ref;
}

function firstExistingRef(sourcePath: string, refs: string[]): string | null {
  for (const ref of refs) {
    const result = spawnSync("git", ["-C", sourcePath, "rev-parse", "--verify", "--quiet", ref], {
      encoding: "utf8",
    });

    if (result.status === 0) {
      return ref;
    }
  }

  return null;
}

function hasRef(sourcePath: string, ref: string): boolean {
  const result = spawnSync("git", ["-C", sourcePath, "rev-parse", "--verify", "--quiet", ref], {
    encoding: "utf8",
  });

  return result.status === 0;
}

function command(commandName: string, args: string[]): PlannedCommand {
  return {
    command: commandName,
    args,
    display: shellJoin([commandName, ...args]),
  };
}

function shellJoin(parts: string[]): string {
  return parts.map(shellEscape).join(" ");
}

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
