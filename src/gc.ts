import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { statusTargetPath } from "./status";

const ARCHIVE_ROOT = ".fw/archive";

type ArchiveMetadata = {
  archivedAt: string;
  ttlDays: number;
  workspaceName: string;
  manifestPath: string;
  repositories: Array<{
    name: string;
    sourcePath?: string;
    targetPath: string;
    ref: string;
  }>;
};

type GcPlan = {
  archiveRoot: string;
  workspaces: GcWorkspacePlan[];
};

type GcWorkspacePlan = {
  workspaceName: string;
  archiveDir: string;
  expired: boolean;
  expiresAt: Date;
  repositories: GcRepositoryPlan[];
  blockers: string[];
};

type GcRepositoryPlan = {
  name: string;
  targetPath: string;
  removable: boolean;
  reason: string;
};

type GcOptions = {
  apply: boolean;
  forceApply: boolean;
};

export function runGc(options: GcOptions): void {
  const plan = buildGcPlan();
  console.log(formatGcPlan(plan, options));

  if (!options.apply && !options.forceApply) {
    console.log("No filesystem changes were made. Re-run with `--apply` to remove expired archives or `--force-apply` to ignore TTL.");
    return;
  }

  applyGcPlan(plan, options);
}

function buildGcPlan(): GcPlan {
  const archiveRoot = path.resolve(ARCHIVE_ROOT);

  if (!existsSync(archiveRoot)) {
    return {
      archiveRoot,
      workspaces: [],
    };
  }

  const workspaces = readdirSync(archiveRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(archiveRoot, entry.name))
    .map(readWorkspaceArchive)
    .filter((workspace): workspace is GcWorkspacePlan => workspace !== null);

  return {
    archiveRoot,
    workspaces,
  };
}

function readWorkspaceArchive(archiveDir: string): GcWorkspacePlan | null {
  const metadataPath = path.join(archiveDir, "metadata.json");

  if (!existsSync(metadataPath)) {
    return {
      workspaceName: path.basename(archiveDir),
      archiveDir,
      expired: false,
      expiresAt: new Date(Number.POSITIVE_INFINITY),
      repositories: [],
      blockers: [`missing metadata: ${metadataPath}`],
    };
  }

  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as ArchiveMetadata;
  const archivedAt = new Date(metadata.archivedAt);
  const expiresAt = new Date(archivedAt.getTime() + metadata.ttlDays * 24 * 60 * 60 * 1000);
  const expired = Date.now() >= expiresAt.getTime();
  const repositories = metadata.repositories.map(planRepositoryGc);
  const blockers = repositories.filter((repository) => !repository.removable).map((repository) => `${repository.name}: ${repository.reason}`);

  return {
    workspaceName: metadata.workspaceName,
    archiveDir,
    expired,
    expiresAt,
    repositories,
    blockers,
  };
}

function planRepositoryGc(repository: ArchiveMetadata["repositories"][number]): GcRepositoryPlan {
  const targetExists = existsSync(repository.targetPath);

  if (!targetExists) {
    return {
      name: repository.name,
      targetPath: repository.targetPath,
      removable: true,
      reason: "target already missing",
    };
  }

  const status = statusTargetPath({
    name: repository.name,
    targetPath: repository.targetPath,
    expectedRef: repository.ref,
    targetExists,
  });

  if (status.gitStatus !== "git-repo") {
    return {
      name: repository.name,
      targetPath: repository.targetPath,
      removable: false,
      reason: `target is ${status.gitStatus}`,
    };
  }

  if (status.dirty) {
    return {
      name: repository.name,
      targetPath: repository.targetPath,
      removable: false,
      reason: "dirty worktree",
    };
  }

  if ((status.ahead ?? 0) > 0) {
    return {
      name: repository.name,
      targetPath: repository.targetPath,
      removable: false,
      reason: `${status.ahead} commits ahead of upstream`,
    };
  }

  if (status.branchMatches === false) {
    return {
      name: repository.name,
      targetPath: repository.targetPath,
      removable: false,
      reason: `branch mismatch: expected ${repository.ref}, got ${status.currentBranch ?? "unknown"}`,
    };
  }

  return {
    name: repository.name,
    targetPath: repository.targetPath,
    removable: true,
    reason: "clean archived worktree",
  };
}

function formatGcPlan(plan: GcPlan, options: GcOptions): string {
  const lines: string[] = [];

  lines.push(`Archive root: ${plan.archiveRoot}`);
  lines.push(`Mode: ${gcMode(options)}`);

  if (plan.workspaces.length === 0) {
    lines.push("");
    lines.push("No archived workspaces found.");
    return lines.join("\n");
  }

  for (const workspace of plan.workspaces) {
    lines.push("");
    lines.push(`- ${workspace.workspaceName}`);
    lines.push(`  archive: ${workspace.archiveDir}`);
    lines.push(`  expired: ${workspace.expired ? "yes" : "no"}`);
    lines.push(`  expires at: ${Number.isFinite(workspace.expiresAt.getTime()) ? workspace.expiresAt.toISOString() : "unknown"}`);

    if (workspace.blockers.length > 0) {
      lines.push("  blockers:");
      for (const blocker of workspace.blockers) {
        lines.push(`    ${blocker}`);
      }
    }

    lines.push("  worktrees:");
    for (const repository of workspace.repositories) {
      const action = shouldRemoveWorkspace(workspace, options) && repository.removable ? "remove" : "keep";
      lines.push(`    ${action} ${repository.name}: ${repository.reason}`);
      lines.push(`      ${repository.targetPath}`);
    }
  }

  return lines.join("\n");
}

function applyGcPlan(plan: GcPlan, options: GcOptions): void {
  for (const workspace of plan.workspaces) {
    if (!shouldRemoveWorkspace(workspace, options)) {
      continue;
    }

    for (const repository of workspace.repositories) {
      if (repository.removable && existsSync(repository.targetPath)) {
        removeWorktree(repository.targetPath);
      }
    }

    rmSync(workspace.archiveDir, { recursive: true, force: true });
    console.log(`Removed archived workspace: ${workspace.workspaceName}`);
  }
}

function shouldRemoveWorkspace(workspace: GcWorkspacePlan, options: GcOptions): boolean {
  const ttlAllowsRemoval = workspace.expired || options.forceApply;
  return ttlAllowsRemoval && workspace.blockers.length === 0;
}

function gcMode(options: GcOptions): string {
  if (options.forceApply) {
    return "force-apply";
  }

  if (options.apply) {
    return "apply";
  }

  return "dry-run";
}

function removeWorktree(targetPath: string): void {
  const commonDir = spawnSync("git", ["-C", targetPath, "rev-parse", "--git-common-dir"], {
    encoding: "utf8",
  });

  if (commonDir.error) {
    throw commonDir.error;
  }

  if (commonDir.status !== 0) {
    throw new Error(`Failed to resolve git common dir for worktree: ${targetPath}`);
  }

  const result = spawnSync("git", ["--git-dir", commonDir.stdout.trim(), "worktree", "remove", targetPath], {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Failed to remove worktree: ${targetPath}`);
  }
}
