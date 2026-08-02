# DBZS Codee v4 – Verbindlicher Maßnahmenkatalog zur vollständigen Workflow- und Usecase-Abdeckung

**Zielsystem:** persönlicher lokaler KI-Code-Assistent  
**Repository-Stand der Analyse:** `main`, Commit `cf049233b9a7f04709eec44b3f36bee5303db2af`  
**Datum:** 2026-08-02  
**Geltungsbereich:** Codee Desktop, Electron Bridge, FastAPI Backend, Agent Runtime, Model Lab, lokale Agentic-Modelle, erweiterte Rollen, Workspace- und Tool-Ausführung

---

## 1. Ziel und Garantiebegriff

Dieser Maßnahmenkatalog soll nicht nur zusätzliche Funktionen auflisten. Er definiert ein System, mit dem nach der Umsetzung **nachweisbar festgestellt werden kann**, dass alle festgelegten Codee-Workflows und Usecases vollständig unterstützt werden.

Eine seriöse technische Garantie kann nur für einen klar definierten Geltungsbereich gelten. Deshalb gilt ein Usecase erst dann als abgedeckt, wenn alle folgenden Ebenen vorhanden und geprüft sind:

1. Intent-Erkennung
2. Workflow-Zuordnung
3. Phasensteuerung
4. Agentenrolle
5. Modellrolle
6. Modellzertifizierung
7. Toolprofil
8. Berechtigungs- und Freigabepolitik
9. Kontextbereitstellung
10. Ausführung
11. Ergebnisvalidierung
12. Fehlerbehandlung und Recovery
13. Telemetrie und Nachvollziehbarkeit
14. automatisierter Akzeptanztest
15. dokumentierter Abdeckungsnachweis

**Abdeckungsformel:**

```text
Usecase vollständig =
Intent erkannt
AND Workflow erreichbar
AND jede Phase ausführbar
AND geeignete Rolle verfügbar
AND zertifiziertes Modell routbar
AND benötigte Tools verfügbar
AND Sicherheitsstufe ausreichend
AND Ergebnis prüfbar
AND Fehlerpfad getestet
AND Akzeptanztest grün
```

Fehlt nur ein Teil, lautet der Status nicht „fertig“, sondern `PARTIAL`, `BLOCKED` oder `UNVERIFIED`.

---

# 2. Verbindliche Architekturentscheidung

## M-001 – Zentrales Usecase- und Workflow-Register einführen

Es wird ein maschinenlesbares Register als einzige fachliche Wahrheit eingeführt.

**Empfohlene Dateien:**

```text
packages/shared/src/usecases/usecaseContracts.ts
packages/shared/src/usecases/usecaseRegistry.ts
packages/shared/src/workflows/workflowContracts.ts
backend/app/usecases/registry.py
```

Jeder Usecase benötigt mindestens:

```ts
interface UsecaseDefinition {
  id: string;
  title: string;
  description: string;
  category: UsecaseCategory;

  acceptedIntents: string[];
  workflowKind: WorkflowKind;
  entryPhase: CanonicalWorkflowPhase;
  allowedAgents: WorkflowAgentRole[];
  requiredModelRoles: WorkflowModelRole[];
  requiredCapabilities: string[];
  requiredCertifications: ModelFleetCertificationKind[];
  requiredTools: string[];
  minimumSafetyLevel: ModelFleetSafetyLevel;

  contextRequirements: ContextRequirement[];
  approvalPolicy: ApprovalPolicy;
  verificationPolicy: VerificationPolicy;
  recoveryPolicy: RecoveryPolicy;

  acceptanceScenarioIds: string[];
  enabled: boolean;
  coverageStatus: CoverageStatus;
}
```

**Abnahmekriterium:**

Kein produktiver Workflow darf außerhalb dieses Registers entstehen oder geroutet werden.

---

## M-002 – Workflow-, Agenten- und Model-Lab-Rollen vereinheitlichen

Aktuell existieren mehrere Rollentaxonomien:

### Workflow-Agenten

- `runtime_chat`
- `planner`
- `debugger`
- `coder`
- `tester`
- `reviewer`

### Workflow-Modellrollen

- `chat`
- `planner`
- `debug`
- `coder`
- `review`

### Model-Fleet-Rollen

- `MAIN_AGENT`
- `DEEP_RESEARCH_AGENT`
- `FAST_GENERAL_AGENT`
- `MICRO_TOOL_AGENT`
- `CODING_EXECUTOR`
- `ALGORITHM_SPECIALIST`
- `REASONING_VALIDATOR`
- `REPORT_GENERATOR`

Diese Ebenen dürfen bestehen bleiben, benötigen aber eine **offizielle Mapping-Tabelle**.

### Verbindliches Mapping

| Workflow-Agent | Workflow-Modellrolle | bevorzugte Fleet-Rolle | mögliche Spezialrolle |
|---|---|---|---|
| runtime_chat | chat | FAST_GENERAL_AGENT | MAIN_AGENT |
| planner | planner | MAIN_AGENT | DEEP_RESEARCH_AGENT |
| debugger | debug | REASONING_VALIDATOR | ALGORITHM_SPECIALIST |
| coder | coder | CODING_EXECUTOR | ALGORITHM_SPECIALIST |
| tester | review | REASONING_VALIDATOR | MICRO_TOOL_AGENT |
| reviewer | review | REASONING_VALIDATOR | DEEP_RESEARCH_AGENT |
| docs, neu | chat/review | REPORT_GENERATOR | MAIN_AGENT |
| researcher, neu | planner | DEEP_RESEARCH_AGENT | REPORT_GENERATOR |
| orchestrator, neu | planner | MAIN_AGENT | FAST_GENERAL_AGENT |
| tool_worker, neu | chat | MICRO_TOOL_AGENT | FAST_GENERAL_AGENT |

