# Roadmap

## Real-world readiness

This project is currently a personal MVP. The goal of this track is to make `feature-workspace` safe enough for regular real-world use, especially around Git worktrees, archive state, and garbage collection.

This file is the source of truth for project tracking for now. No GitHub Issues are required.

### Blockers

- [x] Add integration tests with temporary Git repositories.
- [x] Avoid filesystem side effects in read-only commands.
- [ ] Add full runtime validation for manifests, config, and archive metadata.
- [ ] Treat corrupted or incomplete garbage collection metadata as a safety blocker.
- [ ] Centralize archive and garbage collection safety policy.
- [ ] Treat unknown upstream or ahead/behind state conservatively.
- [ ] Add CI for dependency install, typecheck, and tests.

## Next

- [ ] Initialize Git repository.
- [ ] Create GitHub repository.
- [x] Add the first test harness for Git-backed integration tests.

## Later

- [ ] Remove local branches during garbage collection.
- [ ] Add explicit branch/ref existence checks.
- [ ] Improve CLI argument parsing and validation.
- [ ] Revisit the project name once the workflow feels stable.
