#!/usr/bin/env bun
import { applyPlan } from "./apply";
import { archiveWorkspace } from "./archive";
import { openEditor } from "./editor";
import { runGc } from "./gc";
import { buildPlan, formatPlan } from "./plan";
import { startTmuxSession } from "./runtime";
import { buildStatus, formatStatus } from "./status";
import { createWorkspaceManifest, loadWorkspace } from "./workspaceStore";

const [, , command, ...commandArgs] = process.argv;
const [manifestPath] = commandArgs;

try {
  if (command === "gc") {
    const apply = commandArgs.includes("--apply");
    const forceApply = commandArgs.includes("--force-apply");

    if (apply && forceApply) {
      throw new Error("Use either `--apply` or `--force-apply`, not both.");
    }

    runGc({ apply, forceApply });
    process.exit(0);
  }

  if (command === "create") {
    const workspaceName = commandArgs[0];
    const repos = parseRepos(commandArgs);
    const createFrom = parseOptionalValueFlag(commandArgs, ["--create-from", "--base"]);

    if (!workspaceName || repos.length === 0) {
      printUsage();
      process.exit(1);
    }

    const workspace = createWorkspaceManifest({
      name: workspaceName,
      repos,
      ...(createFrom ? { createFrom } : {}),
    });
    const plan = buildPlan(workspace.manifest);
    console.log(`Created active manifest: ${workspace.manifestPath}`);
    console.log(formatPlan(plan, { mutationNotice: "No filesystem changes have been made yet." }));

    const applied = await applyPlan(plan, {
      confirmQuestion: "Create worktrees, copy ignored files, and open Zed? [y/N] ",
    });

    if (applied) {
      openEditor(buildPlan(workspace.manifest));
    }

    process.exit(0);
  }

  if (
    (command !== "plan" && command !== "apply" && command !== "open" && command !== "status" && command !== "archive") ||
    !manifestPath
  ) {
    printUsage();
    process.exit(command === "--help" || command === "-h" ? 0 : 1);
  }

  const workspace = loadWorkspace(manifestPath);
  const plan = buildPlan(workspace.manifest);
  const mutationNotice = mutationNoticeFor(command);

  if (command === "status") {
    console.log(formatStatus(buildStatus(plan)));
    process.exit(0);
  }

  console.log(formatPlan(plan, { mutationNotice }));

  if (command === "apply") {
    await applyPlan(plan);
  }

  if (command === "open") {
    openEditor(plan);
    await startTmuxSession(plan);
  }

  if (command === "archive") {
    archiveWorkspace(workspace.manifestPath, workspace.manifest, plan);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`fw: ${message}`);
  process.exit(1);
}

function mutationNoticeFor(command: string): string {
  if (command === "apply" || command === "archive") {
    return "No filesystem changes have been made yet.";
  }

  return "No filesystem changes were made.";
}

function printUsage(): void {
  console.log(`Usage:
  fw create <workspace> --repos repo-a,repo-b [--create-from ref]
  fw plan <workspace|manifest.yaml>
  fw apply <workspace|manifest.yaml>
  fw open <workspace|manifest.yaml>
  fw status <workspace|manifest.yaml>
  fw archive <workspace|manifest.yaml>
  fw gc [--apply|--force-apply]

Examples:
  bun run fw create DEV-123 --repos intuitivo,tests-backend,generate-assessment
  bun run fw create DEV-830 --repos intuitivo --create-from DEV-790
  bun run fw plan DEV-123
  bun run fw apply DEV-123
  bun run fw open DEV-123
  bun run fw status DEV-123
  bun run fw archive DEV-123
  bun run fw gc
  bun run fw gc --apply
  bun run fw gc --force-apply`);
}

function parseRepos(args: string[]): string[] {
  const reposFlagIndex = args.findIndex((arg) => arg === "--repos");

  if (reposFlagIndex === -1) {
    return [];
  }

  const reposValue = args[reposFlagIndex + 1];

  if (!reposValue) {
    return [];
  }

  return reposValue
    .split(",")
    .map((repo) => repo.trim())
    .filter(Boolean);
}

function parseOptionalValueFlag(args: string[], flags: string[]): string | undefined {
  for (const flag of flags) {
    const flagIndex = args.findIndex((arg) => arg === flag);

    if (flagIndex === -1) {
      continue;
    }

    const value = args[flagIndex + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }

    return value;
  }

  return undefined;
}
