import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import type { PlannedCommand, PlannedFileCopy, WorkspacePlan } from "./domain";

type ApplyPlanOptions = {
  confirmQuestion?: string;
};

export async function applyPlan(plan: WorkspacePlan, options: ApplyPlanOptions = {}): Promise<boolean> {
  const criticalWarnings = plan.warnings.filter((warning) => warning.severity === "critical");

  if (criticalWarnings.length > 0) {
    throw new Error("Cannot apply a plan with critical warnings. Run `fw plan` and fix them first.");
  }

  const plannedRepositories = plan.repositories
    .map((repository) => ({
      repositoryName: repository.name,
      targetPath: repository.targetPath,
      commands: repository.plannedCommands,
      fileCopies: repository.plannedFileCopies,
    }))
    .filter((repository) => repository.commands.length > 0 || repository.fileCopies.length > 0);

  if (plannedRepositories.length === 0) {
    console.log("Nothing to apply. All planned targets already exist or no mutable actions are required.");
    return true;
  }

  const confirmed = await confirm(options.confirmQuestion ?? "Apply this plan and make the planned filesystem changes? [y/N] ");
  if (!confirmed) {
    console.log("Apply aborted. No filesystem changes were made.");
    return false;
  }

  for (const repository of plannedRepositories) {
    for (const command of repository.commands) {
      mkdirSync(path.dirname(repository.targetPath), { recursive: true });
      runCommand(command, repository.repositoryName);
    }

    for (const fileCopy of repository.fileCopies) {
      runFileCopy(fileCopy, repository.repositoryName);
    }
  }

  console.log("Apply complete.");
  return true;
}

function runFileCopy(fileCopy: PlannedFileCopy, repositoryName: string): void {
  if (existsSync(fileCopy.targetPath)) {
    console.log(`Skipping for ${repositoryName}: ${fileCopy.relativePath} already exists`);
    return;
  }

  mkdirSync(path.dirname(fileCopy.targetPath), { recursive: true });
  console.log(`Copying for ${repositoryName}: ${fileCopy.display}`);
  copyFileSync(fileCopy.sourcePath, fileCopy.targetPath);
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

function runCommand(command: PlannedCommand, repositoryName: string): void {
  console.log(`Running for ${repositoryName}: ${command.display}`);

  const result = spawnSync(command.command, command.args, {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${repositoryName}: command failed with exit code ${result.status}: ${command.display}`);
  }
}
