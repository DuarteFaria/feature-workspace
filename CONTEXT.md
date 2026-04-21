# Feature Workspace

This context models a multi-repo developer workflow centered on a single feature. It exists to reduce context switching across repositories, tools, and runtime processes while keeping the working set explicit.

## Language

**Feature Workspace**:
A named working unit for one feature across one or more repositories, branches/refs, tools, and runtime processes.
_Avoid_: Environment, session, setup

**Repository Mapping**:
The explicit association between a **Feature Workspace** and the branch or ref used in each repository.
_Avoid_: Shared branch, implicit branch

**Source Root**:
The base directory used to resolve relative repository paths in a **Declarative Manifest**.
_Avoid_: Repeating absolute repository paths

**Base Ref**:
The source branch or ref used when creating a new worktree branch for a **Repository Mapping**.
_Avoid_: Assuming `main`, assuming one default branch for all repos

**Runtime State**:
The commands, ports, and active dependencies required to run a **Feature Workspace** locally.
_Avoid_: Just branch state, editor-only state

**Baseline Runtime**:
The set of services that usually stays running outside the **Feature Workspace**, regardless of which repositories are being edited.
_Avoid_: Focus repos, edit targets, workspace-owned runtime

**Focus Repository**:
A repository that is actively being edited or inspected as part of the current **Feature Workspace**.
_Avoid_: Always-on dependency, runtime-only service

**Zed Project Window**:
A dedicated Zed window containing the folders or worktrees for the **Focus Repositories** in a **Feature Workspace**.
_Avoid_: VS Code-style workspace file, persistent multi-root workspace

**Personal Workspace Artifact**:
A local-only representation of a **Feature Workspace** intended for one developer's machine and workflow.
_Avoid_: Team-shared config, repo-level contract

**Active Workspace Manifest**:
The local manifest for a **Feature Workspace** that is still part of the current working set.
_Avoid_: Archived manifest, generated tmux layout

**Archived Workspace Manifest**:
The retained manifest for a closed **Feature Workspace** during its **Archive Window**.
_Avoid_: Active workspace, deleted workspace

**Declarative Manifest**:
The explicit local configuration file that defines a **Feature Workspace** as data rather than inferring it from running tools.
_Avoid_: Inferred state, ad hoc shell setup

**tmux Runtime Layout**:
A tmux or tmuxp session description used to open terminals and run commands for part of a **Feature Workspace**.
_Avoid_: Full workspace definition, source of truth

**Archive Window**:
The time period during which a closed **Feature Workspace** remains recoverable before automatic cleanup.
_Avoid_: Permanent retention, immediate deletion

**Forced Garbage Collection**:
A cleanup mode that ignores the **Archive Window** while still respecting safety blockers such as dirty worktrees, ahead commits, and branch mismatches.
_Avoid_: Unsafe delete, branch deletion

**Execution Plan**:
The preview of filesystem, Git, and editor actions that will be applied to open or modify a **Feature Workspace**.
_Avoid_: Immediate mutation, hidden side effects

## Relationships

- A **Feature Workspace** includes one or more **Repository Mappings**
- A **Feature Workspace** includes exactly one **Runtime State**
- A **Declarative Manifest** may define one **Source Root**
- Each worktree-backed **Repository Mapping** resolves one **Base Ref**
- A **Feature Workspace** may depend on one external **Baseline Runtime**
- A **Feature Workspace** may include zero or more **Focus Repositories**
- A **Feature Workspace** opens one dedicated **Zed Project Window** for navigation and agent work
- A **Feature Workspace** is currently represented as one **Personal Workspace Artifact**
- An active **Feature Workspace** has one **Active Workspace Manifest**
- A closed **Feature Workspace** has one **Archived Workspace Manifest** during its **Archive Window**
- A **Declarative Manifest** defines one **Feature Workspace**
- A **tmux Runtime Layout** may be generated from or aligned with a **Declarative Manifest**
- A closed **Feature Workspace** is archived by default within one **Archive Window**
- **Forced Garbage Collection** may clean archived workspaces before their **Archive Window** expires
- Opening or modifying a **Feature Workspace** first produces one **Execution Plan**
- Each **Repository Mapping** binds one repository to exactly one branch or ref within a **Feature Workspace**

## Example dialogue

> **Dev:** "Open the `DEV-123` **Feature Workspace**."
> **Domain expert:** "That restores the **Repository Mapping** for each repo and starts the **Runtime State** needed for that feature."

> **Dev:** "I closed this feature yesterday. Can I restore it?"
> **Domain expert:** "Yes — the **Feature Workspace** stays archived during the **Archive Window**, which is currently 7 days."

> **Dev:** "I'm only editing `generate-assessments`, but `tests-backend` still needs to be running."
> **Domain expert:** "Then `generate-assessments` is a **Focus Repository**, while `tests-backend` may remain part of the external **Baseline Runtime**."

> **Dev:** "Open the focus repos in Zed."
> **Domain expert:** "Open one **Zed Project Window** containing the selected repo folders or worktrees."

> **Dev:** "Create the workspace for `DEV-123`."
> **Domain expert:** "First show the **Execution Plan**: branches, worktrees, folders, and Zed command. Apply it only after confirmation."

## Flagged ambiguities

- "environment" was used to mean both local runtime setup and the overall multi-repo working unit — resolved: use **Feature Workspace** for the working unit and **Runtime State** for what runs locally.
- "workspace.yml" could refer either to a tmuxp config or the full feature-level working unit — resolved: use **tmux Runtime Layout** for the tmuxp file and **Declarative Manifest** for the full source of truth.
- "projects in the workspace" could mean either repositories being edited or services that must be running — resolved: use **Focus Repository** for repos being edited and **Baseline Runtime** for always-on services.
- The base `itmux` session and the **Feature Workspace** are separate systems that may run simultaneously — resolved: the **Feature Workspace** does not own or replace the **Baseline Runtime**.
- "multi-root workspace" in Zed should not imply a persistent VS Code `.code-workspace` equivalent — resolved: use **Zed Project Window** for a transient Zed project containing multiple folders/worktrees.
- "default branch" cannot be assumed globally because some repositories use `main` and others use `master` — resolved: use **Base Ref** and resolve it per repository, with explicit overrides available.
- "force" in garbage collection could imply ignoring all safety checks — resolved: **Forced Garbage Collection** ignores only archive TTL and still blocks unsafe worktree removal.