**Abnahmekriterium:**

Für jede Workflow-Rolle existiert mindestens ein aktives, zertifiziertes und routbares Modell oder ein definierter degradierter Fallback.

---

## M-003 – Fehlende erweiterte Workflow-Rollen ergänzen

Die vorhandenen sechs Workflow-Agenten decken Coding-Grundabläufe ab, aber nicht alle erweiterten Usecases.

Ergänzen:

```ts
type WorkflowAgentRole =
  | "runtime_chat"
  | "orchestrator"
  | "planner"
  | "researcher"
  | "debugger"
  | "coder"
  | "tester"
  | "reviewer"
  | "docs"
  | "tool_worker";
```

### Rollenverantwortung

#### `orchestrator`

- zerlegt komplexe Anforderungen
- erstellt Task-Graphen
- weist Teilaufgaben zu
- verhindert widersprüchliche parallele Änderungen
- sammelt Resultate
- entscheidet über Rücksprünge in frühere Phasen

#### `researcher`

- recherchiert Repository, Dokumentation und optional Webquellen
- sammelt Evidenz
- darf standardmäßig nicht schreiben
- erzeugt strukturierte Research-Pakete

#### `docs`

- erstellt und aktualisiert Dokumentation
- prüft Dokumentationsdrift
- darf nur freigegebene Dokumentbereiche verändern

#### `tool_worker`

- führt deterministische Hilfsoperationen aus
- Dateisuche
- Indexierung
- Formatierung
- Build-Aufruf
- Test-Aufruf
- Metadatengewinnung
- benötigt kein großes Reasoning-Modell

**Abnahmekriterium:**

Komplexe Workflows dürfen nicht mehr künstlich als `coder` oder `runtime_chat` ausgeführt werden, wenn ihre eigentliche Funktion Orchestrierung, Recherche, Dokumentation oder Tool-Ausführung ist.

---

# 3. Vollständiger Usecase-Katalog

## UC-01 – Freier Chat und Erklärung

**Beispiele:**

- Code erklären
- Architektur erklären
- Begriff erklären
- Dateiinhalt zusammenfassen
- technische Frage beantworten

**Workflow:** `chat`  
**Rollen:** `runtime_chat`  
**Modellrollen:** `chat`  
**Tools:** optional Read-only  
**Sicherheitsstufe:** Level 0 oder 1

**Pflichtnachweise:**

- ohne Tools ausführbar
- mit explizitem Dateikontext ausführbar
- keine unbeabsichtigte Dateiveränderung
- Quellen des Workspace-Kontexts sichtbar
- klare Kennzeichnung von Annahmen

---

## UC-02 – Repository- und Workspace-Inspektion

**Beispiele:**

- Repository-Struktur analysieren
- Implementierungsstand feststellen
- Abhängigkeiten prüfen
- relevante Dateien finden
- Architekturpfade nachvollziehen

**Workflow:** `review` oder neue Unterart `inspection`  
**Rollen:** `researcher`, `reviewer`  
**Modellrollen:** `review`, `planner`  
**Tools:** Workspace Search, Read, Git Status, Symbolsuche  
**Sicherheitsstufe:** Level 1

**Pflichtnachweise:**

- rekursive Workspace-Erfassung
- Ignore-Regeln
- Dateigrößen- und Binärschutz
- Quellenbelege pro Befund
- keine Schreiboperationen
- Teil- und Vollrepository-Modus

---

## UC-03 – Planung und Architekturentwurf

**Beispiele:**

- Feature planen
- Refactoring planen
- Backend-Bridge-Vertrag entwerfen
- Implementierungsphasen erstellen
- Risiken und Abhängigkeiten bestimmen

**Workflow:** `planning`  
**Rollen:** `planner`, bei großen Aufgaben `orchestrator`  
**Modellrollen:** `planner`  
**Tools:** Read-only Workspace, Git History, Model Lab optional  
**Sicherheitsstufe:** Level 1

**Pflichtnachweise:**

- Scope
- Istzustand
- Zielzustand
- betroffene Komponenten
- Abhängigkeiten
- Migrationsstrategie
- Teststrategie
- Rollback
- Definition of Done

---

## UC-04 – Kleine Codeänderung

**Beispiele:**

- einzelner Bugfix
- kleine UI-Anpassung
- neue Validierung
- lokaler Refactor

**Workflow:** `code_change`  
**Phasen:** Diagnose → Planung → Implementation → Testing → Verification  
**Rollen:** `planner`, `coder`, `tester`  
**Modellrollen:** `planner`, `coder`, `review`  
**Sicherheitsstufe:** Level 2

**Pflichtnachweise:**

- Patch-Vorschau
- begrenzter Dateiscope
- relevante Tests
- Typecheck/Lint
- Diff-Zusammenfassung
- kein stiller Fallback auf ungeeignetes Modell

---

## UC-05 – Große Implementierung

**Beispiele:**

- neues Subsystem
- Model-Lab-Erweiterung
- Runtime-Bridge
- neue Agentenfunktion
- Frontend–Bridge–Backend-Durchstich

