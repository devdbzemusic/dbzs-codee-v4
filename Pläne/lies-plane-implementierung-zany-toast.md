# RuntimeChat UI/UX-Überarbeitung ("C@dee")

## Context

Zwei vollständige Explorationen (Code + reale Screenshots aus den Golden-Path-Läufen) haben die RuntimeChat-Funktion der DBZS-Codee-Desktop-App auf praktisches Handling, Übersichtlichkeit und Selbsterklärung geprüft. Kernbefund: die App hat bereits gute Bausteine (z.B. `AssistantQuestionCard`, den orangen "Backend nicht erreichbar"-Banner, ein Grundsatzdokument `docs/architecture/ui-system.md` mit Status-Vokabular), aber sie werden nicht konsequent genutzt. Konkret:

- Kein zentraler Ort, an dem ein Nutzer sieht "was kann Codee überhaupt" — Presets, Skills und Modus-Umschalter sind unabhängig voneinander versteckt und unerklärt.
- Der "Panels"-Header-Toggle vermischt entscheidungskritisches UI (Freigaben, Patch-Diff) mit reiner Technik-Diagnose unter einer einzigen, nichtssagenden Überschrift.
- Drei parallele Diff/Apply-Touchpoints mit unterschiedlichem Vokabular (`DiffPanel`, `RuntimeChatPatchPanel`, inline Karten in `CodeeRunLiveBlock`) und zwei parallele Agent-Aktivitäts-Systeme (`AgentWorkbench` vs. RuntimeChat) ohne gemeinsame Sprache.
- Uneinheitliches Status-Vokabular ("bereit/online/READY/AKTIV" nebeneinander) trotz vorhandenem Grundsatzdokument.
- Review-Ergebnisse rendern als roher Key:Value-Textdump statt strukturierter Karte.
- Keine gemeinsame Button/Badge/Card-Bibliothek wird tatsächlich genutzt — jede Komponente rollt eigene Tailwind-Strings, ein Panel (`RuntimeChatResearchPanel`) bricht komplett mit Inline-Neon-Styles aus.
- `RuntimeChatTraceViewer.tsx` (vollständige Observability-Ansicht) existiert, ist aber nirgendwo eingebunden.

Nutzerentscheidung: großer Umfang inkl. echter Vereinheitlichung, "C@dee"-Tab-Name bleibt, TraceViewer wird jetzt aktiv eingebunden. Ziel: praktisches Handling, Übersichtlichkeit und selbsterklärende Führung durch Capabilities/Workflows spürbar verbessern, ohne die zugrundeliegenden Backend-APIs anzufassen.

## Zwei Architekturentscheidungen (verifiziert, bindend für die Umsetzung)

**A. Diff/Apply/Rollback: nur die Präsentationsschicht vereinheitlichen, Stores NICHT fusionieren.**
`useEditorStore` (Single-File-Editor-Snapshot/Diff/Apply/Restore) und `runtimeChatStorePatchActions.ts` (`activePatchProposal`-Zustandsmaschine, Multi-File, mit Validierungs-Kommandos, eigene IPC-Brücken) sind strukturell verschiedene Backend-Flüsse. Eine echte Fusion wäre ein Backend-Umbau mit hohem Regressionsrisiko für den Editor-Pfad. Stattdessen: eine gemeinsame **präsentative** Diff-Komponente (`DiffChangeView`, extrahiert aus `DiffPanel.tsx`s bereits guter `renderColoredDiff`-Logik) an allen drei Stellen verwenden, plus einheitliches Vokabular (**Übernehmen / Ablehnen / Zurücksetzen**).

**B. AgentWorkbench + RuntimeChat-Run-Tracking: ebenfalls nur Präsentationsschicht vereinheitlichen.**
`agentWorkbenchStore` bildet serverseitige, persistente, pausierbare Jobs ab (REST+SSE); `runtimeChatStore`s `activeRun` ist ephemerer Zustand pro Chat-Nachricht ohne Server-Persistenz. Keine gemeinsame Korrelations-ID im Code vorhanden — echte Fusion würde jeden Chat-Turn in einen formalen Backend-Run verwandeln (außerhalb UI-Scope). Stattdessen: gemeinsames View-Model `AgentActivityTimeline` + zwei dünne Adapter, damit beide Flächen gleich aussehen und dieselbe Sprache (`agentLabel()`, Statuswörter, `StatusPill`) benutzen.

