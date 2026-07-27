# CODEX MASTER PROMPT
# Division By Zeros (DBZS) Codee
# Reparatur des ersten StringLab-Live-Zündversuchs

Repository:

`devdbzemusic/dbzs-codee-project`

Ausgangspunkt:

aktueller `main`

Arbeitsbranch:

`fix/stringlab-first-live-run-boundaries`

## Mission

Behebe ausschließlich die im Video `Codee TEST A1507262021.mp4` nachgewiesenen Blockaden des ersten realen StringLab-Runtime-Chat-Laufs.

Keine neuen Produktfeatures. Keine UI-Neugestaltung. Keine zweite Architektur.

Zieltest:

```text
Workspace: C:\Users\ralle\source\repos\dbzssl
Eingabe: Wir bauen heute eine kleine neue Funktion für StringLab
```

Codee soll zuerst eine schnelle strukturierte Rückfrage stellen und darf dabei weder alten Workspace-Kontext noch alte Review-Gates anzeigen.

## Belegte Fehler

1. Anfrage wird als `casual_chat` klassifiziert.
2. Qwen2.5-VL wird ohne Bild ausgewählt.
3. Qwen2.5-VL läuft im `quality_cpu`-Slot mit `gpu_layers=0`.
4. FunctionGemma routet noch nicht; es ist nur Slot-Infrastruktur.
5. CodeIndex enthält nach Workspacewechsel alte Dateien.
6. Modell nennt `.codee/resources/DBZS-StringLab-Workbench-main/src/App.tsx`.
7. Alte Review-Gates für `src/test_file.py` erscheinen im neuen Workspace.
8. 81 Signale und 21 Systemnachrichten werden vor einer nötigen Rückfrage aufgebaut.
9. Die UI behauptet nach 20 Sekunden fälschlich, llama-server reagiere nicht.
10. Der Warnbutton stoppt global alle Runtime-Slots.
11. Runtime-Header zeigt FunctionGemma als Chatmodell.
12. First Token ca. 49 Sekunden, Gesamtlauf ca. 113 Sekunden.

## Harte Reihenfolge

Bearbeite zuerst ausschließlich Phase 1. Nach Tests und Bericht stoppen. Phase 2 erst in einem separaten Folge-PR.

# Phase 1 – Workspace Boundary Hardening

## 1. CodeIndex beim Workspacewechsel leeren

Datei:

`apps/desktop/src/services/codeIndexService.ts`

Problem:

`buildWorkspaceIndex()` setzt einen neuen `workspaceRoot`, aber `this.files` wird nur geleert, wenn ein gültiger persistierter Index gelesen wird. Existiert im neuen Workspace kein Index, bleiben Dateien des alten Workspace erhalten.

Implementierung:

- Vor jedem Load/Build feststellen, ob sich der normalisierte Workspace geändert hat.
- Bei Wechsel:
  - laufenden Build invalidieren;
  - `this.files.clear()`;
  - `this.workspaceRoot = nextRoot`;
  - `indexGeneration` erhöhen.
- Nach jedem Await prüfen, ob Generation und Workspace noch aktuell sind.
- Persistierten Index nur laden, wenn:
  - `parsed.workspaceRoot` normalisiert exakt dem aktuellen Root entspricht;
  - Schema gültig ist.
- Vor Rückgabe und Persistenz nur Einträge des aktuellen Workspace erlauben.
- `loadPersistedIndex()` muss bei fehlender, beschädigter oder falscher Datei einen leeren aktuellen Index garantieren.

## 2. Veraltete Build-Rennen verhindern

Wenn Workspace A indiziert wird und Benutzer Workspace B öffnet:

- Resultate aus A dürfen B nicht mehr befüllen.
- Alte Persist-Operation darf nicht in B schreiben.
- Verwende Generation Token oder AbortController.
- Keine globale parallele Mutation ohne Workspaceprüfung.

## 3. `.codee` und interne Verzeichnisse ausschließen

Default-Ausschlüsse für Retrieval/Index/Sampling:

```text
.codee/**
restore-points/**
node_modules/**
.git/**
dist/**
build/**
target/**
coverage/**
```

Ausnahme nur bei expliziter `@file`-/`@folder`-Mention und bestätigtem Zugriff.