**Workflow:** `code_change`  
**Rollen:** `orchestrator`, `planner`, `coder`, `tester`, `reviewer`, `docs`  
**Modellrollen:** mehrere  
**Sicherheitsstufe:** Level 2 bis 4

**Pflichtnachweise:**

- Task-Graph
- Komponenten-Ownership
- sequenzielle Schreibsperren
- Contract-First-Entwicklung
- Integrationstests
- Migrationsprüfung
- Abschlussreview
- Dokumentationsabgleich

---

## UC-06 – Refactoring

**Beispiele:**

- Backend-Kommunikation refaktorieren
- Electron Bridge vereinheitlichen
- Stores zerlegen
- Importgrenzen bereinigen
- duplizierte Services entfernen

**Workflow:** `refactoring`  
**Rollen:** `orchestrator`, `planner`, `coder`, `tester`, `reviewer`  
**Pflichtnachweise:**

- Verhaltensbaseline vor Änderung
- Contract-Tests
- Import-Boundary-Prüfung
- kein Funktionsverlust
- alte Pfade nach Migration entfernt
- Dead-Code-Nachweis
- Regressionstest

---

## UC-07 – Debugging und Fehlerbehebung

**Beispiele:**

- Backend-Timeout
- Modell startet nicht
- Request bricht ab
- Bridge liefert falsche Daten
- UI bleibt hängen

**Workflow:** `debug_fix`  
**Rollen:** `debugger`, `researcher`, `coder`, `tester`  
**Modellrollen:** `debug`, `coder`, `review`

**Pflichtnachweise:**

- reproduzierbarer Fehler
- Hypothesenliste
- Evidenz je Hypothese
- Root Cause
- minimaler Fix
- Regressionstest
- Telemetrieverbesserung
- Recovery-Pfad

---

## UC-08 – Code Review

**Scopes:**

- aktive Datei
- ausgewählte Dateien
- uncommitted changes
- letzter Commit
- Branch-Diff
- vollständiges Repository

**Workflow:** `review`  
**Rollen:** `reviewer`, `researcher`, optional `tester`  
**Sicherheitsstufe:** Level 1

**Pflichtnachweise:**

- Scope ist explizit
- Findings mit Schweregrad
- Datei und Position
- technische Begründung
- Auswirkungen
- konkrete Korrektur
- keine Änderung ohne Wechsel in Remediation

---

## UC-09 – Review Remediation

**Beispiele:**

- gefundene Review-Probleme beheben
- priorisierte Findings abarbeiten

**Workflow:** `review_remediation`  
**Rollen:** `planner`, `coder`, `tester`, `reviewer`

**Pflichtnachweise:**

- Finding-ID bleibt über den gesamten Ablauf erhalten
- Fix ist dem Finding zugeordnet
- Testnachweis
- Reviewer schließt oder öffnet Finding erneut
- keine stillschweigende Selbstabnahme durch denselben Agentenlauf

---

## UC-10 – Testen

**Arten:**

- Unit
- Integration
- Contract
- Capability
- E2E
- Regression
- Smoke
- Packaging
- Live Runtime
- Hardwareprofil

**Workflow:** `test`  
**Rollen:** `tester`, `tool_worker`, bei Fehlern `debugger`  
**Sicherheitsstufe:** Level 3

**Pflichtnachweise:**

- Testauswahl begründet
- Prozessausgabe gespeichert
- Exit-Code
- Timeout
- Abbruch
- Wiederholung
- Flaky-Markierung
- Resultat maschinenlesbar

---

## UC-11 – Build und Packaging

**Workflow:** `build`  
**Rollen:** `tool_worker`, `tester`  
**Sicherheitsstufe:** Level 3

**Pflichtnachweise:**

- reproduzierbarer Befehl
- Prozess- und Fehlerausgabe
- Artefaktpfad
- Versionsprüfung
- Backend-Paketierung
- Desktop-Build
- Installations-Smoke auf deiner Zielhardware

---

## UC-12 – Workspace Backup und Restore

**Workflow:** `workspace_backup`  
**Rollen:** `tool_worker`  
**Sicherheitsstufe:** Level 2

**Pflichtnachweise:**

- Backup vor destruktiven Großänderungen
- Restore-Test
- Manifest mit Hashes
- Ausschluss unnötiger Build-Dateien
- Sicherung von Codee-Konfiguration, Model Lab DB und Migrationsstand
- kein ZIP-Zwang; bevorzugt normales Verzeichnis oder Git-Snapshot

---

## UC-13 – Workspace Maintenance

**Beispiele:**

- Cache bereinigen
- verwaiste Dateien erkennen
- Index neu aufbauen
- temporäre Dateien entfernen
- Importgrenzen prüfen
- Dokumentationsdrift prüfen

**Workflow:** `workspace_maintenance`  
**Rollen:** `tool_worker`, `reviewer`  
**Pflichtnachweise:**

- Dry Run
- explizite Löschliste
- Schutzregeln
- Rollback oder Backup
- Ergebnisprotokoll

---

## UC-14 – Git-Arbeitsabläufe

**Beispiele:**

- Status und Diff
- Branch erstellen
- Commit vorbereiten
- Rebase-Konflikte analysieren
- Merge prüfen
- funktionierenden Stand taggen

**Workflow:** neue Unterart `git_operation` oder `workspace_maintenance`  
**Rollen:** `tool_worker`, `reviewer`, `orchestrator`  
**Sicherheitsstufe:** Level 4

**Pflichtnachweise:**

