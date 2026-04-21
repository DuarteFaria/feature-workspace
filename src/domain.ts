export type WorkspaceManifest = {
  name: string;
  archive?: {
    ttlDays?: number;
  };
  defaults?: {
    ref?: string;
    worktree?: boolean;
    sourceRoot?: string;
    worktreeRoot?: string;
    createFrom?: string;
  };
  editor?: {
    command?: string;
    newWindow?: boolean;
  };
  repositories: RepositoryManifest[];
};

export type RepositoryManifest = {
  name: string;
  sourcePath: string;
  ref?: string;
  worktree?: boolean;
  worktreePath?: string;
  createFrom?: string;
};

export type WorkspaceConfig = {
  archive?: {
    ttlDays?: number;
  };
  defaults?: {
    ref?: string;
    worktree?: boolean;
    sourceRoot?: string;
    worktreeRoot?: string;
    createFrom?: string;
  };
  editor?: {
    command?: string;
    newWindow?: boolean;
  };
};

export type WorkspacePlan = {
  workspaceName: string;
  archiveTtlDays: number;
  repositories: RepositoryPlan[];
  editorCommand: PlannedCommand;
  warnings: PlanWarning[];
};

export type RepositoryPlan = {
  name: string;
  sourcePath: string;
  targetPath: string;
  ref: string;
  createFrom: string | null;
  requestedCreateFrom: string | null;
  refExists: boolean | null;
  usesWorktree: boolean;
  sourceExists: boolean;
  targetExists: boolean;
  gitStatus: "git-repo" | "not-git-repo" | "missing";
  plannedCommands: PlannedCommand[];
};

export type PlannedCommand = {
  command: string;
  args: string[];
  display: string;
};

export type PlanWarning = {
  severity: "critical" | "warning";
  message: string;
};

export type WorkspaceStatus = {
  workspaceName: string;
  repositories: RepositoryStatus[];
  editorReady: boolean;
};

export type RepositoryStatus = {
  name: string;
  targetPath: string;
  expectedRef: string;
  targetExists: boolean;
  gitStatus: "git-repo" | "not-git-repo" | "missing";
  currentBranch: string | null;
  branchMatches: boolean | null;
  dirty: boolean | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
};
