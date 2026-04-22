import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type {
  RepositoryPlan,
  TmuxRuntimeManifest,
  TmuxSessionPlan,
  TmuxWindowManifest,
  TmuxWindowPlan,
  WorkspaceManifest,
  WorkspacePlan,
} from "./domain";
import { expandPath, expandPathExpression } from "./config";

export const DEFAULT_TMUX_RUNTIME: TmuxRuntimeManifest = {
  enabled: true,
  killExisting: true,
  startupDelaySeconds: 2,
  shellPrefix: "source ~/.nvm/nvm.sh && nvm use --silent",
  windows: [
    {
      name: "intuitivo",
      repo: "intuitivo",
      install: "yarn install",
      command: "yarn start",
    },
    {
      name: "tests-backend",
      repo: "tests-backend",
      install: "yarn install",
      command: "yarn dev",
    },
    {
      name: "generate-assessment",
      repo: "generate-assessment",
      install: "pnpm install",
      command: "pnpm dev",
    },
    {
      name: "auth-backend",
      path: "{sourceRoot}/auth-backend",
      install: "yarn install",
      command: "yarn dev",
    },
  ],
};

type RuntimeVariables = {
  workspace: string;
  workspaceLower: string;
  workspaceSlug: string;
  sourceRoot: string;
  worktreeRoot: string;
};

export function buildTmuxSessionPlan(
  manifest: WorkspaceManifest,
  repositories: RepositoryPlan[],
): TmuxSessionPlan | null {
  const runtime = manifest.runtime?.tmux;

  if (!runtime) {
    return null;
  }

  if (runtime.enabled === false) {
    return null;
  }

  const variables = runtimeVariables(manifest);
  const defaultShellPrefix = DEFAULT_TMUX_RUNTIME.shellPrefix ?? "";
  const windows = (runtime.windows ?? DEFAULT_TMUX_RUNTIME.windows ?? [])
    .map((window) => planTmuxWindow(window, repositories, variables, runtime.shellPrefix ?? defaultShellPrefix))
    .filter((window): window is TmuxWindowPlan => window !== null);

  if (windows.length === 0) {
    return null;
  }

  const sessionName = expandRuntimeExpression(runtime.sessionName ?? "{workspaceLower}", variables);
  const killProcessPatterns = runtime.killProcessPatterns
    ? runtime.killProcessPatterns.map((pattern) => expandRuntimeExpression(pattern, variables))
    : windows.map((window) => window.path);

  return {
    sessionName,
    killExisting: runtime.killExisting ?? DEFAULT_TMUX_RUNTIME.killExisting ?? true,
    killProcessPatterns,
    startupDelaySeconds: runtime.startupDelaySeconds ?? DEFAULT_TMUX_RUNTIME.startupDelaySeconds ?? 2,
    windows,
  };
}

export async function startTmuxSession(plan: WorkspacePlan): Promise<void> {
  if (!plan.tmuxSession) {
    return;
  }

  ensureTmuxAvailable();

  for (const window of plan.tmuxSession.windows) {
    if (!existsSync(window.path)) {
      throw new Error(`Cannot start tmux window ${window.name}; path does not exist: ${window.path}`);
    }
  }

  if (plan.tmuxSession.killExisting) {
    killExistingSession(plan.tmuxSession.sessionName);
  }

  for (const pattern of plan.tmuxSession.killProcessPatterns) {
    killMatchingProcesses(pattern);
  }

  await sleep(2_000);

  const [firstWindow, ...remainingWindows] = plan.tmuxSession.windows;
  if (!firstWindow) {
    return;
  }

  runTmux(["new-session", "-d", "-s", plan.tmuxSession.sessionName, "-n", firstWindow.name, firstWindow.shellCommand]);

  for (const window of remainingWindows) {
    runTmux(["new-window", "-t", plan.tmuxSession.sessionName, "-n", window.name, window.shellCommand]);
  }

  await sleep(plan.tmuxSession.startupDelaySeconds * 1_000);

  const listWindows = spawnSync("tmux", ["list-windows", "-t", plan.tmuxSession.sessionName], {
    encoding: "utf8",
  });

  if (listWindows.status === 0 && listWindows.stdout.trim() !== "") {
    console.log(listWindows.stdout.trimEnd());
  }
}

function planTmuxWindow(
  window: TmuxWindowManifest,
  repositories: RepositoryPlan[],
  variables: RuntimeVariables,
  defaultShellPrefix: string,
): TmuxWindowPlan | null {
  const repository = window.repo ? repositories.find((candidate) => candidate.name === window.repo) : null;

  if (window.repo && !repository) {
    return null;
  }

  const windowPath = repository?.targetPath ?? (window.path ? expandRuntimePath(window.path, variables) : null);

  if (!windowPath) {
    return null;
  }

  const installCommand = window.install ?? null;
  const runCommand = window.command;
  const shellPrefix = window.shellPrefix ?? defaultShellPrefix;
  const shellCommand = [
    `cd ${shellEscape(windowPath)}`,
    shellPrefix,
    installCommand,
    runCommand,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" && ");

  return {
    name: window.name,
    path: windowPath,
    installCommand,
    runCommand,
    shellCommand,
    display: `tmux ${window.name}: ${shellCommand}`,
  };
}

function runtimeVariables(manifest: WorkspaceManifest): RuntimeVariables {
  const workspace = manifest.name;
  const baseVariables = {
    workspace,
    workspaceLower: workspace.toLowerCase(),
    workspaceSlug: workspace.toLowerCase(),
    repo: "",
  };
  const sourceRoot = expandPath(manifest.defaults?.sourceRoot ?? "~/Documents/intuitivo", baseVariables);
  const worktreeRoot = expandPath(manifest.defaults?.worktreeRoot ?? "~/FeatureWorkspaces/{workspace}", {
    ...baseVariables,
    sourceRoot,
  });

  return {
    workspace,
    workspaceLower: workspace.toLowerCase(),
    workspaceSlug: workspace.toLowerCase(),
    sourceRoot,
    worktreeRoot,
  };
}

function expandRuntimePath(value: string, variables: RuntimeVariables): string {
  return path.resolve(expandRuntimeExpression(value, variables));
}

function expandRuntimeExpression(value: string, variables: RuntimeVariables): string {
  return expandPathExpression(value, {
    workspace: variables.workspace,
    workspaceLower: variables.workspaceLower,
    workspaceSlug: variables.workspaceSlug,
    sourceRoot: variables.sourceRoot,
    worktreeRoot: variables.worktreeRoot,
  });
}

function ensureTmuxAvailable(): void {
  const result = spawnSync("command", ["-v", "tmux"], {
    encoding: "utf8",
    shell: true,
  });

  if (result.status !== 0 || result.stdout.trim() === "") {
    throw new Error("tmux was not found in PATH. Install tmux or set runtime.tmux.enabled to false.");
  }
}

function killExistingSession(sessionName: string): void {
  const hasSession = spawnSync("tmux", ["has-session", "-t", sessionName], {
    stdio: "ignore",
  });

  if (hasSession.status === 0) {
    runTmux(["kill-session", "-t", sessionName]);
  }
}

function killMatchingProcesses(pattern: string): void {
  const result = spawnSync("pgrep", ["-f", pattern], {
    encoding: "utf8",
  });

  if (result.status !== 0 || result.stdout.trim() === "") {
    return;
  }

  for (const rawPid of result.stdout.trim().split(/\s+/)) {
    const pid = Number(rawPid);

    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
      continue;
    }

    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may have exited between pgrep and kill.
    }
  }
}

function runTmux(args: string[]): void {
  const result = spawnSync("tmux", args, {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`tmux ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
