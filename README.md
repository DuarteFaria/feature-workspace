# Feature Workspace

Personal CLI for planning feature-first, multi-repository workspaces.

`fw create` creates an active workspace manifest, shows the plan, asks for confirmation, creates worktrees, and opens Zed if the apply step succeeds.

`fw plan` is read-only: it reads a workspace manifest and prints the Git worktree actions and Zed command that would be used for the workspace.

`fw apply` prints the same plan, asks for confirmation, and then creates the planned worktrees and copies configured ignored runtime files. It does not open Zed, archive workspaces, or delete anything.

`fw open` starts the configured tmux runtime session, then opens the feature workspace root in one dedicated Zed project window when all target worktrees live under that root.

`fw status` shows the current state of each target worktree.

`fw archive` moves the manifest into `.fw/archive/<workspace>/` after checking that no target worktree has dirty files or local commits ahead of upstream. It does not delete worktrees yet.

`fw gc` inspects archived workspaces and removes expired, clean worktrees only when run with `--apply`. Without `--apply`, it is a dry-run. `--force-apply` ignores archive TTL but still keeps safety blockers.

## Usage

Install dependencies:

```sh
bun install
```

Run tests:

```sh
bun test
```

Plan a workspace:

```sh
bun run fw plan DEV-123
```

Create, apply, and open a workspace:

```sh
bun run fw create DEV-123 --repos intuitivo,tests-backend,generate-assessment
```

By default, `fw create` records each selected source repository's currently checked-out branch as the worktree base ref. To create a workspace branch from a specific base ref instead:

```sh
bun run fw create DEV-830 --repos intuitivo --create-from DEV-790
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

When archiving a manifest from a custom path, `fw archive` preserves that manifest filename under `.fw/archive/<workspace>/`.

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
  copyIgnored:
    - .env
    - .npmrc
    - secrets/jwtKey
    - secrets/jwtKey.pub

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

repositories:
  - name: intuitivo
    sourcePath: intuitivo
```

See [examples/template.yaml](examples/template.yaml) for a complete local manifest template.

Supported placeholders:

- `{workspace}`: workspace name, for example `DEV-123`
- `{workspaceLower}` / `{workspaceSlug}`: lower-case workspace name, for example `dev-123`
- `{repo}`: repository name
- `{sourceRoot}`: expanded `defaults.sourceRoot`, available in runtime paths
- `{worktreeRoot}`: expanded `defaults.worktreeRoot`, available in runtime paths
- `~`: current user's home directory
- `$ENV_VAR`: environment variable expansion

Repository `sourcePath` values can be absolute or relative. Relative values are resolved from `defaults.sourceRoot`.

`copyIgnored` is an explicit list of Git pathspecs for ignored runtime files to copy from the source checkout into the worktree. When config omits it, `fw create` defaults to `.env`, `.npmrc`, `secrets/jwtKey`, and `secrets/jwtKey.pub`. `fw apply` only copies files Git reports as ignored, and it skips a target file that already exists. Dependency folders such as `node_modules` are intentionally not copied; install them inside the worktree with the repository package manager.

Worktree base refs are resolved in this order:

- repository `createFrom`
- `defaults.createFrom`
- `origin/HEAD`
- local `main` or `master`
- remote `origin/main` or `origin/master`

When `fw create` generates a manifest without `--create-from`, it writes the current source repository branch into repository `createFrom`.

## tmux Runtime

`runtime.tmux.windows` defines the commands `fw open` starts. A window with `repo` uses that repository's target path from the workspace; if the workspace does not include that repository, the window is skipped. A window with `path` always uses that expanded path, which is useful for baseline services such as `auth-backend`.

Each tmux window runs:

```sh
cd <path> && <shellPrefix> && <install> && <command>
```

By default, `fw open` opens the editor first, then kills an existing tmux session with the same name, kills processes matching each planned window path, waits two seconds, creates the session, waits `startupDelaySeconds`, and prints `tmux list-windows`.

## Current Scope

- Creates active workspace manifests from `.fw/config.yaml`
- Builds an execution plan without applying Git worktree or editor actions
- Applies a plan after explicit confirmation
- Expands local paths
- Detects missing source repositories
- Detects whether a source path is a Git work tree
- Prints planned `git worktree add` commands
- Creates planned Git worktrees
- Copies configured ignored runtime files into worktrees
- Starts configured tmux runtime sessions from `fw open`
- Prints the editor command for a dedicated Zed project window
- Opens the feature workspace root in Zed, falling back to target paths when targets do not share the configured worktree root
- Falls back to `/Applications/Zed.app/Contents/MacOS/cli`, then `/Applications/Zed.app/Contents/MacOS/zed`, when `zed` is not installed in `PATH`
- Shows branch, dirty state, upstream, and ahead/behind status for each target worktree
- Archives manifests under `.fw/archive/<workspace>/`
- Previews garbage collection with `fw gc`
- Removes expired archived worktrees with `fw gc --apply`
- Removes all safe archived worktrees regardless of TTL with `fw gc --force-apply`

## Not Implemented Yet

- Removing local branches during garbage collection
- Full branch/ref existence checks, including explicit validation of configured base refs

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