## Umsetzung — 11 Schritte, einzeln baubar/testbar

**Schritt 0 — Primitives + Status-Vokabular-Fundament** (Basis für alle folgenden Schritte, kein Verhalten geändert)
- Neu: `apps/desktop/src/utils/statusVocabulary.ts` — `resolveStatusVocabulary(input)` bildet technische Zustände auf die vier `ui-system.md`-Begriffe ab (`starting/live`, `ready`, `degraded`, `failed` + Ton green/amber/red/cyan).
- Neu: `apps/desktop/src/components/ui/Button.tsx` (Varianten primary/secondary/danger/ghost), `RiskBadge.tsx` (low/medium/high, P0-P3), `SectionCard.tsx`, `DecisionCard.tsx` (gemeinsame Hülle für Freigabe-Karten).
- Ändern: `apps/desktop/src/components/ui/PanelComponents.tsx` — `StatusPill` um `tone: "cyan"` erweitern (aktuell nur green/amber/red, verifiziert — fehlt für `starting/live`); Barrel-Export `apps/desktop/src/components/ui/index.ts` neu anlegen.
- Ändern: `apps/desktop/tailwind.config.ts` — Token-Drift beheben durch **Ergänzen** fehlender Tokens (`textSoft`, `bgSecondary`, `warning` als Alias zu `amber`), nicht durch Umschreiben der sechs Dateien, die sie bereits referenzieren (`RuntimeChatMessageCard.tsx`, `RuntimeChatConversationFeed.tsx`, `CodeeRunLiveBlock.tsx`, `TokenBudgetVisualizer.tsx`, `SafeModeOverlay.tsx`, `RoutingDiagnosticsCard.tsx`).

**Schritt 1 — Panels-Struktur entflechten**
- Neu: `apps/desktop/src/components/runtime-chat/RuntimeChatWorkflowPanels.tsx` (Tools, Activity, Approvals, Patch-Panel, Research — aus dem heutigen `showPanels`-Zweig übernommen).
- Neu: `apps/desktop/src/components/runtime-chat/RuntimeChatDiagnosticsPanels.tsx` (Routing-Diagnose, Token-Budget, Modell-Test, **plus** TraceViewer-Einstieg aus Schritt 5).
- Ändern: `RuntimeChatSecondaryPanels.tsx` wird dünner Layout-Wrapper mit klar getrennten, beschrifteten Bereichen statt der einen Überschrift "Sekundäre Panels & Diagnose" (verifiziert: aktuell exakt so in Zeile 46).
- Ändern: `RuntimeChatHeader.tsx` — Toggle "Panels" → "Werkzeuge & Freigaben" mit Tooltip, "Diagnose"/"Slots" bekommen erklärende Tooltips.
- Ändern: `RuntimeChatTab.tsx` — Auto-Öffnen-`useEffect` (bisher nur bei `pendingApprovalCount > 0`) um `activePatchProposal` erweitern, damit ein neuer Patch-Vorschlag nicht unsichtbar bleibt.

**Schritt 2 — Diff/Apply/Rollback vereinheitlichen**
- Neu: `apps/desktop/src/components/runtime-chat/DiffChangeView.tsx` — extrahiert `renderColoredDiff` aus `DiffPanel.tsx`, plus generische Kopfzeile (Datei, Quelle, `RiskBadge`) und Aktionsleiste über Props (`onApply`/`onReject`/`onReset`/`busy`), reine Präsentationskomponente ohne eigenen State.
- Ändern: `DiffPanel.tsx` nutzt `DiffChangeView`, Label "Anwenden"→"Übernehmen", "Verwerfen"→"Ablehnen".
- Ändern: `RuntimeChatPatchPanel.tsx` — pro Preview `DiffChangeView` statt `<details><pre>` (bringt Diff-Farben, die hier fehlen), "Rollback"→"Zurücksetzen".
- Ändern: `CodeeRunLiveBlock.tsx` — Abschnitt "Vorgeschlagene Dateiänderungen" nutzt `DiffChangeView` statt eigener Karten mit abweichenden Labels; bestehende `handleOpenDiff`/`handleApplyChange`/`handleDiscardChange` bleiben als Callback-Adapter zu `useEditorStore`.