- kein Push, Reset, Clean, Force oder Branch-Löschen ohne explizite Freigabe
- Diff vor Commit
- Tests vor Merge
- Konfliktanalyse
- Commit-Metadaten
- keine Secrets im Diff

---

## UC-15 – Dokumentation

**Beispiele:**

- Entwicklungsstatus
- Architekturpapier
- API-Vertrag
- Hand-over
- Changelog
- Bedienhinweis

**Workflow:** neue Unterart `documentation`  
**Rollen:** `docs`, `researcher`, `reviewer`  
**Modellrollen:** `chat`, `review`

**Pflichtnachweise:**

- Aussagen mit Codebestand abgeglichen
- keine erfundenen Features
- Statuswerte eindeutig
- Dokumentationsdrift-Prüfung
- Quellverweise

---

## UC-16 – Kontextaufbau und RAG

**Beispiele:**

- relevante Dateien für Aufgabe sammeln
- semantische Suche
- Symbolzusammenhänge
- vergangene Entscheidungen einbeziehen
- Context Pack erzeugen

**Workflow:** Querschnittsfunktion  
**Rollen:** `researcher`, `tool_worker`

**Pflichtnachweise:**

- Kontextquelle
- Ranking
- Tokenbudget
- Duplikatfilter
- Aktualitätsprüfung
- Workspace-Revision
- Schutz gegen veralteten Index
- Fallback auf direkte Dateisuche
- keine unbemerkte Vermischung anderer Workspaces

---

## UC-17 – Bild- und multimodale Analyse

**Beispiele:**

- Screenshot analysieren
- UI-Fehler erkennen
- Diagramm lesen
- Vision-Modell mit mmproj starten

**Workflow:** `chat`, `review` oder `debug_fix`  
**Rollen:** nach Aufgabe  
**Pflichtnachweise:**

- Vision-Modell und Projektor korrekt gepaart
- Text-only-Fähigkeit separat bekannt
- Routing nur bei zertifiziertem Multimodal-Paar
- Support-Artefakt niemals als Hauptmodell starten
- Bildbezug im Resultat nachvollziehbar

---

## UC-18 – Modellinventarisierung

**Beispiele:**

- Modellordner scannen
- GGUF, Adapter, Tokenizer, Config und mmproj erkennen
- Bundles bilden
- Duplikate finden

**Workflow:** neue Unterart `model_inventory`  
**Rollen:** `tool_worker`  
**Pflichtnachweise:**

- rekursive Quellen
- Include-/Exclude-Regeln
- Hashing
- Architekturmetadaten
- Artefakttyp
- Modellfamilie
- Varianten
- Cache-Versionierung
- Rescan und Invalidierung

---

## UC-19 – Modellprüfung und Zertifizierung

**Beispiele:**

- Load Probe
- Chat Test
- Structured Output
- Tool Calling
- Coding
- Repository QA
- Long Horizon
- Vision
- GPU-Profil

**Workflow:** neue Unterart `model_certification`  
**Rollen:** `tester`, `tool_worker`, `reviewer`

**Pflichtnachweise:**

- reproduzierbare Test-Suite
- Prompt-/Dataset-Version
- Hardware-Fingerprint
- Runtime-Preset
- Messwerte
- Pass-/Fail-Grenzen
- Zertifikat mit Ablauf- oder Invalidierungsregeln
- keine Rollenzuweisung ohne notwendige Zertifizierung

---

## UC-20 – Modellbenchmark und Tuning

**Beispiele:**

- GPU
- CPU
- Hybrid
- Layeranzahl
- Context Size
- Batch/UBatch
- Cache-Typ
- Startzeit
- Tokens/s
- RAM/VRAM Peak

**Workflow:** neue Unterart `model_benchmark`  
**Rollen:** `tool_worker`, `tester`

**Pflichtnachweise:**

- Warm- und Cold-Start getrennt
- Prompt Processing und Generation getrennt
- Qualitätscheck neben Geschwindigkeit
- Messwiederholung
- Hardwareprofil
- bestes stabiles Preset
- thermische und RAM-Grenzen

---

## UC-21 – Agentic-Modellflotte

**Zielslots:**

- `fast_gpu`
- `quality_cpu`
- `utility`
- `orchestrator`

**Pflichtnachweise:**

- Slot-Budget
- erlaubte Rollen je Slot
- bevorzugte Residency
- Startpriorität
- Eviction-Priorität
- Fallback-Kette
- Healthcheck
- Crash Recovery
- in-flight Drain
- keine doppelte unkontrollierte Modellinstanz

---

## UC-22 – Multi-Agent-Aufgabe

**Beispiele:**

- planen → implementieren → testen → reviewen
- Repository prüfen → Maßnahmen planen → Findings beheben
- Modellflotte analysieren → benchmarken → Rollen zuweisen

**Workflow:** Meta-Workflow  
**Rollen:** `orchestrator` plus Fachrollen

**Pflichtnachweise:**

- Task-Graph mit IDs
- Abhängigkeiten
- Input/Output-Vertrag je Agent
- Schreib-Ownership
- keine parallelen Änderungen derselben Datei
- Artefaktübergabe
- Fehlerpropagation
- Retry-Grenzen
- Abschlussaggregation
- Gesamtvalidierung

---

## UC-23 – Lange Agentenläufe und Wiederaufnahme

**Pflichtnachweise:**

- persistenter Task-Vertrag
- Phase und Checkpoint
- verwendete Workspace-Revision
- Modell- und Routingentscheidung
- bereits ausgeführte Tools
- offene Schritte
- Resume nach App-/Backend-Neustart
- Schutz vor doppelter Ausführung
- Cancel und Rollback

