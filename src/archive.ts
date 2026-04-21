import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WorkspaceManifest, WorkspacePlan } from "./domain";
import { buildStatus, hasLocalChanges } from "./status";

const ARCHIVE_ROOT = ".fw/archive";

export function archiveWorkspace(manifestPath: string, manifest: WorkspaceManifest, plan: WorkspacePlan): void {
  const status = buildStatus(plan);

  if (hasLocalChanges(status)) {
    throw new Error("Cannot archive workspace with dirty files or local commits ahead of upstream.");
  }

  const archiveDir = path.resolve(ARCHIVE_ROOT, manifest.name);
  mkdirSync(archiveDir, { recursive: true });

  const resolvedManifestPath = path.resolve(manifestPath);
  const manifestTarget = path.join(archiveDir, path.basename(resolvedManifestPath));

  if (existsSync(manifestTarget)) {
    throw new Error(`Archive already exists: ${manifestTarget}`);
  }

  renameSync(resolvedManifestPath, manifestTarget);
  writeFileSync(
    path.join(archiveDir, "metadata.json"),
    `${JSON.stringify(
      {
        archivedAt: new Date().toISOString(),
        ttlDays: plan.archiveTtlDays,
        workspaceName: manifest.name,
        manifestPath: manifestTarget,
        repositories: plan.repositories.map((repository) => ({
          name: repository.name,
          sourcePath: repository.sourcePath,
          targetPath: repository.targetPath,
          ref: repository.ref,
        })),
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Archived workspace manifest to ${manifestTarget}`);
  console.log("Worktrees were not deleted.");
}