**Schritt 3 — Review-Ergebnis-Karte strukturieren**
- Neu: `apps/desktop/src/components/chat/RepositoryReviewResultCard.tsx` — `StatusPill` statt Freitext-Status, farbcodierte P0-P3-`RiskBadge`s statt Textzeile, Top-Findings mit Badges, einklappbares `<details>` "Technische Details" für die aktuell immer sichtbaren Workflow/Phase/Modell/Settings-Revision-Monospace-Zeilen (Standard: zugeklappt, außer bei Fehler/Degraded), Aktionsleiste mit `Button`-Primitives.
- Ändern: `CodeeRunLiveBlock.tsx` — den bestehenden `run.repositoryReview`-Block durch die neue Karte ersetzen.

**Schritt 4 — AgentWorkbench + RuntimeChat-Aktivität vereinheitlichen**
- Neu: `apps/desktop/src/components/shared/AgentActivityTimeline.tsx` — generische Timeline (übernimmt die bereits saubere `stepIcon`/`stepClass`-Logik aus `RuntimeChatActivityPanel.tsx`).
- Neu: `codeeRunActivityAdapter.ts` (`apps/desktop/src/components/chat/`) und `agentRunActivityAdapter.ts` (`apps/desktop/src/components/agent-workbench/`) — Mapper von `RuntimeChatRun` bzw. `AgentRun+Steps+Events` auf das gemeinsame View-Model.
- Ändern: `RuntimeChatActivityPanel.tsx`, `CodeeRunLiveBlock.tsx` (Steps-/Tools-Abschnitte), `AgentActivityStream.tsx`, `AgentRunHeader.tsx`, `AgentStatusBar.tsx` — auf `AgentActivityTimeline` + `agentLabel()` (`apps/desktop/src/services/runtimeChatActivityHelpers.ts`, bereits zentral) + `resolveStatusVocabulary()` umstellen.
- Explizit NICHT Teil dieses Schritts: eine Korrelations-ID zwischen `RuntimeChatRun` und `AgentRun`, um Chat-Runs im Workbench-Tab zu verlinken — Backend-Voraussetzung fehlt, als Folgearbeit vermerken.

**Schritt 5 — `RuntimeChatTraceViewer.tsx` einbinden**
- Einstiegspunkt: zusätzlicher, standardmäßig eingeklappter Unterpunkt "Session-Traces (Observability)" in `RuntimeChatDiagnosticsPanels.tsx` (aus Schritt 1) — passt zur `ui-system.md`-Regel "Expertenflächen dürfen Hauptaufgaben nicht verdecken", kein eigener Notebook-Tab.
- Ändern: `RuntimeChatTraceViewer.tsx` — Token-Drift beheben (aktuell rohe `gray-800`/`blue-600`-Klassen statt `dbzs-*`), `getStatusColor()` auf `resolveStatusVocabulary()` umstellen.
- Ändern: `RuntimeChatHeader.tsx` — optionaler dezenter Hinweis, wenn Traces vorhanden sind, damit der neue Einstiegspunkt auffindbar ist.
- Keine Backend-Änderung nötig — `apps/desktop/src/runtime/observability/observabilityService.ts` liefert die Daten bereits.

**Schritt 6 — Statusvokabular-Nachzieher** (baut auf 2-5 auf, daher am Ende)
- `RuntimeChatTab.tsx` (`formatBootStateForUi`), `CodeeRunLiveBlock.tsx` (Status-Punkt-Farbe, granulares `statusLabel()` bleibt erhalten), `MissionControlPanel.tsx`, `RuntimeSlotPanel.tsx` — alle auf `resolveStatusVocabulary()`/`StatusPill` umstellen, damit dieselbe Farbe/dasselbe Wort überall denselben Zustand meint.

**Schritt 7 — `RuntimeChatResearchPanel.tsx` reparieren**
- Inline-`style`-Objekte (Neon-Palette `#00f0ff`/`#39ff14`/`#ff3131`/`#ff9900`, `Courier New`) durch `SectionCard` + `dbzs-*`-Klassen ersetzen, Status-Logik auf `resolveStatusVocabulary()` umstellen. Reines Re-Styling, keine funktionale Änderung.

