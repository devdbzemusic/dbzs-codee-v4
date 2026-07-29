# DBZS Codee V4 – Runtime Tab als Model Control Center

## Ziel

Der vorhandene Runtime-Tab im Tabbed Notebook wird zu einem zentralen **Model Control Center** umgebaut.

Er soll künftig folgende Aufgaben bündeln:

- Modelindex
- Modellscan
- Runtime-Erkennung
- Capability-Erkennung
- Capability-Verifikation
- Modellprofile
- Rollen und Routing
- Benchmarking
- Zertifizierung
- Runtime-Start und Runtime-Stopp
- Hardware-Eignung
- Default- und Fallback-Modelle
- Diagnose und Reparatur

Der Umbau darf bestehende Funktionen von Codee nicht brechen.

---

## Aktueller Integrationspunkt

Der vorhandene Tab ist bereits gekapselt:

```tsx
runtime={<RuntimeModelsTab />}
```

Dateien:

```text
apps/desktop/src/App.tsx
apps/desktop/src/components/notebook/RuntimeModelsTab.tsx
apps/desktop/src/stores/modelIndexStore.ts
apps/desktop/src/stores/runtimeStore.ts
apps/desktop/src/stores/settingsStore.ts
```

Die aktuelle Komponente verwendet bereits:

```text
useModelIndexStore
useRuntimeStore
useSettingsStore
```

Diese Stores und ihre öffentlichen Methoden bleiben kompatibel.

---

## Zentrale Regel

Der Umbau ist zunächst eine **additive UI- und Domain-Erweiterung**.

Nicht erlaubt:

- bestehende Store-Methoden umbenennen
- bestehende Runtime-Endpunkte entfernen
- `RuntimeModelsTab` aus `OperationsNotebook` herauslösen
- Runtime-Chat direkt an neue UI-Komponenten koppeln
- bestehende Modell-IDs verändern
- `IndexedModel` ohne kompatible Migration ersetzen
- automatische Cloud-Fallbacks einbauen
- ungeprüfte Capability-Tags als Wahrheit speichern

Bestehende Aufrufer müssen weiterhin funktionieren:

```ts
loadModelIndex()
startModel(modelId)
stopModel()
runtimeStatus
modelIndex
primaryCodingModel
```

---

# Gewünschte Oberfläche

## Hauptstruktur

Der Runtime-Tab erhält eine interne Unterteilung:

```text
Runtime
├── Übersicht
├── Modelle
├── Fähigkeiten
├── Rollen & Routing
├── Benchmarks
├── Runtimes
└── Diagnose
```

Diese Unterseiten werden innerhalb von `RuntimeModelsTab` dargestellt.

Der äußere Notebook-Tab bleibt unverändert.

---

## 1. Übersicht

Zeigt den Gesamtzustand:

```text
Modelle gefunden
Modelle startbereit
Modelle geprüft
Modelle zertifiziert
Modelle mit Warnungen
aktive Runtime
aktive Modellrolle
Modelindex zuletzt aktualisiert
Capability-Stand zuletzt aktualisiert
```

Statuskarten:

- Modellindex
- llama.cpp Runtime
- aktives Modell
- Hardwareprofil
- Capability Engine
- Routing
- letzte Fehler

Schnellaktionen:

- Modelle scannen
- Index aktualisieren
- ungeprüfte Modelle testen
- aktive Runtime stoppen
- Diagnosedaten exportieren

---

## 2. Modelle

Erweitert die vorhandene Modelltabelle.

Spalten:

```text
Status
Modell
Format
Architektur
Quantisierung
Größe
Runtime
Kompatibilität
Verifikationsstatus
Rolle
Confidence
Aktionen
```

Aktionen:

- Details
- Laden
- Stoppen
- Testen
- Neu prüfen
- Profil bearbeiten
- deaktivieren
- Diagnose öffnen

Filter:

- Format
- Runtime
- Rolle
- Capability
- Verifikationsstatus
- startbar
- fehlerhaft
- unbekannt

Suche nach:

- Name
- Modell-ID
- Pfad
- Architektur
- Rolle

---

## 3. Fähigkeiten

Capabilities dürfen nicht nur aus Dateinamen oder Modellfamilien abgeleitet werden.

Capability-Tabelle:

```text
Capability
Confidence
Quelle
letzter Test
Teststatus
Routing erlaubt
```

