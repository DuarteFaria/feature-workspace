import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import type { WorkspaceConfig, WorkspaceManifest } from "./domain";

export function loadManifest(filePath: string): WorkspaceManifest {
  const resolvedPath = path.resolve(filePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Manifest not found: ${resolvedPath}`);
  }

  const raw = readFileSync(resolvedPath, "utf8");
  const parsed = YAML.parse(raw) as unknown;

  return validateManifest(parsed, resolvedPath);
}

export function loadWorkspaceConfig(filePath: string): WorkspaceConfig {
  const resolvedPath = path.resolve(filePath);

  if (!existsSync(resolvedPath)) {
    return {};
  }

  const raw = readFileSync(resolvedPath, "utf8");
  const parsed = YAML.parse(raw) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`Invalid config ${resolvedPath}: expected an object`);
  }

  return parsed as WorkspaceConfig;
}

export function serializeManifest(manifest: WorkspaceManifest): string {
  return YAML.stringify(manifest);
}

export function expandPath(value: string, variables: Record<string, string>): string {
  return path.resolve(expandPathExpression(value, variables));
}

export function expandPathExpression(value: string, variables: Record<string, string>): string {
  let expanded = value;

  if (expanded === "~" || expanded.startsWith("~/")) {
    expanded = path.join(homedir(), expanded.slice(2));
  }

  expanded = expanded.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key: string) => {
    return variables[key] ?? `{${key}}`;
  });

  expanded = expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, key: string) => {
    return process.env[key] ?? `$${key}`;
  });

  return expanded;
}

function validateManifest(value: unknown, source: string): WorkspaceManifest {
  if (!isRecord(value)) {
    throw new Error(`Invalid manifest ${source}: expected an object`);
  }

  if (typeof value.name !== "string" || value.name.trim() === "") {
    throw new Error(`Invalid manifest ${source}: "name" is required`);
  }

  if (!Array.isArray(value.repositories) || value.repositories.length === 0) {
    throw new Error(`Invalid manifest ${source}: "repositories" must contain at least one repository`);
  }

  for (const [index, repository] of value.repositories.entries()) {
    if (!isRecord(repository)) {
      throw new Error(`Invalid manifest ${source}: repositories[${index}] must be an object`);
    }

    if (typeof repository.name !== "string" || repository.name.trim() === "") {
      throw new Error(`Invalid manifest ${source}: repositories[${index}].name is required`);
    }

    if (typeof repository.sourcePath !== "string" || repository.sourcePath.trim() === "") {
      throw new Error(`Invalid manifest ${source}: repositories[${index}].sourcePath is required`);
    }
  }

  return value as WorkspaceManifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
