# UI Interaction Matrix — DBZS Codee V4 Neural Workbench

**Erstellt:** 2026-08-04  
**Scope:** M1 Foundation — Shell, Navigation, Status

---

## Activity Rail

| Aktion | Auslöser | Reaktion |
|---|---|---|
| Rail-Item aktivieren | Klick auf Rail-Button | `activeRailItem` im Store gesetzt, `aria-current="page"` wechselt |
| Keyboard-Shortcut | `Ctrl+1` … `Ctrl+0` | Entsprechendes Rail-Item aktivieren |
| Tooltip | Hover auf Rail-Button | Label + Shortcut erscheint als `title` |
| Badge anzeigen | Store-Badge > 0 | Zähler-Chip auf Rail-Button |

## Workbench Header

| Aktion | Auslöser | Reaktion |
|---|---|---|
| Quick Open | Klick / `Ctrl+K` | Command Palette öffnet |
| Shell-Toggle | Klick auf "Classic"/"Neural" | `shellMode` wechselt, localStorage persistiert |
| Settings öffnen | Klick auf ⚙ | `window.dbzs.openSettingsWindow()` |

## Layout / Resize

| Aktion | Auslöser | Reaktion |
|---|---|---|
| Linke Sidebar verbreitern | `SplitHandle` `pointerdown` + move | `leftSidebarWidth` aktualisiert, min 220 / max 520 |
| Inspector verbreitern | `SplitHandle` `pointerdown` + move | `inspectorWidth` aktualisiert, min 220 / max 600 |
| Dock-Höhe ändern | `SplitHandle` `pointerdown` + move | `bottomDockHeight` aktualisiert, min 128 / max 480 |
| Linke Sidebar einklappen | Collapse-Button im Header | `leftSidebarOpen: false` |
| Inspector einklappen | Collapse-Button | `inspectorOpen: false` |
| Dock einklappen | Collapse-Button im Dock | `bottomDockOpen: false` |

## Status Bar

| Zustand | Desktop-Badge | Backend-Badge | Runtime-Badge |
|---|---|---|---|
| Alles bereit | success | success | success/running |
| Backend startet | success | warning | neutral |
| Backend degraded | success | warning | neutral |
| Backend offline | success | danger | neutral |
| Modelle indexiert | success | success | warning |
| Runtime läuft | success | success | running (pulsiert) |
| Kein Modell | success | success | neutral |

## Layout-Presets

| Preset | leftSidebarOpen | inspectorOpen | bottomDockOpen | activeRailItem |
|---|---|---|---|---|
| `chat-focus` | ✅ | ✅ | ❌ | `chat` |
| `code-focus` | ✅ | ✅ | ❌ | `workspace` |
| `review-focus` | ❌ | ✅ | ❌ | `git` |
| `agent-ops` | ✅ | ✅ | ✅ | `agent-workbench` |
| `model-ops` | ❌ | ✅ | ✅ | `runtime` |
| `minimal` | ❌ | ❌ | ❌ | (unverändert) |

## Inspector Tabs

| Tab | Inhalt (Ziel) |
|---|---|
| `context` | Aktiver Workspace-Kontext |
| `agents` | Aktive Agenten + Status |
| `trace` | Agent-Ausführungstrace |
| `runtime` | Runtime/Slot-Details |
| `model` | Aktives Modell + Capabilities |
| `git` | Git-Status + Branch |
| `debug-log` | Debug-Output |
| `properties` | Datei-/Element-Eigenschaften |
| `diagnostics` | Platform-Diagnose |

## Bottom Dock Tabs

| Tab | Inhalt |
|---|---|
| `terminal` | Integriertes Terminal |
| `git` | Git-Operationen |
| `event-bus` | Live Event Stream |
| `problems` | Lint-/Typ-Fehler |
| `output` | Build-/Script-Output |
| `jobs` | Job-Queue |
| `tests` | Test-Ergebnisse |