---

## UC-24 – Terminal- und Shell-Ausführung

**Pflichtnachweise:**

- Allowlist und Risikoklassifikation
- Arbeitsverzeichnis
- Umgebungsvariablenfilter
- Secret-Redaction
- Timeout
- Output-Limit
- Prozessbaum-Abbruch
- Freigabeschwelle
- gefährliche Befehle blockieren
- vollständiges Audit-Protokoll

---

## UC-25 – Datei- und Ordneroperationen

**Pflichtnachweise:**

- Workspace Path Guard
- Symlink-/Junction-Prüfung
- atomisches Schreiben
- Hash- oder Revision-Check vor Überschreiben
- Konflikterkennung
- Backup für destruktive Änderung
- Batch-Operation als Transaktion oder mit Recovery-Plan
- Explorer und Agent benutzen denselben Dateiservice

---

## UC-26 – Einstellungen und Runtime-Rekonfiguration

**Pflichtnachweise:**

- Klassifikation `hot`, `runtime_restart`, `app_restart`
- laufende Requests nur bei relevanter Änderung invalidieren
- Revision und Herkunft
- Validierung vor Speichern
- Rollback auf letzte gültige Konfiguration
- keine DB-Seiteneffekte bei deaktiviertem Feature

---

## UC-27 – Diagnose und System Doctor

**Pflichtnachweise:**

- Desktop
- Electron Bridge
- Backend
- Datenbanken
- Workspace-Zugriff
- Modellpfade
- llama.cpp
- GPU/Vulkan
- Ports
- Runtime-Slots
- RAG-Index
- Toolberechtigungen
- letzte Fehler
- konkrete Reparaturaktionen

---

## UC-28 – Ausfall und Recovery

**Fehlerklassen:**

- Backend nicht erreichbar
- Modellstart schlägt fehl
- Modellprozess stirbt
- RAM kritisch
- Tool hängt
- Test hängt
- Datei wurde extern verändert
- Datenbank gesperrt
- Index veraltet
- Context Pack unvollständig

**Pflichtnachweise:**

- Fehlerklassifikation
- Retry nur bei transientem Fehler
- Circuit Breaker
- degradierter Modus
- sichere Freigabe von Ressourcen
- verständliche UI-Meldung
- Resume oder sauberer Abbruch
- Recovery-Test je Fehlerklasse

---

# 4. Model-Fleet-Maßnahmen

## M-100 – Capability-Taxonomie festschreiben

Keine freien, uneinheitlichen Capability-Strings mehr.

Mindestens:

```text
chat
instruction_following
structured_output
json_schema
tool_calling
workspace_read
workspace_write
terminal
git
coding
debugging
planning
review
testing
repository_qa
deep_research
long_context
vision
text_only
report_generation
embedding
reranking
classification
summarization
```

**Regel:** beobachtet, verifiziert und zertifiziert sind unterschiedliche Zustände.

---

## M-101 – Zertifizierungsmatrix pro Rolle

| Fleet-Rolle | Mindestzertifikate |
|---|---|
| FAST_GENERAL_AGENT | CHAT, INSTRUCTION_FOLLOWING |
| MAIN_AGENT | CHAT, INSTRUCTION_FOLLOWING, STRUCTURED_OUTPUT, LONG_HORIZON |
| DEEP_RESEARCH_AGENT | READ_ONLY_AGENT, DEEP_RESEARCH, REPORT_GENERATION |
| MICRO_TOOL_AGENT | STRUCTURED_OUTPUT, TOOL_CALLING |
| CODING_EXECUTOR | TOOL_CALLING, WRITE_AGENT, CODING |
| ALGORITHM_SPECIALIST | CODING, STRUCTURED_OUTPUT, LONG_HORIZON |
| REASONING_VALIDATOR | STRUCTURED_OUTPUT, REPOSITORY_QA |
| REPORT_GENERATOR | REPORT_GENERATION, STRUCTURED_OUTPUT |

Zusatzregel:

- Level 2 benötigt `WRITE_AGENT_VERIFIED`
- Level 3 benötigt Tool-/Terminal-spezifische Prüfung
- Level 4 benötigt zusätzliche Shell-/Git-Zertifizierung
- Vision benötigt ein verifiziertes Modell-Projektor-Paar

---

## M-102 – Residency-Policy operationalisieren

`residency_intent` darf nicht nur Metadatum sein.

### `orchestrator`

- `keep_resident`
- klein
- CPU oder geringer GPU-Anteil
- jederzeit verfügbar

### `fast_gpu`

- `keep_resident` oder lange Idle-Zeit
- schnelles Coding-/Chat-Modell
- höchste Interaktionspriorität

### `utility`

- kleine spezialisierte Modelle
- Embedding/Reranking möglichst dauerhaft
- andere Utility-Modelle `idle_evict`

### `quality_cpu`

- großes Qualitätsmodell
- `idle_evict`
- nur bei komplexen Aufgaben
- niedrige Startpriorität
- kein Blockieren der schnellen Interaktion

---

## M-103 – Routing-Gates zentral erzwingen

Vor jedem Start:

```text
Bundle vorhanden?
Artefakt startbar?
Health ausreichend?
Runtime-Adapter kompatibel?
Preset vorhanden?
Rolle zugewiesen?
Zertifikate gültig?
Safety Level ausreichend?
Modalität passend?
Hardwarebudget verfügbar?
Slot verfügbar?
Fallback erlaubt?
```

