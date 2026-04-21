# Feature Workspace

Personal CLI for planning feature-first, multi-repository workspaces.

`fw create` creates an active workspace manifest, shows the plan, asks for confirmation, creates worktrees, and opens Zed if the apply step succeeds.

`fw plan` is read-only: it reads a workspace manifest and prints the Git worktree actions and Zed command that would be used for the workspace.

`fw apply` prints the same plan, asks for confirmation, and then creates the planned worktrees. It does not open Zed, archive workspaces, or delete anything.

`fw open` opens the planned target paths in one dedicated Zed project window.

`fw status` shows the current state of each target worktree.

`fw archive` moves the manifest into `.fw/archive/<workspace>/` after checking that no target worktree has dirty files or local commits ahead of upstream. It does not delete worktrees yet.

`fw gc` inspects archived workspaces and removes expired, clean worktrees only when run with `--apply`. Without `--apply`, it is a dry-run. `--force-apply` ignores archive TTL but still keeps safety blockers.

## Usage

Install dependencies:

```sh
bun install
```

Plan a workspace:

```sh
bun run fw plan DEV-123
```

Create, apply, and open a workspace:

```sh
bun run fw create DEV-123 --repos intuitivo,tests-backend,generate-assessment
```

Apply a workspace after reviewing the plan:

```sh
bun run fw apply DEV-123
```

Open the workspace in Zed:

```sh
bun run fw open DEV-123
```

Check workspace status:

```sh
bun run fw status DEV-123
```

Archive a workspace manifest:

```sh
bun run fw archive DEV-123
```

Preview garbage collection:

```sh
bun run fw gc
```

Apply garbage collection:

```sh
bun run fw gc --apply
```

Force garbage collection of all safe archives, ignoring TTL:

```sh
bun run fw gc --force-apply
```

## Manifest

Active workspace manifests live under:

```txt
.fw/workspaces/<workspace>.yaml
```

Archived workspace manifests live under:

```txt
.fw/archive/<workspace>/<workspace>.yaml
```

Defaults live under:

```txt
.fw/config.yaml
```

```yaml
name: DEV-123

archive:
  ttlDays: 7

defaults:
  ref: DEV-123
  worktree: true
  sourceRoot: ~/Documents/intuitivo
  worktreeRoot: ~/FeatureWorkspaces/{workspace}

editor:
  command: zed
  newWindow: true

repositories:
  - name: intuitivo
    sourcePath: intuitivo
```

See [examples/template.yaml](examples/template.yaml) for a complete local manifest template.

Supported placeholders:

- `{workspace}`: workspace name, for example `DEV-123`
- `{repo}`: repository name
- `~`: current user's home directory
- `$ENV_VAR`: environment variable expansion

Repository `sourcePath` values can be absolute or relative. Relative values are resolved from `defaults.sourceRoot`.

Worktree base refs are resolved in this order:

- repository `createFrom`
- `defaults.createFrom`
- `origin/HEAD`
- local `main` or `master`
- remote `origin/main` or `origin/master`

## Current Scope

- Creates active workspace manifests from `.fw/config.yaml`
- Builds a read-only execution plan
- Applies a plan after explicit confirmation
- Expands local paths
- Detects missing source repositories
- Detects whether a source path is a Git work tree
- Prints planned `git worktree add` commands
- Creates planned Git worktrees
- Prints the editor command for a dedicated Zed project window
- Opens target paths in Zed
- Falls back to `/Applications/Zed.app/Contents/MacOS/cli` when `zed` is not installed in `PATH`
- Shows branch, dirty state, upstream, and ahead/behind status for each target worktree
- Archives manifests under `.fw/archive/<workspace>/`
- Previews garbage collection with `fw gc`
- Removes expired archived worktrees with `fw gc --apply`
- Removes all safe archived worktrees regardless of TTL with `fw gc --force-apply`

## Not Implemented Yet

- Removing local branches during garbage collection
- Branch/ref existence checks

## Garbage Collection Safety

`fw gc --apply` will not remove a worktree when:

- the archive has not expired
- archive metadata is missing
- the target is not a Git worktree
- the worktree is dirty
- the branch has commits ahead of upstream
- the current branch does not match the archived ref

`fw gc --force-apply` ignores only the archive TTL. It still respects metadata, dirty worktree, ahead commits, Git status, and branch mismatch blockers.

Garbage collection does not delete local branches.
