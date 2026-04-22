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
    copyIgnored?: string[];
  };
  editor?: {
    command?: string;
    newWindow?: boolean;
  };
  runtime?: RuntimeManifest;
  repositories: RepositoryManifest[];
};

export type RepositoryManifest = {
  name: string;
  sourcePath: string;
  ref?: string;
  worktree?: boolean;
  worktreePath?: string;
  createFrom?: string;
  copyIgnored?: string[];
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
    copyIgnored?: string[];
  };
  editor?: {
    command?: string;
    newWindow?: boolean;
  };
  runtime?: RuntimeManifest;
};

export type WorkspacePlan = {
  workspaceName: string;
  archiveTtlDays: number;
  repositories: RepositoryPlan[];
  editorCommand: PlannedCommand;
  tmuxSession: TmuxSessionPlan | null;
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
  plannedFileCopies: PlannedFileCopy[];
};

export type PlannedCommand = {
  command: string;
  args: string[];
  display: string;
};

export type RuntimeManifest = {
  tmux?: TmuxRuntimeManifest;
};

export type TmuxRuntimeManifest = {
  enabled?: boolean;
  sessionName?: string;
  killExisting?: boolean;
  killProcessPatterns?: string[];
  startupDelaySeconds?: number;
  shellPrefix?: string;
  windows?: TmuxWindowManifest[];
};

export type TmuxWindowManifest = {
  name: string;
  repo?: string;
  path?: string;
  install?: string;
  command: string;
  shellPrefix?: string;
};

export type TmuxSessionPlan = {
  sessionName: string;
  killExisting: boolean;
  killProcessPatterns: string[];
  startupDelaySeconds: number;
  windows: TmuxWindowPlan[];
};

export type TmuxWindowPlan = {
  name: string;
  path: string;
  installCommand: string | null;
  runCommand: string;
  shellCommand: string;
  display: string;
};

export type PlannedFileCopy = {
  sourcePath: string;
  targetPath: string;
  relativePath: string;
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