Prüfe alle Pfade:

- Desktop CodeIndex
- Workspace Context Sampling
- Context Orchestrator
- Backend RAG Index
- list_files Tool

Eine gemeinsame Source of Truth für Excludes verwenden.

## 4. Review-Gates nach Workspace filtern

Betroffene Dateien mindestens:

- `apps/desktop/src/components/RuntimeChatApprovals.tsx`
- `apps/desktop/src/services/reviewGateService.ts`
- Backend Review-Gate Router/Repository
- Shared `ReviewGate`

Jedes Gate benötigt:

```text
workspaceRoot
workspaceId oder repositoryFingerprint
runId
jobId
```

API:

```text
GET /review-gates/pending?workspace_id=...
```

Runtime Chat zeigt ausschließlich Gates des aktuellen Workspace.

Globale Gates dürfen weiterhin im Jobs-/Review-Panel erscheinen.

Altbestand ohne Workspacezuordnung:

- nicht im Runtime Chat zeigen;
- als `legacy_unscoped` markieren;
- nicht still dem aktuellen Workspace zuordnen.

## 5. Approval- und Chat-State scopen

- Tool Approvals, Takeovers und strukturierte Aktionen müssen Workspace-ID tragen.
- Bei Workspacewechsel:
  - aktuelle Unterhaltung entweder leeren oder als Workspace-Conversation wechseln;
  - keine Pending-Aktion eines alten Workspace im neuen Workspace rendern;
  - laufende alte Runs sicher abbrechen oder im Hintergrund eindeutig scopen.
- Kein Cross-Workspace `approve`.

## 6. Tests Phase 1

### CodeIndex

1. Workspace A mit Index öffnen.
2. Workspace B ohne Index öffnen.
3. Suche in B darf keinen Treffer aus A liefern.
4. B enthält nach Build nur B-Dateien.
5. Beschädigter B-Index führt zu leerem B-Index.
6. Index mit falschem `workspaceRoot` wird verworfen.
7. Langsamer Build A darf schnellen Build B nicht überschreiben.
8. `.codee/resources/foo.ts` wird standardmäßig ausgeschlossen.
9. explizite Mention ist separat policy-gesteuert.

### Review Gates

10. Gate A erscheint nur in Workspace A.
11. Gate B erscheint nur in Workspace B.
12. ungescopter Altbestand erscheint nicht im Runtime Chat.
13. Freigabe mit falschem Workspace wird serverseitig abgelehnt.
14. Workspacewechsel entfernt alte Karten sofort aus der Ansicht.

### E2E

15. Analyzer öffnen, danach `dbzssl`.
16. Anfrage mit `StringLab`.
17. Kein Pfad unter dem alten Analyzer-Workspace darf im Context Manifest oder in der Modellantwort vorkommen.
18. Keine Karte `src/test_file.py` darf sichtbar sein.

## Definition of Done Phase 1

- Cross-Workspace-CodeIndex technisch unmöglich.
- Cross-Workspace-Approval technisch unmöglich.
- `.codee/**` standardmäßig aus KI-Kontext ausgeschlossen.
- Tests grün.
- Typecheck grün.
- Build grün.
- Dokumentation aktualisiert.
- Kein Commit/Push ohne ausdrückliche Freigabe.
- Nach Phase 1 stoppen und Bericht liefern.

# Dokumentierter Folge-PR – noch nicht implementieren

## Phase 2 – Clarify Before Context

Später separat:

- offene Featureabsicht erkennen;
- `ask_user` vor RAG;
- FunctionGemma Decision Path;
- Visionmodell nur bei Bildinput;
- CPU-/GPU-Slotkorrektur;
- zielslotbezogene Warnung und Stop;
- Context-Stufen;
- First-Token-SLO.

## Abschlussbericht

Liefere:

1. Ausgangs-Head
2. finaler Head
3. geänderte Dateien
4. gefundene tatsächliche Ursache
5. Tests mit Zahlen
6. E2E-Nachweis A → B
7. verbleibende Risiken
8. explizite Bestätigung, dass Phase 2 nicht vorgezogen wurde
9. Vorschlag für den nächsten kleinen PR

Nicht selbst mergen.