Bei negativem Gate darf keine implizite Ausführung erfolgen.

---

## M-104 – Deterministische Fallback-Ketten

Beispiel:

```text
CODING_EXECUTOR
→ anderer zertifizierter CODING_EXECUTOR
→ MAIN_AGENT mit CODING_VERIFIED
→ Cloud nur bei explizit erlaubter Policy
→ sonst kontrollierter Abbruch
```

Kein Fallback nur deshalb, weil ein Modell gerade läuft.

---

# 5. Workflow Engine

## M-200 – Kanonische Workflow-Engine ins Backend verlagern

Die Desktop-Seite darf Intent und Darstellung übernehmen. Der authoritative Workflow-State gehört jedoch in eine persistente Backend-Domäne.

**Backend-Entitäten:**

```text
WorkflowInstance
WorkflowTask
WorkflowTransition
WorkflowCheckpoint
WorkflowArtifact
WorkflowApproval
WorkflowToolRun
WorkflowAgentRun
WorkflowVerification
WorkflowFailure
```

**Vorteil:**

- Resume nach Neustart
- idempotente Toolausführung
- zentrale Policies
- bessere Diagnostik
- Multi-Agent-Koordination

---

## M-201 – Persistente Zustandsmaschine

Jede Transition benötigt:

- erlaubte Ausgangsphase
- Event
- Zielphase
- Preconditions
- Side Effects
- idempotency key
- Audit Event

Keine direkte willkürliche Phasenänderung durch UI oder Modell.

---

## M-202 – Task-Graph für Multi-Agent-Arbeit

DAG mit:

- `task_id`
- `parent_task_id`
- `depends_on`
- `assigned_role`
- `required_tools`
- `input_artifacts`
- `output_contract`
- `workspace_scope`
- `write_ownership`
- `status`
- `retry_policy`

---

## M-203 – Schreib-Ownership und Konfliktschutz

Vor Dateiänderung:

1. Datei oder Scope reservieren.
2. Baseline-Hash speichern.
3. Paralleländerung verhindern.
4. Vor Apply Hash erneut prüfen.
5. Konflikt bei Abweichung.
6. Reservation nach Abschluss freigeben.

---

## M-204 – Ergebnisverträge je Agent

Modelle dürfen keine freien, schwer prüfbaren Übergaben erzeugen.

Beispiele:

### Planner Output

```json
{
  "scope": [],
  "steps": [],
  "dependencies": [],
  "risks": [],
  "tests": [],
  "definition_of_done": []
}
```

### Coder Output

```json
{
  "changed_files": [],
  "patches": [],
  "assumptions": [],
  "tests_requested": []
}
```

### Tester Output

```json
{
  "commands": [],
  "results": [],
  "failures": [],
  "coverage": [],
  "verdict": "passed|failed|inconclusive"
}
```

### Reviewer Output

```json
{
  "findings": [],
  "verdict": "approved|changes_required|blocked"
}
```

---

# 6. Tool- und Sicherheitsmaßnahmen

## M-300 – Einheitlicher Tool Catalog

Jedes Tool erhält:

- Tool-ID
- Version
- Eingabeschema
- Ausgabeschema
- Risikoklasse
- benötigtes Safety Level
- Timeout
- Idempotenz
- Dry-Run-Unterstützung
- Audit-Verhalten
- erlaubte Rollen

---

## M-301 – Toolprofile vollständig definieren

Mindestens:

```text
chat_only
workspace_read
workspace_inspection
workspace_write_limited
workspace_write_full
test_runner
build_runner
git_read
git_write_limited
terminal_limited
maintenance_dry_run
model_lab_operator
```

---

## M-302 – Freigabepolitik

### Keine Freigabe nötig

- Chat
- Lesen
- Suche
- Diagnose ohne Änderung
- Tests ohne destruktive Seiteneffekte

### Einmalige Planfreigabe

- begrenzte, klar beschriebene Codeänderung
- bekannte Tests
- definierter Scope

### Explizite Einzelaktionsfreigabe

- Löschen
- Überschreiben außerhalb normalen Patch-Flows
- Dependency-Installation
- Git Push
- Reset/Clean
- Shell-Kommandos mit erhöhtem Risiko
- Änderung von Secrets oder Environment

---

# 7. Kontext- und Gedächtnissystem

## M-400 – Context Pack Contract

Jeder Agent bekommt ein typisiertes Paket:

```text
Task Contract
Workflow State
Role Instructions
Workspace Scope
Relevant Files
Symbols
Git Diff
Prior Decisions
Model/Tool Limits
Acceptance Criteria
Token Budget
Context Revision
```

---

## M-401 – Context Coverage Check

Vor Ausführung muss Codee prüfen:

- alle explizit genannten Dateien enthalten?
- relevante Verträge enthalten?
- Tests enthalten?
- aktueller Git-Diff enthalten?
- Index aktuell?
- Tokenkürzung dokumentiert?
- fehlende Information blockierend?

---

## M-402 – Entscheidungs- und Projektspeicher

Trennen:

- Gesprächskontext
- Task-Kontext
- Workspace-Wissen
- Architekturentscheidungen
- Model-Lab-Wissen
- temporäre Toolresultate

Keine unkontrollierte Vermischung.

---

# 8. Test- und Nachweissystem

## M-500 – Usecase-Coverage-Matrix

Automatisch erzeugte Tabelle:

| Usecase | Intent | Workflow | Rollen | Modell | Tools | Happy Path | Failure Path | Resume | Status |
|---|---|---|---|---|---|---|---|---|---|

