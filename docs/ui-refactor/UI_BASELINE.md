# UI Baseline — DBZS Codee V4

**Erstellt:** 2026-08-04  
**Basis-Commit:** `a3cb7bed`  
**Branch:** `devdbzemusic-planning-ui-refactor`  
**Test-Baseline Desktop:** 1339/1381 (42 skipped, 0 failed)  
**Build:** ✅ Vite/Rollup  
**Typecheck:** ✅ `tsc --noEmit`

---

## Shell-Modi

| Modus | Status | Aktivierung |
|---|---|---|
| `neural-workbench` | ✅ Standard (Default) | Automatisch, localStorage-Key `dbzs-workbench-layout-v2` |
| `classic` | ✅ Fallback | Toggle-Button im Header oder `shellMode: "classic"` im Store |

---

## Bestehende Kernfunktionen (vollständig erhalten)

| Bereich | Komponente | Status |
|---|---|---|
| Workspace Explorer | `WorkspaceExplorer` | ✅ unverändert eingebettet |
| Runtime Chat | `RuntimeChatTab` | ✅ unverändert eingebettet |
| Editor | `EditorTabPanel` (lazy) | ✅ unverändert |
| Operations Notebook | `OperationsNotebook` | ✅ unverändert |
| Agents | `AgentWorkbench`, `PlannerAgentPanel`, etc. | ✅ unverändert |
| Git | `GitPanel` | ✅ unverändert |
| Terminal | `TerminalPanel` | ✅ unverändert |
| Jobs | `JobsNotebookTab` | ✅ unverändert |
| Settings | `AppShellSettingsPanel` | ✅ unverändert |
| Model Lab | `ModelLabTab` | ✅ unverändert |
| Runtime Models | `RuntimeModelsTab` | ✅ unverändert |
| Command Palette | `CommandPalette` | ✅ unverändert |
| Debug Agent | `DebugAgentPanel` | ✅ unverändert |
| Diagnostics (Standalone) | `PlatformDiagnosticsPanel` | ✅ unverändert |
| Detached Chat Window | `RuntimeChatDetachedPlaceholder` | ✅ unverändert |

---

## Neural Workbench M1 – gelieferte Komponenten

| Deliverable | Datei | Status |
|---|---|---|
| Design Tokens | `styles/tokens.css` | ✅ |
| Neural Theme | `styles/theme-neural.css` | ✅ |
| Workbench Grid/Layout | `styles/workbench.css` | ✅ |
| Typografie | `styles/typography.css` | ✅ |
| Motion | `styles/motion.css` | ✅ |
| Shell Store (vollständig) | `stores/workbenchLayoutStore.ts` | ✅ Panel-Breiten, Dock-Höhe, Collapse-States, Presets |
| Neural Workbench Shell | `components/workbench/NeuralWorkbenchShell.tsx` | ✅ |
| Activity Rail (10 Einträge) | `components/workbench/ActivityRail.tsx` | ✅ + Navigation Registry + Shortcuts |
| Workbench Header | `components/workbench/WorkbenchHeader.tsx` | ✅ |
| Status Badge | `components/workbench/WorkbenchStatusBadge.tsx` | ✅ |
| Status Bar | `components/workbench/WorkbenchStatusBar.tsx` | ✅ |
| Workspace Sidebar | `components/workbench/WorkspaceSidebar.tsx` | ✅ |
| Primary Workspace | `components/workbench/PrimaryWorkspace.tsx` | ✅ |
| Inspector Sidebar | `components/workbench/InspectorSidebar.tsx` | ✅ |
| Bottom Dock | `components/workbench/BottomDock.tsx` | ✅ |
| Primitives | `components/workbench/primitives/` | ✅ (6 Komponenten) |
| useWorkbenchLayout | `hooks/useWorkbenchLayout.ts` | ✅ |
| useWorkbenchNavigation | `hooks/useWorkbenchNavigation.ts` | ✅ |
| useWorkbenchStatus | `hooks/useWorkbenchStatus.ts` | ✅ |
| DesignTokenPreview | `components/workbench/DesignTokenPreview.tsx` | ✅ |

---

## Layout-Mindestauflösungen

| Auflösung | Getestet |
|---|---|
| 1366×768 | ⏳ manuell ausstehend |
| 1600×900 | ⏳ manuell ausstehend |
| 1920×1080 | ⏳ manuell ausstehend |
| 2560×1440 | ⏳ manuell ausstehend |

---

## Phasen-Abnahme-Checkliste

- [x] Typecheck (`tsc --noEmit`) grün
- [x] Build (`pnpm build`) grün
- [x] Desktop-Tests grün (1339 passed)
- [x] Changed-Files-Lint ohne neue Errors
- [ ] Visuelle Screenshot-Abnahme 1366×768 (manuell)
- [ ] Visuelle Screenshot-Abnahme 1920×1080 (manuell)
- [ ] Classic Shell klassischer Fallback-Test
- [ ] PR 0: Workflow-Status-Vertragsfix (Repository-Review-Timeout)