**Schritt 8 — Approval-/Entscheidungskarten vereinheitlichen**
- `RuntimeChatApprovalCards.tsx` (`TakeoverCard`, `ReviewGateCard`, `StructuredChatActionCard`, `ToolApprovalCard` — strukturell bereits ähnlich, verifiziert) und `AssistantQuestionCard.tsx`, `ReviewRemediationSelectionCard.tsx` auf `DecisionCard`-Rahmen umstellen; Sonderinhalte (Diff-Liste, Command-Preview, Fragetypen) bleiben als Content-Slot erhalten.

**Schritt 9 — Fähigkeiten-Übersicht + CommandPalette**
- Neu: `apps/desktop/src/components/runtime-chat/RuntimeChatCapabilitiesOverlay.tsx` — drei Abschnitte: Presets (volle Labels+Beschreibung aus `PRESET_MESSAGES`, `apps/desktop/src/stores/runtimeChatStoreRuntimeHelpers.ts:280`, statt abgeschnittener 3-4-Zeichen-Buttons), Skills (aus `apps/desktop/src/skills/*/manifest.yaml` via `skillsLoader.ts`, Beschreibung inline statt nur Hover), Modus-Erklärungen (Auto/Agent, Ask/Agent/Full, Kontext-Checkbox).
- Ändern: `RuntimeChatTab.tsx` — Trigger-Button "Was kann ich hier tun?" öffnet Overlay; Header-Preset-Reihe bekommt volle Wörter statt Kürzel (jetzt via `Button`-Primitive genug Platz).
- Ändern: `CommandPalette.tsx` — `STATIC_COMMANDS` um "Fähigkeiten-Übersicht öffnen" + einen Eintrag pro Preset erweitern.
- Ändern: `RuntimeChatToolsBar.tsx` — Skill-Chips um Inline-Beschreibung ergänzen.

**Schritt 10 — Composer-Erklärungen + klickbare Beispiel-Prompts**
- `RuntimeChatComposer.tsx` — Mode-Toggle "Auto/Agent" → "Gesprächsmodus: Automatisch/Als Agent", `toolProfile`-Select bekommt Label "Werkzeugrechte:" davor (verifiziert: zwei unterschiedliche "Agent"-Beschriftungen ohne Unterscheidung nebeneinander), Tooltips ergänzen.
- `RuntimeChatConversationFeed.tsx` — die 4 Beispiel-Prompts im leeren Zustand bekommen `onClick` → Text landet im Composer-Draft (nicht automatisch gesendet).

## Verifizierte Grundlagen (bereits gegengelesen, nicht nur übernommen)
- `apps/desktop/src/components/ui/PanelComponents.tsx`: `StatusPill` hat aktuell nur `tone: "green"|"amber"|"red"` — `cyan` fehlt tatsächlich, bestätigt Schritt 0.
- `apps/desktop/src/components/runtime-chat/RuntimeChatSecondaryPanels.tsx`: exakt eine Überschrift "Sekundäre Panels & Diagnose" für alle drei Bereiche (Panels/Slots/Diagnose), bestätigt Schritt 1.

## Verifikation
- Nach jedem Schritt: `npm run typecheck` und `npx vitest run` im `apps/desktop`-Verzeichnis (bestehende Suite darf nicht regressieren).
- Nach Schritt 1, 2, 9, 10: App real starten (`pnpm dev` oder Playwright-Treiber wie in den bisherigen Golden-Path-Läufen) und visuell/interaktiv prüfen — Panels-Trennung, Diff-Darstellung an allen drei Touchpoints, Capabilities-Overlay, klickbare Beispiel-Prompts.
- Nach Schritt 4 und 6: `AgentWorkbench`-Tab und "C@dee"-Tab parallel öffnen, Statusfarben/-wörter und Agentennamen müssen für denselben Zustand identisch aussehen.
- Am Ende: kompletten Golden-Path-Durchlauf (Review→Diff→Freigabe→Apply→Test→Rollback, Backup/Restore) einmal real durchklicken, um sicherzustellen, dass keine der zugrundeliegenden Workflows durch das Restyling/die Vereinheitlichung funktional gebrochen wurde.
