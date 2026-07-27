# Safe Patch Pipeline

Phase 1D unifies preview, restore point, apply, and rollback on the desktop side.

## Flow

```text
Proposed content
  -> createPatchPreview (diff)
  -> applyPatchWithRestorePoint (restore point + write)
  -> rollbackPatch (restore point id)
```

## IPC

- `dbzs:workspace:patch-pipeline:preview`
- `dbzs:workspace:patch-pipeline:apply`
- `dbzs:workspace:patch-pipeline:rollback`

Preload API: `createPatchPreview`, `applyPatchWithRestorePoint`, `rollbackPatch`.

## Rules

- Workspace scope enforced via `ensurePathInsideWorkspace`
- Restore point created before apply
- Internal `.codee` writes may still use dedicated services
- User/agent content should use the patch pipeline facade
