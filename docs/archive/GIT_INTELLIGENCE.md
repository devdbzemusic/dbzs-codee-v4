# Git Intelligence Architecture and Safety Model

## Purpose

Git Intelligence provides read-focused repository context to the desktop app without exposing destructive Git operations to the renderer or autonomous flows.

Scope of this document:

- architecture and data flow
- security boundaries
- safety guarantees
- validation and test checklist
- extension guidance

## Design Goals

- Keep renderer-side Git features context-first and low-risk.
- Preserve strict workspace boundaries for every file and Git operation.
- Prevent destructive Git actions in intelligence paths.
- Support planner/review/debug agents with Git context (status, diffs, risk hints).
- Keep implementation modular across shared types, Electron main, preload, and stores.

## Current Capability Set

Implemented capabilities include:

- repository status (branch, changed entries, upstream, ahead/behind)
- changed file listing and diff summary
- full diff and per-file diff loading
- commit suggestion generation
- commit assistant with includeFiles validation
- restore points before high-risk apply/commit operations
- review risk enrichment from Git signals (conflicts, churn, many files)
- local-safe usage counters for Git-context actions

## Layered Architecture

### Shared contracts

`packages/shared/src/index.ts` defines:

- `GitRepositoryStatus`
- `GitStatusEntry`
- `GitDiffSummary`
- `GitCommitSuggestion`
- commit assistant and restore point contracts

This keeps renderer/main type-safe and avoids drift.

### Electron main process

`apps/desktop/electron/gitService.ts` encapsulates Git subprocess execution.

Key properties:

- process execution uses `shell: false`
- timeout-guarded command execution
- parsing for porcelain status and diff stat
- upstream/divergence detection (`hasUpstream`, `aheadCount`, `behindCount`)
- path checks for workspace confinement

`apps/desktop/electron/main.ts` exposes IPC handlers and enforces active-workspace matching before dispatching to Git services.

### Preload bridge

`apps/desktop/electron/preload.ts` exposes a constrained API surface via `window.dbzs`.

Renderer cannot execute raw Git commands directly.

### Renderer stores and panels

`apps/desktop/src/stores/gitStore.ts` orchestrates:

- status refresh
- diff selection
- commit suggestions and warnings
- restore point lifecycle actions

`apps/desktop/src/components/GitPanel.tsx` presents:

- branch and upstream/divergence hints
- changed files and diff views
- commit assistant UI
- restore/safety controls

## Data Flow

1. Renderer triggers refresh via `useGitStore.refreshGitStatus`.
2. Store calls preload bridge methods.
3. IPC in main validates active workspace and forwards to `GitService`.
4. `GitService` runs read-focused Git commands and returns parsed data.
5. Store computes warnings and derived UI state.
6. Panel renders branch/upstream/divergence, diff context, and commit/restore affordances.

## Safety Model

### Boundary controls

- Renderer sandboxed (`contextIsolation: true`, no direct Node access).
- Only whitelisted preload methods are callable from UI.
- Main process validates requested workspace equals active workspace.
- File paths are normalized and validated against workspace root.

### Git execution constraints

- Git subprocesses use `shell: false`.
- No destructive commands are used in intelligence paths.
- Command execution is timeout-bounded.
- Upstream detection failures degrade safely (`hasUpstream: false`, divergence zeroed).

### Commit safety controls

- `includeFiles` cannot be empty.
- All include paths must remain inside workspace.
- Include paths cannot pass unsafe argument forms.
- Commit creation can generate restore points before mutation.

### Restore safety controls

- Restore points are persisted under `.codee/restore-points`.
- Restore is file-scoped and workspace-scoped.
- Restore continues per-file even when one file fails.
- No Git reset/checkout/clean behavior is used for restore.

### Local telemetry counters

- Counters are stored locally under `.codee/git-telemetry.json`.
- Only coarse usage counts are tracked (for example: refresh, diff selection, commit/restore actions).
- No file content, commit messages, command arguments, credentials, or remote endpoints are stored.
- No automatic network transmission is performed.

## Threat Notes

Primary mitigated risks:

- command injection via shell execution
- workspace traversal through crafted file paths
- accidental destructive Git actions from UI/agents
- silent loss of rollback capability during apply/commit workflows

Residual risks:

- stale data if repository changes between refreshes
- user-approved commit/restore actions can still cause logical mistakes
- local Git repo misconfiguration can reduce context quality

## Validation Checklist

Desktop tests:

- `pnpm --dir apps/desktop test`
- `pnpm --dir apps/desktop exec vitest run electron/gitService.test.ts`
- `pnpm --dir apps/desktop exec vitest run src/stores/gitStore.test.ts src/components/GitPanel.test.tsx`
- `pnpm --dir apps/desktop exec vitest run src/services/plannerAgentService.test.ts src/services/reviewAgentService.test.ts`

Focus areas for review:

- upstream/divergence parsing behavior
- non-repo fallback behavior
- workspace path confinement
- conflict/large-diff risk propagation into review context

## Extension Guidance

When extending Git Intelligence:

- keep all Git command execution in `GitService`
- expand shared contracts first, then IPC/preload/store/panel in order
- preserve read-first defaults and explicit user intent for mutations
- add tests for parser edge cases and non-repo behavior
- document new safety assumptions in this file

## Non-Goals

- no auto-push/pull/merge automation from intelligence panel
- no destructive Git cleanup commands
- no bypass of renderer sandbox or preload boundary