Vorgesehene Capabilities:

```text
chat
instruction_following
code_generation
code_review
debugging
reasoning
planning
tool_calling
structured_output
json_output
long_context
summarization
translation
documentation
vision
embedding
reranking
audio
```

Beweisquellen:

```text
metadata
model_family_profile
chat_template
runtime_probe
benchmark
manual_override
repeated_verification
```

Status:

```text
unknown
inferred
runtime_verified
benchmark_verified
certified
failed
disabled
```

---

## 4. Rollen und Routing

Rollen:

```text
FAST
CHAT
INSTRUCT
CODE
REVIEW
DEBUG
REASONING
PLANNER
DOCS
TRANSLATE
TOOL_ROUTER
VISION
EMBEDDING
RERANKER
```

Für jede Rolle:

- Primärmodell
- Fallback-Modell
- Mindest-Confidence
- Runtime
- maximale Kontextgröße
- erlaubte Quantisierungen
- Hardwaregrenze
- automatischer Start erlaubt
- Cloud-Fallback erlaubt

Standard für Ralles persönlichen Betrieb:

```text
Local-First: aktiv
Cloud-Fallback: aus
Ollama-Fallback: aus
Runtime: llama.cpp
Discovery Mode: project_local_strict
```

---

## 5. Benchmarks

Jeder Testlauf erzeugt ein reproduzierbares Ergebnis.

Testgruppen:

```text
Startfähigkeit
Prompt-Verständnis
Chat
Code
Review
Debugging
Reasoning
JSON
Tool Calling
Kontexttreue
Geschwindigkeit
Speicherbedarf
Stabilität
```

Messwerte:

```text
load_time_ms
first_token_ms
tokens_per_second
peak_ram_mb
estimated_vram_mb
context_tested
success_rate
format_compliance
crash_count
timeout_count
```

Keine einzelne Testantwort darf automatisch zur Zertifizierung führen.

Mindestregel:

```text
mindestens 3 reproduzierbare Testläufe
keine Runtime-Abstürze
Mindestscore je Capability
gültige strukturierte Ausgabe
```

---

## 6. Runtimes

Anzeige:

```text
llama.cpp Pfad
llama-server Pfad
Version
Architektur
Backend
GPU-Offload
Port
aktive PID
aktives Modell
Startzeit
Health
```

Aktionen:

- Runtime suchen
- Runtime prüfen
- Runtime starten
- Runtime stoppen
- Runtime neu starten
- Pfad korrigieren
- Logs öffnen

Wichtig:

Der bereits implementierte Live-Discovery-Fallback für veraltete `runtime_dir`-Einträge bleibt erhalten.

---

## 7. Diagnose

Diagnosepunkte:

- Modellpfad existiert
- Runtimepfad existiert
- Modellformat lesbar
- GGUF-Metadaten lesbar
- Chat-Template vorhanden
- Runtime startbar
- Port frei
- Modell ladbar
- Probe-Prompt erfolgreich
- Capability-Daten aktuell
- Routing konsistent

Diagnoseexport:

```text
runtime-diagnostics.json
model-index-diagnostics.json
capability-report.md
```

Keine Secrets, `.env`-Inhalte oder vollständigen privaten Prompts exportieren.

---

# Domain-Modell

## Bestehenden IndexedModel-Typ nicht brechen

Die existierenden Felder bleiben erhalten.

Neue Daten werden zunächst separat gespeichert:

```ts
interface ModelCapabilityProfile {
  modelId: string;
  schemaVersion: 1;
  status:
    | "unknown"
    | "inferred"
    | "runtime_verified"
    | "benchmark_verified"
    | "certified"
    | "failed"
    | "disabled";
  capabilities: CapabilityEvidence[];
  recommendedRoles: ModelRole[];
  primaryRole: ModelRole | null;
  routingAllowed: boolean;
  lastVerifiedAt: string | null;
  verificationVersion: string;
}

interface CapabilityEvidence {
  capability: ModelCapability;
  confidence: number;
  source:
    | "metadata"
    | "model_family_profile"
    | "chat_template"
    | "runtime_probe"
    | "benchmark"
    | "manual_override"
    | "repeated_verification";
  score: number | null;
  testRuns: number;
  passedRuns: number;
  lastTestedAt: string | null;
  notes: string[];
}
```