Statuswerte:

- `NOT_IMPLEMENTED`
- `PARTIAL`
- `IMPLEMENTED`
- `TESTED`
- `CERTIFIED`
- `BLOCKED`
- `REGRESSED`

Nur `CERTIFIED` gilt als vollständig abgedeckt.

---

## M-501 – Golden Scenario Suite

Für jeden Usecase mindestens:

1. normaler Erfolgsfall
2. unvollständige Anforderung
3. falsches oder ungeeignetes Modell
4. fehlendes Tool
5. Toolfehler
6. Abbruch
7. Neustart/Resume
8. externe Dateiänderung
9. Ressourcenknappheit
10. Ergebnisvalidierungsfehler

---

## M-502 – Agentic Capability Harness

Ein standardisierter Test-Runner prüft jedes Modell gegen Rollenanforderungen.

Messwerte:

- Instruktionstreue
- JSON-/Schema-Treue
- Toolauswahl
- Toolargumente
- Patchqualität
- Scope-Einhaltung
- Halluzinationsrate
- Recovery
- Langhorizont-Konsistenz
- Geschwindigkeit
- Ressourcenverbrauch

---

## M-503 – Workflow Contract Tests

Für jede Workflow-Art:

- alle erlaubten Transitionen
- alle verbotenen Transitionen
- Rollenwechsel
- Approval Gates
- Retry
- Cancel
- Failure
- Resume
- Abschluss

---

## M-504 – End-to-End-Szenarien

Mindestens folgende vollständige Ketten:

1. Chat ohne Tool
2. Datei erklären
3. kleines Feature planen und umsetzen
4. komplexes Feature orchestrieren
5. Bug reproduzieren und beheben
6. vollständiges Repository reviewen
7. Review-Findings beheben
8. Tests starten und Fehler analysieren
9. Build durchführen
10. Backup und Restore
11. Modell scannen, prüfen, benchmarken und Rolle zuweisen
12. Vision-Modell mit Projektor verwenden
13. langer Lauf mit App-Neustart
14. RAM-Druck mit kontrollierter Eviction
15. Modellcrash und Fallback
16. externe Dateiänderung während Patch-Erstellung
17. parallele Agenten mit Scope-Konflikt
18. Workspace Maintenance im Dry Run

---

## M-505 – Coverage Gate

Ein neuer Befehl:

```bash
pnpm coverage:usecases
```

Er schlägt fehl, wenn:

- Usecase ohne Registry-Eintrag
- Registry-Eintrag ohne Workflow
- Workflow ohne erreichbare Phase
- Phase ohne erlaubte Rolle
- Rolle ohne Modell-Mapping
- benötigte Zertifizierung nicht definiert
- Toolprofil fehlt
- Akzeptanztest fehlt
- Failure-Test fehlt
- Dokumentationsstatus widerspricht Code

---

# 9. Beobachtbarkeit und Diagnose

## M-600 – Einheitliches Execution Journal

Jeder Lauf protokolliert:

- Request-ID
- Workflow-ID
- Task-ID
- Phase
- Rolle
- Modell
- Slot
- Routinggrund
- Zertifikate
- Kontextrevision
- Toolaufrufe
- Freigaben
- Dateiänderungen
- Tests
- Fehler
- Retries
- Ergebnis
- Dauer
- RAM/VRAM

---

## M-601 – Workflow Inspector UI

Darstellung:

```text
Intent
→ Workflow
→ Phase
→ Agent
→ Modell
→ Slot
→ Context Pack
→ Tool Runs
→ Änderungen
→ Tests
→ Review
→ Abschluss
```

Mit Blocker- und Recovery-Anzeige.

---

## M-602 – Fleet Inspector

Pro Slot:

- Modell
- Rolle
- Zertifikate
- Preset
- RAM/VRAM
- Requests
- Ladezustand
- Health
- Idle-Zeit
- Eviction-Grund
- Fallback-Bereitschaft

---

# 10. Daten-, Cache- und Migrationssicherheit

## M-700 – Schema Registry

Versionieren:

- Model Lab DB
- Workflow DB
- Settings
- Workspace Index
- Modellcache
- Context Store
- Certification Schema

---

## M-701 – Cache-Invalidierung

Cache-Key enthält:

- Scanner-Version
- Classifier-Version
- Capability-Version
- Runtime-Adapter-Version
- Dateisignatur
- Metadatenversion

Damit korrigieren sich alte Fehleinstufungen automatisch.

---

## M-702 – Backup vor Migration

Jede Migration:

1. Backup
2. Validierung
3. Migration
4. Integrity Check
5. Rollback bei Fehler
6. Protokoll

---

# 11. Umsetzungsreihenfolge

## Phase 0 – Inventur und Scope

- alle vorhandenen Workflows, Rollen, Tools und Tests inventarisieren
- Usecase Registry anlegen
- Coverage-Status initial auf `NOT_IMPLEMENTED` oder `PARTIAL`
- keine Selbsteinschätzung als `CERTIFIED`

**Ergebnis:** ehrliche Lückenmatrix

---

## Phase 1 – Verträge vereinheitlichen

- Rollen-Mapping
- Capability-Taxonomie
- Tool Catalog
- Safety-Level
- Ergebnisverträge
- Workflow- und Usecase-IDs

**Ergebnis:** keine widersprüchlichen Taxonomien

---

## Phase 2 – Workflow Engine

