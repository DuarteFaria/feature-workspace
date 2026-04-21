import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import type { PlannedCommand, WorkspacePlan } from "./domain";

const MACOS_ZED_CLI = "/Applications/Zed.app/Contents/MacOS/cli";
const MACOS_ZED_BINARY = "/Applications/Zed.app/Contents/MacOS/zed";

export function buildEditorCommand(commandName: string, args: string[], options: { newWindow: boolean }): PlannedCommand {
  const resolvedCommand = resolveEditorCommand(commandName);
  const resolvedArgs = commandName === "zed" && options.newWindow ? ["-n", ...args] : args;

  return {
    command: resolvedCommand,
    args: resolvedArgs,
    display: shellJoin([resolvedCommand, ...resolvedArgs]),
  };
}

export function openEditor(plan: WorkspacePlan): void {
  const missingTargets = plan.repositories.filter((repository) => !repository.targetExists);

  if (missingTargets.length > 0) {
    const names = missingTargets.map((repository) => repository.name).join(", ");
    throw new Error(`Cannot open workspace because target paths do not exist for: ${names}. Run \`fw apply\` first.`);
  }

  console.log(`Opening editor: ${plan.editorCommand.display}`);

  const child = spawn(plan.editorCommand.command, plan.editorCommand.args, {
    stdio: "inherit",
    detached: true,
  });

  child.unref();
}

function resolveEditorCommand(commandName: string): string {
  if (commandName !== "zed") {
    return commandName;
  }

  const pathCommand = spawnSync("command", ["-v", "zed"], {
    encoding: "utf8",
    shell: true,
  });

  const pathResult = pathCommand.stdout.trim();
  if (pathCommand.status === 0 && pathResult !== "") {
    return pathResult;
  }

  if (existsSync(MACOS_ZED_CLI)) {
    return MACOS_ZED_CLI;
  }

  if (existsSync(MACOS_ZED_BINARY)) {
    return MACOS_ZED_BINARY;
  }

  throw new Error(
    "Zed CLI was not found. Install the `zed` shell command or set editor.command to the Zed binary path.",
  );
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