Verknüpfung ausschließlich über:

```text
IndexedModel.id == ModelCapabilityProfile.modelId
```

---

# Persistenz

Empfohlene Dateien:

```text
models.catalog.json
models.runtime.json
models.capabilities.json
models.routing.json
models.benchmarks.json
```

Alternativ später SQLite.

Zunächst versionierte JSON-Schemas verwenden, damit Migration und Diagnose einfach bleiben.

Keine Modellgewichte duplizieren.

---

# Store-Aufteilung

Bestehende Stores bleiben bestehen:

```text
modelIndexStore
runtimeStore
settingsStore
```

Neue Stores:

```text
modelCapabilityStore
modelRoutingStore
modelBenchmarkStore
runtimeDiagnosticsStore
```

Regel:

- `modelIndexStore`: Erkennung und Basisdaten
- `runtimeStore`: laufender Prozess
- `modelCapabilityStore`: Fähigkeiten und Evidence
- `modelRoutingStore`: Rollen und Auswahl
- `modelBenchmarkStore`: Testläufe
- `runtimeDiagnosticsStore`: Diagnose

Keine God-Store-Erweiterung.

---

# Komponentenstruktur

```text
apps/desktop/src/components/notebook/runtime/
├── RuntimeControlCenter.tsx
├── RuntimeOverviewPanel.tsx
├── ModelInventoryPanel.tsx
├── ModelDetailsDrawer.tsx
├── CapabilityMatrixPanel.tsx
├── ModelRoutingPanel.tsx
├── ModelBenchmarkPanel.tsx
├── RuntimeManagerPanel.tsx
├── RuntimeDiagnosticsPanel.tsx
├── RuntimeTabNavigation.tsx
└── runtimeViewTypes.ts
```

`RuntimeModelsTab.tsx` bleibt als kompatibler Adapter:

```tsx
export function RuntimeModelsTab() {
  return <RuntimeControlCenter />;
}
```

Damit bleibt die Einbindung in `App.tsx` unverändert.

---

# Backend-Erweiterung

Neue Endpunkte nur additiv ergänzen:

```text
GET  /models/index
POST /models/scan
GET  /models/{id}/capabilities
POST /models/{id}/probe
POST /models/{id}/benchmark
POST /models/{id}/certify
GET  /models/routing
PUT  /models/routing
GET  /runtime/diagnostics
```

Bestehende Runtime-Endpunkte nicht verändern.

---

# Capability-Verifikation

## Stufe 1 – statische Erkennung

- Dateiformat
- Architektur
- Quantisierung
- Kontextlänge
- Chat-Template
- Tokenizer
- Multimodal-Metadaten

Ergebnis:

```text
inferred
```

## Stufe 2 – Runtime Probe

- Modell startet
- Healthcheck erfolgreich
- Probe-Prompt beantwortet
- strukturierte Antwort möglich

Ergebnis:

```text
runtime_verified
```

## Stufe 3 – Capability Benchmark

Mehrere spezialisierte Tests je Capability.

Ergebnis:

```text
benchmark_verified
```

## Stufe 4 – Zertifizierung

Nur bei:

- mindestens drei erfolgreichen Läufen
- Score über Grenzwert
- keine Abstürze
- reproduzierbare Ergebnisse
- kompatible Runtime
- gültiges Modellprofil

Ergebnis:

```text
certified
routingAllowed: true
```

---

# Migrationsphasen

## Phase 1 – UI-Gerüst

- RuntimeModelsTab als Adapter behalten
- interne Navigation hinzufügen
- bestehende Tabelle in `ModelInventoryPanel` verschieben
- keinerlei Backend- oder Store-Verträge ändern

Abnahme:

```text
pnpm typecheck
gezielte RuntimeModelsTab-Tests
bestehender Modellstart funktioniert
bestehender Modellstopp funktioniert
```

## Phase 2 – Capability-Datenmodell

- Shared Contracts ergänzen
- neuer Capability Store
- JSON-Persistenz
- statische Capability-Erkennung

Noch kein automatisches Routing ändern.

## Phase 3 – Runtime Probe

- Start- und Probe-Tests
- Evidence speichern
- Fehler klar anzeigen
- bestehende Runtime-Startlogik wiederverwenden

## Phase 4 – Benchmark Engine

- reproduzierbare Testsets
- Performancewerte
- Capability Scores
- Testhistorie

