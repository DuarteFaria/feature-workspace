import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WorkspaceConfig, WorkspaceManifest } from "./domain";
import { loadManifest, loadWorkspaceConfig, serializeManifest } from "./config";

const FW_ROOT = ".fw";
const ACTIVE_WORKSPACES_DIR = ".fw/workspaces";
const ARCHIVE_DIR = ".fw/archive";
const CONFIG_PATH = ".fw/config.yaml";

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
}): WorkspaceRef {
  ensureFwStructure();

  const manifestPath = activeWorkspacePath(input.name);

  if (existsSync(manifestPath)) {
    throw new Error(`Active workspace already exists: ${manifestPath}`);
  }

  const config = loadWorkspaceConfig(CONFIG_PATH);
  const manifest = manifestFromConfig(input.name, input.repos, config);
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

function manifestFromConfig(name: string, repos: string[], config: WorkspaceConfig): WorkspaceManifest {
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
      ...(config.defaults?.createFrom ? { createFrom: config.defaults.createFrom } : {}),
    },
    editor: {
      command: config.editor?.command ?? "zed",
      newWindow: config.editor?.newWindow ?? true,
    },
    repositories: repos.map((repo) => ({
      name: repo,
      sourcePath: repo,
    })),
  };
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

editor:
  command: zed
  newWindow: true
`;
}
