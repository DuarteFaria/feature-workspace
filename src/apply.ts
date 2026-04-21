import { mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import type { PlannedCommand, WorkspacePlan } from "./domain";

type ApplyPlanOptions = {
  confirmQuestion?: string;
};

export async function applyPlan(plan: WorkspacePlan, options: ApplyPlanOptions = {}): Promise<boolean> {
  const criticalWarnings = plan.warnings.filter((warning) => warning.severity === "critical");

  if (criticalWarnings.length > 0) {
    throw new Error("Cannot apply a plan with critical warnings. Run `fw plan` and fix them first.");
  }

  const commands = plan.repositories.flatMap((repository) =>
    repository.plannedCommands.map((command) => ({
      repositoryName: repository.name,
      targetPath: repository.targetPath,
      command,
    })),
  );

  if (commands.length === 0) {
    console.log("Nothing to apply. All planned targets already exist or no mutable actions are required.");
    return true;
  }

  const confirmed = await confirm(options.confirmQuestion ?? "Apply this plan and create the planned worktrees? [y/N] ");
  if (!confirmed) {
    console.log("Apply aborted. No filesystem changes were made.");
    return false;
  }

  for (const item of commands) {
    mkdirSync(path.dirname(item.targetPath), { recursive: true });
    runCommand(item.command, item.repositoryName);
  }

  console.log("Apply complete.");
  return true;
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