## Phase 5 – Routing

- Rollenprofile
- Primär- und Fallbackmodelle
- Mindest-Confidence
- Routing zunächst nur als Empfehlung

Erst nach Tests darf automatisches Routing aktiviert werden.

## Phase 6 – Personal Stable Integration

- alle UI-Flows testen
- Backup der Modellprofile
- Recovery
- Diagnosedaten
- Golden Path

---

# Pflicht-Tests

## Regression

- bestehender Modelindex lädt
- vorhandene Modelle werden identisch angezeigt
- Start und Stopp funktionieren
- aktives Modell wird korrekt markiert
- Runtime Chat kann weiterhin Modelle verwenden
- Mission Control erhält weiterhin dieselben Summary-Daten
- Settings und Backend Health funktionieren
- App-Start wird nicht langsamer
- kein Modell wird beim Öffnen des Tabs automatisch gestartet

## Neue Tests

- Capability-Profil ohne Indexeintrag
- Indexeintrag ohne Capability-Profil
- veralteter Runtimepfad
- fehlendes Modell
- nicht startbares Format
- Benchmark-Timeout
- Runtime-Crash
- ungültige JSON-Persistenz
- Schema-Migration
- manuelles Capability-Override
- deaktiviertes Modell
- Routing ohne zertifiziertes Modell

---

# Auftrag für Codex / Cursor / Codee

## Prompt

Analysiere zuerst den aktuellen Stand von `devdbzemusic/dbzs-codee-v4`.

Baue den bestehenden Runtime-Tab im Tabbed Notebook zu einem modularen Model Control Center um.

Arbeite strikt migrationssicher und additiv.

Der äußere Integrationsvertrag bleibt unverändert:

```tsx
runtime={<RuntimeModelsTab />}
```

`RuntimeModelsTab.tsx` bleibt als kompatibler Adapter bestehen.

Bestehende öffentliche Store-Funktionen und Runtime-Aufrufe dürfen nicht umbenannt oder entfernt werden:

```ts
loadModelIndex()
startModel(modelId)
stopModel()
runtimeStatus
modelIndex
primaryCodingModel
```

Implementiere zunächst ausschließlich Phase 1:

1. Erzeuge `apps/desktop/src/components/notebook/runtime/`.
2. Erzeuge `RuntimeControlCenter.tsx`.
3. Erzeuge eine interne Navigation mit:
   - Übersicht
   - Modelle
   - Fähigkeiten
   - Rollen & Routing
   - Benchmarks
   - Runtimes
   - Diagnose
4. Verschiebe die existierende Modelltabelle ohne Funktionsänderung in `ModelInventoryPanel.tsx`.
5. Lass noch nicht implementierte Seiten ehrliche Empty States anzeigen.
6. Behalte alle existierenden Start-/Stopp-/Index-Funktionen.
7. Ändere keine Backend-Endpunkte.
8. Ändere keine Shared Contracts.
9. Ändere kein automatisches Modellrouting.
10. Ergänze Regressionstests für die bestehende Funktionalität.

Führe danach aus:

```powershell
pnpm --filter @dbzs/desktop exec tsc --noEmit -p tsconfig.web.json
pnpm --filter @dbzs/desktop exec vitest run
pnpm --filter @dbzs/desktop build
```

Dokumentiere:

- geänderte Dateien
- erhaltene Verträge
- Testresultate
- offene Punkte für Phase 2
- ehrlichen Status `REAL`, `PARTIAL`, `MOCK` oder `BLOCKED`

Keine generierten Dateien unter `.cache`, `dist`, `out`, `test-results` oder `playwright-report` committen.

---

# Produktionsreife

Diese Umgestaltung verbessert die Produktionsreife, weil:

- der Modelindex eine klare Oberfläche erhält
- Capability-Daten von Runtime-Daten getrennt werden
- Tests und Evidenz nachvollziehbar bleiben
- Modellrouting nicht auf Vermutungen basiert
- bestehende Runtime- und Chat-Funktionen kompatibel bleiben
- neue Funktionen schrittweise aktiviert werden können

Die entscheidende Regel lautet:

> Der Modelindex beschreibt das Modell.  
> Die Capability Engine beweist seine Fähigkeiten.  
> Das Routing verwendet nur ausreichend verifizierte Ergebnisse.
