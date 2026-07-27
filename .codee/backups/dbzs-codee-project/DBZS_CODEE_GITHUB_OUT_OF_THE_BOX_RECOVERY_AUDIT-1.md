# DBZS Codee – GitHub Out-of-the-Box Recovery Audit

Stand: 2026-07-24  
Repository: `devdbzemusic/dbzs-codee-project`  
Geprüfter Branch: `main`  
Geprüfter Head: `6b56ee03025272e6f5726167a3664631ffe4b61f`

## Klare Diagnose

Codee leidet nicht mehr an fehlenden Einzelkomponenten. Vorhanden sind bereits Desktop-App, Backend, llama.cpp-Runtime-Slots, Rollenmodelle, Workflow-State-Machine, Runtime Binding, Context Budget, Tool-Protokoll, Agent-Turn-Loop, Datei- und Terminalwerkzeuge, Review-Orchestrator, RAG, Skills und viele Tests.

Das Hauptproblem ist jetzt:

```text
Zu viele teilautonome Subsysteme
+ mehrere historische Reparaturpfade
+ zu wenig verbindliche Live-Abnahme
= einzelne Tests grün, realer Gesamtlauf instabil
```

Codee braucht keinen weiteren großen Featureblock, sondern diesen kleinen Produktionskern:

```text
Nachricht
→ Auftrag verstehen
→ genau eine Binding Decision
→ genau ein passendes Modell
→ kleiner Context
→ kleiner Toolkatalog
→ echter Toolcall
→ echte Dateiänderung
→ Test
→ Diff
→ ehrlicher Abschluss
```

## 1. Was bereits richtig ist

### Canonical Workflow Resolver

Es existiert eine zentrale Workflow-Policy für Workflow-Kind, Phase, erlaubten Agenten, Modellrolle, Toolprofil und Übergänge.

### Immutable Runtime Binding

`apps/desktop/src/services/runtimeBinding.ts` enthält bereits:

```ts
RuntimeBindingDecision
createRuntimeBindingDecision()
assertRuntimeBindingConsistency()
```

Geprüft werden Workflow, Phase, Agent, Modellrolle, Toolprofil, Modell-ID, Slot, Provider und Protokollmodus.

### Provider-Preflight und kleinere Toolsets

Die jüngsten Diagnose-Runs zeigen:

- Toolzahl auf fünf reduziert;
- Toolbytes reduziert;
- Output-Reserve auf 512 reduziert;
- Request-Byte-Gate korrigiert;
- Context-Budget ohne Overflow;
- Preflight kann `compatible=true` liefern.

### Gute Testbasis

Vorhandene Root-Skripte:

```text
pnpm typecheck
pnpm test
pnpm build
pnpm test:capabilities
pnpm test:coding-loop
pnpm test:rag-chat-e2e
pnpm test:capabilities:e2e
pnpm acceptance:live
pnpm ci:local:win
```

## 2. Warum Codee trotzdem noch nicht zuverlässig läuft

### P0-A – Der reale Golden Path ist nicht das führende Gate

Die entscheidende Benutzerstrecke ist nicht dauerhaft als verpflichtendes Gate abgesichert:

```text
Electron starten
→ Testprojekt öffnen
→ kleine Änderung anfordern
→ Modell routen
→ Datei lesen
→ Patch vorschlagen
→ Approval
→ Patch anwenden
→ Tests ausführen
→ Diff anzeigen
→ Run erfolgreich abschließen
```

### P0-B – `runtimeChatStore.ts` bleibt der Integrationsmonolith

Der Store koordiniert Routing, Workflow, Context, RAG, Skills, Tool Runner, Review, Remediation, Runtime, Provider, Approvals, Fragen, Finalisierung und Observability. Dadurch können trotz einzelner Services Reihenfolgen und Zustände erneut auseinanderlaufen.

### P0-C – Zu viele historische Fallbackpfade

Es existieren Stream-, Tool-freie, Context-, Slot-, Workflow-, Review- und Remediation-Fallbacks. Jeder Pfad ist einzeln begründbar; gemeinsam werden sie schwer vorhersehbar.