- persistente Workflow-Instanzen
- Zustandsmaschine
- Task-Graph
- Checkpoints
- Resume
- Idempotenz
- Approval-System

**Ergebnis:** belastbare Langläufer und Multi-Agent-Abläufe

---

## Phase 3 – Model Fleet Enforcement

- Rollen-Zertifizierung
- Residency Policies
- Slot-Budgets
- Routing-Gates
- Fallback-Ketten
- Model Lab ↔ Runtime Synchronisation

**Ergebnis:** nur geeignete Modelle übernehmen Aufgaben

---

## Phase 4 – Tool- und Dateiabsicherung

- einheitlicher Tool Service
- Path Guard
- atomische Patches
- Ownership Locks
- Terminal Policy
- Git Policy
- Dry Run und Backup

**Ergebnis:** Agenten können sicher arbeiten

---

## Phase 5 – Kontext und RAG

- Context Pack
- Coverage Check
- Workspace-Revision
- Index-Invalidierung
- Quellen- und Tokenprotokoll

**Ergebnis:** Agenten erhalten den notwendigen, aktuellen Kontext

---

## Phase 6 – Verifikation

- Golden Scenarios
- Capability Harness
- Workflow Contract Tests
- E2E
- Failure Injection
- Resume Tests
- Ressourcenstress

**Ergebnis:** messbarer Abdeckungsnachweis

---

## Phase 7 – UI und täglicher Betrieb

- Workflow Inspector
- Fleet Inspector
- Coverage Dashboard
- Blocker-Ansicht
- Recovery-Aktionen
- verständliche Fortschrittsanzeige

**Ergebnis:** das System bleibt für dich kontrollierbar

---

# 12. Definition of Done für „vollständig abgedeckt“

Codee darf erst dann als workflow-vollständig gelten, wenn:

- [ ] alle Usecases im Register stehen
- [ ] jeder Usecase genau einem oder mehreren definierten Workflows zugeordnet ist
- [ ] alle Workflow-Phasen erreichbar und getestet sind
- [ ] jede Phase eine zulässige Agentenrolle besitzt
- [ ] jede Rolle auf mindestens ein zertifiziertes Modell abbildet
- [ ] jede benötigte Capability verifiziert ist
- [ ] jedes Tool typisiert und sicherheitsklassifiziert ist
- [ ] Datei- und Terminaloperationen geschützt sind
- [ ] Multi-Agent-Schreibkonflikte verhindert werden
- [ ] Langläufer pausiert und wiederaufgenommen werden können
- [ ] Kontextvollständigkeit geprüft wird
- [ ] Ergebnisse schema- und fachlich validiert werden
- [ ] Happy Path, Failure Path, Cancel und Resume getestet sind
- [ ] Model Crash, Backend-Ausfall und RAM-Druck beherrscht werden
- [ ] Coverage-Matrix automatisch erzeugt wird
- [ ] `pnpm coverage:usecases` grün ist
- [ ] alle kritischen Usecases den Status `CERTIFIED` tragen
- [ ] kein kritischer Usecase `PARTIAL`, `BLOCKED` oder `REGRESSED` ist

---

# 13. Priorisierte Sofortmaßnahmen

## P0

1. Usecase Registry und Coverage-Matrix erstellen.
2. Rollen-Mapping zwischen Workflow, Settings und Model Fleet festschreiben.
3. `orchestrator`, `researcher`, `docs` und `tool_worker` ergänzen.
4. Workflow-Zustand persistent und resumierbar machen.
5. Modellzertifikate vor Routing erzwingen.
6. Datei-Ownership und Baseline-Hash vor Agentenänderungen einführen.
7. Golden Scenarios für die 18 wichtigsten End-to-End-Ketten anlegen.
8. Coverage Gate implementieren.

## P1

1. Model Lab und Runtime vollständig synchronisieren.
2. Slot- und Residency-Policy operationalisieren.
3. Context Pack Coverage Check.
4. Execution Journal.
5. Workflow- und Fleet-Inspector.
6. Failure-Injection-Tests.
7. Cache- und Schema-Versionierung.

## P2

1. Qualitätsmetriken langfristig aus echten Codee-Läufen ableiten.
2. Rollen- und Modellzuweisung automatisch anhand deiner Hardware optimieren.
3. Workflow-Vorlagen aus erfolgreichen Läufen erzeugen.
4. Regressionen über historische Golden Runs erkennen.

---

# 14. Abschließende Bewertung

Die vorhandene Grundlage ist bereits stark:

- kanonische Workflow-Arten und Phasen
- zentraler Model Selection Broker
- Model-Fleet-Rollen
- Safety Levels
- Zertifizierungstypen
- Residency Intent
- Probe-, Benchmark- und Readiness-Daten
- Coding-, Review-, Test- und Maintenance-Grundworkflows

Die größte verbleibende Lücke ist nicht das Fehlen einzelner Funktionen. Es fehlt der **durchgängige, maschinenprüfbare Zusammenhang** zwischen:

```text
Usecase
→ Intent
→ Workflow
→ Agentenrolle
→ Modellrolle
→ Fleet-Rolle
→ Zertifizierung
→ Toolprofil
→ Safety Policy
→ Ausführung
→ Verifikation
→ Coverage-Nachweis
```

Genau dieser Zusammenhang muss als Vertrag, Engine und Testsuite umgesetzt werden. Danach kann Codee für den definierten persönlichen Einsatzbereich nicht nur behaupten, die Workflows abzudecken, sondern es bei jedem Build selbst nachweisen.
