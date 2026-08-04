# UI Reference Inventory: Neural Workbench

## Reference boundary

`C:\Users\ralle\source\repos\dbzs-codee-chat-app-ui-ux.zip` is a quarantined visual reference. It is not part of the product source tree, build, dependency graph, or runtime.

| Reference source | Extracted pattern | Productive destination |
| --- | --- | --- |
| `client/src/components/codee/CodeeWorkbench.tsx` | Header hierarchy, activity rail, panel composition, dock and status-bar presentation | `apps/desktop/src/components/workbench/` |
| `client/src/index.css` | Obsidian surfaces, relay-cyan accents, panel borders, visual hierarchy and grid treatment | `apps/desktop/src/styles/{tokens,theme-neural,workbench}.css` |
| `client/src/components/ui/*` | Accessibility and interaction ideas only | Existing desktop primitives and native controls |

## Explicit exclusions

The following reference content is not copied or connected:

- `.git`, `server`, `shared`, `drizzle`, `patches`, configuration files, lockfiles, and package manifest.
- Manus runtime, tRPC, Drizzle, MySQL, Express, S3, authentication, storage demos, and event services.
- `useCodeeWorkbenchController.ts`, `useCodeeFileStorageController.ts`, `codeeWorkbenchModel.ts`, mock chat, mock explorer, mock logs, and mock code.
- All `/manus-storage/` asset paths. The archive does not contain the referenced assets.

## Productive mapping

The shell mounts existing components and truth sources only:

- `WorkspaceExplorer` for files and workspace actions.
- `OperationsNotebook`, `RuntimeChatTab`, and `EditorTabPanel` for primary workspaces.
- Existing agents/debug panels for the inspector.
- `TerminalPanel`, `GitPanel`, and existing errors for the bottom dock.
- Existing backend, runtime, model-index, and workspace stores for status.

## Dependency decision

No dependencies are introduced. The existing pointer-based resize behavior remains authoritative; `react-resizable-panels` from the reference is not adopted. New workbench styles are explicitly namespaced with `dbzs-workbench` and use the app's existing Tailwind tokens where appropriate.