### P0-D – Test-Runtime ist nicht Live-Runtime

Die Testbridge simuliert Modellantworten, Toolcalls, Warm-up und Slots. Damit können Tests grün sein, obwohl ein echtes Modell Tool-Envelope, Chat-Template, JSON, Stop-Tokens oder Streaming anders behandelt.

### P0-E – Rollenmodelle sind noch nicht zertifiziert

Ein Modell darf erst nach lokalem Nachweis als Chat-, Planner-, Coder- oder Reviewmodell gelten:

```text
Text Chat
System Prompt
JSON
Tool Envelope
Streaming
Stop Tokens
Context 4096
deutsche Instruktionen
Dateipfadtreue
Patchformat
```

### P0-F – CI ist nicht das aktuelle Wahrheitszentrum

Lokale Required-Gate-Skripte sind vorhanden, aber automatische CI-Trigger wurden in der Commit-Historie deaktiviert. Damit kann `main` Änderungen enthalten, ohne dass jeder Commit den kompletten Pflichtlauf erneut durchlaufen hat.

## 3. Was jetzt nicht gebaut werden sollte

Bis zum grünen Golden Path stoppen:

- neue Workflow-Editoren;
- neue MCP-Integrationen;
- neue Skill-Typen;
- neue Agentenrollen;
- weitere Review-Modi;
- weitere Context-Stufen;
- zusätzliche Fallbacks;
- automatische Cloud-Routinglogik;
- große UI-Umbauten;
- neue Modellklassen ohne Zertifizierung.

Tokenizer, Reranker und Shrink Pipeline nur soweit integrieren, wie sie den Golden Path direkt stabilisieren.

## 4. Verbindlicher Recovery Plan

### Phase 0 – Main einfrieren

Für 48 Stunden nur Stabilisierung:

- keine Features;
- keine Refactorings ohne Golden-Path-Bezug;
- jeder Fix braucht Reproduktion und Regressionstest;
- keine stillen Fallbacks;
- keine parallelen Architekturprompts.

### Phase 1 – Ein einziger Test-Workflow

Workflow-ID:

```text
golden_small_code_change_v1
```

Testprojekt:

```text
test-fixtures/coding-capability-project
```

Auftrag:

```text
Öffne src/calculator.ts.
Die Funktion subtract addiert fälschlich.
Korrigiere sie, führe die Tests aus und zeige mir den Diff.
```

Erwarteter Ablauf:

```text
1. Intent = fix
2. Workflow = debug_fix oder code_change
3. diagnosis/read
4. planning
5. Approval
6. implementation/coder
7. read_file
8. apply_patch
9. run_tests
10. git_diff
11. verification
12. completed
```

Für diesen Lauf deaktivieren:

```text
Review-Orchestrator
RAG
Skills
Websuche
Orchestrator-Modell
Modell-Fallback
```

### Phase 2 – Minimal Runtime Profile

```text
Chat:
Gemma 3 1B QAT Q4_0

Planner/Coder:
ein klassisches 1.5B–4B Instruct-Coder-Modell

Tools:
read_file
apply_patch
run_tests
git_diff
ask_user
```

Maximal fünf Tools. Context zunächst 4096, Output Reserve 512, kein breites RAG, ein Modell pro Lauf, kein Slotwechsel nach Binding.

### Phase 3 – Binding Gate direkt vor Provider

Verbindlich:

```text
binding.modelId
= prepared.modelId
= slot.modelId
= provider.modelId
```

Zusätzlich:

```text
binding.phase = prepared.phase
binding.agent = prepared.agent
binding.toolProfile = prepared.toolProfile
binding.protocol = provider.protocol
```

Bei Abweichung:

```text
request_binding_mismatch
```

Provider nicht aufrufen.

### Phase 4 – Tool-Protokoll zertifizieren

Canary:

```text
Lies README.md und gib ausschließlich einen read_file-Toolcall aus.
```

Erwartet:

- exakt ein Toolcall;
- gültige Argumente;
- kein Markdown-Codeblock;
- kein erklärender Text davor;
- Parser akzeptiert;
- Tool wird ausgeführt;
- Resultat erreicht Turn 2.

### Phase 5 – Agent-Turn-Persistenz

Harte Invarianten:

```text
agentTurnCount === turns.length
completedToolCalls === abgeschlossene Toolcalls
fileChanges.length > 0 nur nach echtem Write
commands.length > 0 nur nach echtem Command
```

Ein Turn wird vor Providerstart angelegt. Fehlgeschlagene Turns bleiben erhalten.

### Phase 6 – Echte Windows-Abnahme

Real prüfen:

```text
read_file
apply_patch
run_tests
git_diff
```

Besonders:

- `.cmd`/`.bat` über `ComSpec`;
- PowerShell-Quoting;
- Workspace-Grenzen;
- Pfadnormalisierung;
- keine Writes außerhalb Workspace;
- Patch-Rollback;
- Restore Point.

### Phase 7 – Ein einziges Acceptance-Kommando

Neu oder konsolidiert:

```text
pnpm acceptance:golden
```

Es muss ausführen:

```text
1. doctor
2. backend start
3. Modell-Capability-Check
4. Golden-Path-Workflow
5. Dateiinhalt prüfen
6. Tests prüfen
7. Diff prüfen
8. Run-JSON prüfen
9. Runtime sauber stoppen
```

Exit Code:

```text
0 = vollständig bestanden
1 = irgendein Gate fehlgeschlagen
```

Artefakte:

```text
.codee/acceptance/<timestamp>/
├── run.json
├── provider-request.redacted.json
├── tool-calls.json
├── diff.patch
├── test-output.txt
└── report.md
```

### Phase 8 – CI wieder verbindlich machen

Required Gates:

```text
typecheck
unit tests
backend tests
build
golden fixture test
binding invariant
tool protocol fixture
```

Kein Release ohne lokalen `acceptance:golden`-Nachweis.

## 5. Prioritäten

### P0 – Sofort

1. Golden Path festlegen.
2. Minimalprofil ohne RAG, Skills und Review aktivieren.
3. echtes Modell für Toolcalling zertifizieren.
4. Binding vor Provider hart prüfen.
5. Agent-Turn-Persistenz korrigieren.
6. Dateiänderung, Test und Diff real ausführen.
7. `acceptance:golden` bauen.

### P1 – Danach

1. Chatmodell separat stabilisieren.
2. Planner und Coder trennen.
3. Context Cache und exakte Tokenisierung.
4. Reranker für große Workspaces.
5. Review-Orchestrator live abnehmen.
6. Fix-Findings live abnehmen.

### P2 – Erst nach stabiler Basis

1. Skills Runtime erweitern.
2. MCP-Adapter.
3. grafischer Workflow-Editor.
4. Cloud-Fallbacks.
5. Multi-Agent-Parallelität.
6. automatische Modellzertifizierung aller Modelle.

## 6. Produktionsreife-Kriterien

Codee gilt erst als „läuft“, wenn zehn aufeinanderfolgende Golden-Path-Läufe bestehen:

```text
10/10 erfolgreich
0 Binding Mismatches
0 stille Modellwechsel
0 leere Agent-Turn-Historien
0 Fake-Erfolge
0 Writes außerhalb Workspace
10/10 Tests nach Patch grün
10/10 sauberer Runtime-Shutdown
```

Danach erst:

```text
Golden Path 2: Repository Review
Golden Path 3: Fix Review Findings
```

## Endurteil

Der Codebestand ist technisch weiter als das aktuelle Nutzererlebnis vermuten lässt.

Das Problem ist nicht:

```text
Codee kann nichts.
```

Das Problem ist:

```text
Codee kann zu viel gleichzeitig,
aber der Kernpfad ist noch nicht zum unumgehbaren Produktvertrag geworden.
```

Die richtige Strategie:

```text
Scope brutal verkleinern
→ einen realen Workflow vollständig grün machen
→ zehnmal reproduzieren
→ erst dann Funktionen wieder zuschalten
```
