import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { WorkspaceConfig, WorkspaceManifest } from "./domain";
import { expandPath, expandPathExpression, loadManifest, loadWorkspaceConfig, serializeManifest } from "./config";
import { DEFAULT_TMUX_RUNTIME } from "./runtime";

const FW_ROOT = ".fw";
const ACTIVE_WORKSPACES_DIR = ".fw/workspaces";
const ARCHIVE_DIR = ".fw/archive";
const CONFIG_PATH = ".fw/config.yaml";
const DEFAULT_COPY_IGNORED = [".env", ".npmrc", "secrets/jwtKey", "secrets/jwtKey.pub"];

export type WorkspaceRef = {
  input: string;
  manifestPath: string;
  manifest: WorkspaceManifest;
  source: "active" | "archive" | "path";
};

export function loadWorkspace(input: string): WorkspaceRef {
  const manifestPath = resolveWorkspaceManifestPath(input);
  const manifest = loadManifest(manifestPath);

  return {
    input,
    manifestPath,
    manifest,
    source: classifyWorkspaceSource(input, manifestPath),
  };
}

export function createWorkspaceManifest(input: {
  name: string;
  repos: string[];
  createFrom?: string;
}): WorkspaceRef {
  ensureFwStructure();

  const manifestPath = activeWorkspacePath(input.name);

  if (existsSync(manifestPath)) {
    throw new Error(`Active workspace already exists: ${manifestPath}`);
  }

  const config = loadWorkspaceConfig(CONFIG_PATH);
  const manifest = manifestFromConfig(input.name, input.repos, config, input.createFrom);
  writeFileSync(manifestPath, serializeManifest(manifest));

  return {
    input: input.name,
    manifestPath,
    manifest,
    source: "active",
  };
}

export function ensureFwStructure(): void {
  mkdirSync(FW_ROOT, { recursive: true });
  mkdirSync(ACTIVE_WORKSPACES_DIR, { recursive: true });
  mkdirSync(ARCHIVE_DIR, { recursive: true });

  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, defaultConfig());
  }
}

function resolveWorkspaceManifestPath(input: string): string {
  if (looksLikePath(input)) {
    return path.resolve(input);
  }

  const activePath = activeWorkspacePath(input);
  if (existsSync(activePath)) {
    return activePath;
  }

  const archivedPath = archivedWorkspacePath(input);
  if (existsSync(archivedPath)) {
    return archivedPath;
  }

  throw new Error(`Workspace not found: ${input}`);
}

function archivedWorkspacePath(name: string): string {
  const archiveWorkspaceDir = path.resolve(ARCHIVE_DIR, name);
  const defaultPath = path.join(archiveWorkspaceDir, `${name}.yaml`);

  if (existsSync(defaultPath)) {
    return defaultPath;
  }

  if (!existsSync(archiveWorkspaceDir)) {
    return defaultPath;
  }

  const manifest = readdirSync(archiveWorkspaceDir).find((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"));
  return manifest ? path.join(archiveWorkspaceDir, manifest) : defaultPath;
}

function classifyWorkspaceSource(input: string, manifestPath: string): WorkspaceRef["source"] {
  if (looksLikePath(input)) {
    return "path";
  }

  if (manifestPath.startsWith(path.resolve(ACTIVE_WORKSPACES_DIR))) {
    return "active";
  }

  return "archive";
}

function activeWorkspacePath(name: string): string {
  return path.resolve(ACTIVE_WORKSPACES_DIR, `${name}.yaml`);
}

function manifestFromConfig(
  name: string,
  repos: string[],
  config: WorkspaceConfig,
  createFromOverride?: string,
): WorkspaceManifest {
  const defaultCreateFrom = createFromOverride ?? config.defaults?.createFrom;
  const copyIgnored = config.defaults?.copyIgnored ?? DEFAULT_COPY_IGNORED;

  return {
    name,
    archive: {
      ttlDays: config.archive?.ttlDays ?? 7,
    },
    defaults: {
      ref: config.defaults?.ref ?? name,
      worktree: config.defaults?.worktree ?? true,
      sourceRoot: config.defaults?.sourceRoot ?? "~/Documents/intuitivo",
      worktreeRoot: config.defaults?.worktreeRoot ?? "~/FeatureWorkspaces/{workspace}",
      ...(defaultCreateFrom ? { createFrom: defaultCreateFrom } : {}),
      copyIgnored,
    },
    editor: {
      command: config.editor?.command ?? "zed",
      newWindow: config.editor?.newWindow ?? true,
    },
    runtime: {
      tmux: config.runtime?.tmux ?? DEFAULT_TMUX_RUNTIME,
    },
    repositories: repos.map((repo) => ({
      name: repo,
      sourcePath: repo,
      ...repositoryCreateFrom(name, repo, config, defaultCreateFrom),
    })),
  };
}

function repositoryCreateFrom(
  workspaceName: string,
  repo: string,
  config: WorkspaceConfig,
  defaultCreateFrom?: string,
): { createFrom: string } | Record<string, never> {
  if (defaultCreateFrom) {
    return {};
  }

  const sourcePath = resolveConfiguredSourcePath(workspaceName, repo, config);
  const currentBranch = getCurrentBranch(sourcePath);

  return currentBranch ? { createFrom: currentBranch } : {};
}

function resolveConfiguredSourcePath(workspaceName: string, repo: string, config: WorkspaceConfig): string {
  const variables = {
    workspace: workspaceName,
    repo,
  };
  const expandedSourcePath = expandPathExpression(repo, variables);

  if (path.isAbsolute(expandedSourcePath)) {
    return path.resolve(expandedSourcePath);
  }

  const sourceRoot = config.defaults?.sourceRoot ?? "~/Documents/intuitivo";
  return path.resolve(path.join(expandPath(sourceRoot, variables), expandedSourcePath));
}

function getCurrentBranch(sourcePath: string): string | null {
  if (!existsSync(sourcePath)) {
    return null;
  }

  const result = spawnSync("git", ["-C", sourcePath, "branch", "--show-current"], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  const branch = result.stdout.trim();
  return branch === "" ? null : branch;
}

function looksLikePath(input: string): boolean {
  return input.includes("/") || input.endsWith(".yaml") || input.endsWith(".yml") || input.startsWith(".");
}

function defaultConfig(): string {
  return `archive:
  ttlDays: 7

defaults:
  worktree: true
  sourceRoot: ~/Documents/intuitivo
  worktreeRoot: ~/FeatureWorkspaces/{workspace}
  copyIgnored:
${DEFAULT_COPY_IGNORED.map((pattern) => `    - ${pattern}`).join("\n")}

editor:
  command: zed
  newWindow: true

runtime:
  tmux:
    enabled: true
    sessionName: "{workspaceLower}"
    killExisting: true
    startupDelaySeconds: 2
    shellPrefix: "source ~/.nvm/nvm.sh && nvm use --silent"
    windows:
      - name: intuitivo
        repo: intuitivo
        install: yarn install
        command: yarn start
      - name: tests-backend
        repo: tests-backend
        install: yarn install
        command: yarn dev
      - name: generate-assessment
        repo: generate-assessment
        install: pnpm install
        command: pnpm dev
      - name: auth-backend
        path: "{sourceRoot}/auth-backend"
        install: yarn install
        command: yarn dev
`;
}
