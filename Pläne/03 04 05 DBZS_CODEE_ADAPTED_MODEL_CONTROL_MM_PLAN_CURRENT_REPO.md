# DBZS Codee V4 – Angepasster Plan für Model Control Center, MMProj und Capability-Verifikation

**Stand:** 2026-07-28  
**Geprüfter Repository-Stand:** `4e1bb521878d614c493919f23e850ee85766e4fc`  
**Repository:** `devdbzemusic/dbzs-codee-v4`

---

## 1. Ergebnis des erneuten Repo-Checks

Der bisherige Plan bleibt grundsätzlich richtig, muss aber an den tatsächlichen aktuellen Code angepasst werden.

### Bereits vorhanden

- `RuntimeModelsTab` ist weiterhin der bestehende Runtime-Notebook-Tab.
- `modelIndexStore` und `runtimeStore` sind die aktiven Verträge.
- Der Modellindex scannt rekursiv lokale `*.gguf`.
- Der Index erkennt `mmproj` bereits als:
  - `artifact_type = "mmproj"`
  - `modality = ["image"]`
  - `compatibility = "support_artifact"`
- `modelSelectionBroker` kennt bereits Vision-Grundlagen:
  - `hasImageInput`
  - `requiresVision`
  - `supportsVision`
  - `supportsTextOnly`
  - `requiresVisionProjector`
- Der echte Rescan-Button wurde bereits mit **364 Modellen** über die UI verifiziert.
- Das fachliche Review-Routing zum Reviewer funktioniert inzwischen real.

### Noch nicht vorhanden

- kein `RuntimeControlCenter`
- keine interne Navigation im Runtime-Tab
- keine separate Liste für Support-Artefakte
- keine MMProj-Basismodell-Paarungslogik
- keine Runtime-Profile mit `--mmproj`
- keine echte multimodale Probe
- keine Capability-Zertifizierung
- kein verifiziertes multimodales Routing

---

## 2. Kritischer aktueller Fehlerpunkt

Die aktuelle Funktion lautet sinngemäß:

```ts
export function isRunnableModel(model: IndexedModel): boolean {
  return [
    "llama_server_ready",
    "llama_server_candidate",
    "ollama_ready"
  ].includes(model.compatibility);
}
```

Sie prüft nur `compatibility`.

Der Backend-Index setzt MMProj zwar auf:

```text
compatibility = support_artifact
```

Damit ist ein MMProj aktuell normalerweise nicht startbar. Diese Sicherheit hängt aber nur an einem indirekten Stringwert.

Das ist zu schwach.

### Notwendige Härtung

```ts
export function isRunnableModel(model: IndexedModel): boolean {
  if (["mmproj", "adapter", "lora"].includes(model.artifact_type)) {
    return false;
  }

  return [
    "llama_server_ready",
    "llama_server_candidate",
    "ollama_ready"
  ].includes(model.compatibility);
}
```

Zusätzlich sollte das Backend garantieren:

```text
artifact_type = mmproj
→ standalone_runnable = false
→ niemals primaryCodingModel
→ niemals Rollenmodell
→ niemals direkter Runtime-Start
```

---

## 3. Wichtige Korrektur zum alten Plan

Der alte Plan schlug relativ früh diese Aufteilung vor:

```text
index.models
index.supportArtifacts
index.multimodalPairs
```

Das bleibt das Ziel, darf aber nicht sofort als harter Schemaumbau umgesetzt werden.

Der aktuelle Code nutzt `index.models` an vielen Stellen. Eine sofortige Entfernung aller MMProj-Einträge aus dieser Liste könnte:

- Summary-Zahlen verändern
- Store-Selektoren brechen
- Mission Control beeinflussen
- Rollenwahl verändern
- Tests und gespeicherte Kataloge inkompatibel machen

### Migrationssichere Lösung

Zunächst additiv:

```ts
interface ModelIndex {
  // bestehend
  models: IndexedModel[];
  summary: ModelIndexSummary;

  // neu, additiv
  support_artifacts?: ModelSupportArtifact[];
  multimodal_pairs?: MultimodalPair[];
}
```

Während Phase 1 bleiben MMProj-Dateien aus Kompatibilitätsgründen noch in `models`, werden aber:

- ausdrücklich als nicht startbar markiert
- in der normalen Modelltabelle herausgefiltert oder als Zubehör dargestellt
- zusätzlich in `support_artifacts` projiziert

Erst später kann eine Schema-Version 2 die Trennung vollständig machen.

---

## 4. Klare Antwort zu alleinstehenden MMProj-Dateien

### Können MMProj-Dateien allein genutzt werden?

**Nein, nicht als vollständiges Chat-, Coding- oder Visionmodell.**

Ein MMProj ist ein Projector beziehungsweise Sidecar. Es wird zusammen mit einem kompatiblen Basismodell geladen:

```powershell
llama-server.exe `
  --model "D:\Models\VisionModel-Q4_K_M.gguf" `
  --mmproj "D:\Models\mmproj-VisionModel-F16.gguf"
```

Allein kann es:

- keine normalen Texte generieren
- keinen Chat beantworten
- nicht eigenständig coden
- keine vollständige multimodale Runtime darstellen

### Was kann Codee mit einem alleinstehenden MMProj tun?

- Datei finden
- GGUF-Header validieren
- Metadaten lesen
- Projector-Art bestimmen
- möglichen Basismodellpartner suchen
- manuelle Zuordnung erlauben
- Paarung später testen

Status:

```text
ORPHAN_PROJECTOR
standaloneRunnable: false
routingAllowed: false
```

---

## 5. Wie erkennt Codee vorhandene multimodale Modelle?

Der aktuelle Dateiscan kann weiterverwendet werden.

### Phase A – Artefaktklassifikation

Jede GGUF-Datei wird klassifiziert:

```ts
type ModelArtifactClass =
  | "text_base_model"
  | "multimodal_base_candidate"
  | "vision_projector"
  | "audio_projector"
  | "embedding_model"
  | "reranker_model"
  | "lora_adapter"
  | "diffusion_model"
  | "unknown";
```

Harte Regel:

```text
artifact_type == mmproj
→ vision_projector oder audio_projector
→ standaloneRunnable = false
```

### Phase B – Kandidatenerkennung

Ein Basismodell ist ein Multimodal-Kandidat, wenn mindestens eines zutrifft:

- Katalog sagt `supportsVision`
- Katalog enthält `vision`
- Modality enthält `image`
- Modellfamilie ist als multimodal bekannt
- Metadaten enthalten passende Architekturhinweise
- Dateiname enthält belastbare VL-/Vision-Muster

Dateiname allein erzeugt nur:

```text
confidence <= 0.40
status = inferred
```

### Phase C – Same-Folder-Suche

MMProj und Basismodell liegen häufig im selben Ordner.

Beispiel:

```text
D:\Models\Gemma3\
├── gemma-3-4b-it-Q4_K_M.gguf
└── mmproj-gemma-3-4b-it-f16.gguf
```

Regeln:

- genau ein Basismodell + genau ein MMProj:
  - hoher Paarungskandidat
- mehrere Quantisierungen derselben Modellfamilie:
  - mehrere Kandidatenprofile erlaubt
- mehrere verschiedene Modellfamilien:
  - `AMBIGUOUS`
- MMProj ohne Basismodell:
  - `ORPHAN_PROJECTOR`

---

## 6. Woher weiß Codee, was ein MMProj kann?

Nicht allein aus dem Dateinamen.

### Beweisquellen in Prioritätsreihenfolge

1. expliziter Eintrag in `models.catalog.json`
2. gespeicherte manuelle Zuordnung
3. GGUF-Metadaten
4. Modellfamilienprofil
5. gleicher Ordner
6. normalisierte Dateinamen
7. Runtime-Probe
8. erfolgreicher Bild- oder Audiotest

### Metadaten, soweit vorhanden

```text
general.architecture
general.name
general.basename
general.finetune
clip.projector_type
clip.has_vision_encoder
clip.has_audio_encoder
embedding_length
n_embd
familienabhängige Projector-Keys
```

Die genauen Keys können je llama.cpp-Version und Modellfamilie variieren. Deshalb muss der Metadatenleser tolerant sein und unbekannte Keys erhalten.

### Entscheidender Beweis

```text
Basismodell
+ MMProj
+ Runtime
+ Chat-Template
+ erfolgreicher Medientest
```

Erst dann:

```text
pairingStatus = verified
routingAllowed = true
```

---

## 7. Angepasstes Datenmodell

### Additive Support-Artefakte

```ts
interface ModelSupportArtifact {
  id: string;
  path: string;
  name: string;
  artifactType: "mmproj" | "lora" | "adapter" | "tokenizer" | "unknown";
  modality: Array<"image" | "audio">;
  standaloneRunnable: false;
  status:
    | "orphan"
    | "candidate"
    | "paired"
    | "ambiguous"
    | "incompatible";
  candidateModelIds: string[];
  pairedModelId?: string;
  confidence: number;
}
```

### Multimodale Paare

```ts
interface MultimodalPair {
  id: string;
  baseModelId: string;
  projectorArtifactId: string;
  modalities: Array<"text" | "image" | "audio">;
  source:
    | "catalog"
    | "manual"
    | "metadata"
    | "same_folder"
    | "filename"
    | "runtime_probe";
  confidence: number;
  status:
    | "candidate"
    | "ambiguous"
    | "verified"
    | "incompatible";
  routingAllowed: boolean;
  lastProbeAt?: string;
  probeError?: string;
}
```

---

## 8. Runtime-Tab als Model Control Center

Der äußere Vertrag bleibt:

```tsx
runtime={<RuntimeModelsTab />}
```

`RuntimeModelsTab` bleibt der kompatible Einstiegspunkt.

### Neue interne Bereiche

```text
Übersicht
Modelle
Multimodale Paare
Hilfsartefakte
Capabilities
Rollen & Routing
Benchmarks
Runtimes
Diagnose
```

### Migrationsregel

Phase 1 verschiebt noch nicht alle bestehenden Funktionen.

Zuerst:

```tsx
export function RuntimeModelsTab() {
  return <RuntimeControlCenter />;
}
```

`RuntimeControlCenter` nutzt weiterhin:

```text
useModelIndexStore
useRuntimeStore
useSettingsStore
```

Die bestehende Modelltabelle wird unverändert als `ModelInventoryPanel` übernommen.

---

## 9. Utility-Rolle im aktuellen Slot-System

Der aktuelle Broker reserviert `utility` für:

```text
embedding
reranking
indexing
```

Das soll nicht gebrochen werden.

### Angepasste Bedeutung

`UTILITY` verwaltet:

#### Eigenständig startbare Utility-Modelle

- Embedding
- Reranker
- OCR
- ASR
- Klassifikatoren

#### Nicht startbare Zubehörartefakte

- MMProj
- LoRA
- Adapter
- Tokenizer
- Chat-Templates

Wichtig:

```text
UTILITY besitzt und verwaltet das MMProj.
UTILITY startet das MMProj nicht allein.
```

Das multimodale Paar wird in einem bestehenden Ausführungsslot gestartet:

```text
quality_cpu
oder
fast_gpu
```

Ein neuer physischer `multimodal`-Slot ist zunächst nicht erforderlich.

---

## 10. Laden beim App-Start

Der bestehende Boot-Index unterstützt bereits einen inkrementellen Scan mit Fehlerisolation.

Das wird genutzt.

### Beim Start

```text
Index laden oder aus Cache wiederherstellen
→ Modellscan
→ Artefakte klassifizieren
→ Orphan-MMProj erkennen
→ Same-Folder-Kandidaten bilden
→ Pfade validieren
→ Status im Runtime-Tab anzeigen
```

### Nicht beim Start

- keine Modellgewichte laden
- kein MMProj in den Speicher laden
- keine Vision-Runtime starten
- keine aufwendigen Benchmarks
- keine automatischen Media-Prompts
- keine mehrdeutigen Paare freigeben

Das ist auf dem vorhandenen 4-GB-VRAM-System zwingend sinnvoll.

---

## 11. Runtime-Laden bei Verwendung

### Text

```text
Textanfrage
→ bestehendes Rollenrouting
→ normales Rollenmodell
→ kein MMProj
```

### Bild-Chat

```text
Bild erkannt
→ Broker setzt hasImageInput = true
→ verifiziertes Multimodal-Paar auswählen
→ Basismodell + MMProj gemeinsam starten
→ direkte Bildantwort
```

### Coding mit Screenshot

Erste produktive Version:

```text
Screenshot
→ Visionmodell erzeugt strukturierten Vision Context Pack
→ Coder-Modell verarbeitet den Context Pack
→ Diff
→ Approval
```

### Review mit Screenshot

```text
Visionmodell erzeugt UI-/Bild-Findings
→ Reviewer prüft sie gegen Sourcecode
```

Das multimodale Modell erhält zunächst keine direkten Schreibrechte.

---

## 12. Additives Runtime-Profil

Der bestehende Vertrag bleibt:

```ts
startModel(modelId)
```

Neu intern:

```ts
interface RuntimeLaunchProfile {
  modelId: string;
  slotId: RuntimeSlotId;
  modality: "text" | "image" | "audio";
  mmprojPath?: string;
  contextSize?: number;
  gpuLayers?: number;
  mmprojOffload?: boolean;
  idleTimeoutSeconds?: number;
}
```

Interner Start:

```ts
startRuntimeProfile(profile)
```

Bestehendes `startModel(modelId)` ruft ein Textprofil auf.

---

## 13. Neuer wichtiger Punkt aus dem aktuellen Repo

Der aktuelle Golden-Path wird nicht mehr primär durch Routing blockiert.

Das Review-Routing wurde real verifiziert.

Der neue Blocker ist:

```text
no_json_array
generation_failed
unzureichende strukturierte Modellausgabe
```

Betroffen waren:

- `gemma-3-1b-it-qat-q4-0`
- `qwen2.5-coder-7b-instruct`

Daraus folgt eine wichtige Erweiterung des Model Control Centers:

### Capability `structured_output_reliability`

Jedes Rollenmodell muss gesondert getestet werden auf:

```text
JSON-Array
JSON-Objekt
Schema-Einhaltung
maximale Antwortlänge
kein vorzeitiger Stop
keine Template-Fehler
Reproduzierbarkeit
```

### Neue Capability-Werte

```text
chat
code
review
planning
structured_output
json_array
json_object
tool_calling
vision
text_only
```

Ein Modell darf nicht als Reviewer oder Coder geroutet werden, nur weil im Dateinamen `coder` steht.

---

## 14. Prioritäten – angepasst

### P0 – Vor dem UI-Großumbau

1. `isRunnableModel()` gegen MMProj/Adapter/LoRA härten.
2. Rollenmodelle gegen Support-Artefakte absichern.
3. `no_json_array` und `generation_failed` diagnostizieren.
4. strukturierten Output als messbare Capability aufnehmen.
5. Modellwechsel-Absturz root-causen.

### P1 – Index und Pairing

1. `support_artifacts` additiv ergänzen.
2. Orphan-MMProj erfassen.
3. Same-Folder-Paarung.
4. Ambiguous-Status.
5. keine Runtime-Probe beim Start.

### P2 – Runtime Control Center UI

1. Adapterstruktur.
2. bestehende Modelltabelle migrieren.
3. Hilfsartefakte anzeigen.
4. multimodale Kandidaten anzeigen.
5. Diagnoseansicht.

### P3 – Runtime-Probe

1. Basismodell + MMProj temporär starten.
2. Healthcheck.
3. echter Media-Prompt.
4. Pairing verifizieren.
5. Fehler speichern.

### P4 – Multimodales Routing

1. Bildanhang.
2. Vision Context Pack.
3. Chat-Pipeline.
4. Coding-/Review-Pipeline.
5. Lazy Load und Idle Unload.

---

## 15. Konkreter nächster Implementierungsauftrag

Implementiere zunächst nur diesen sicheren Slice:

### Backend

- `ModelSupportArtifact` und `MultimodalPair` additiv zum Indexschema.
- MMProj-Einträge weiterhin kompatibel behandeln.
- MMProj immer `standaloneRunnable = false`.
- Same-Folder-Kandidaten erkennen.
- Orphan und Ambiguous unterscheiden.
- keine Runtime-Probe.
- keine automatische Paarungsfreigabe.

### Frontend

- `isRunnableModel()` gegen Artefakttypen härten.
- normale Tabelle zeigt MMProj nicht als startbares Modell.
- optional kleine Kennzeichnung:
  - `Zubehör`
  - `Orphan`
  - `Paarungskandidat`
- noch kein vollständiger Runtime-Control-Center-Umbau.

### Tests

```text
MMProj nicht startbar
Adapter nicht startbar
LoRA nicht startbar
MMProj nicht primaryCodingModel
MMProj nicht Rollenmodell
Orphan sichtbar
eindeutiges Same-Folder-Paar erkannt
mehrdeutiges Paar nicht freigegeben
bestehende 364-Modell-Indexierung bleibt stabil
bestehender Runtime-Start für Textmodelle bleibt stabil
```

---

## 16. Erst danach Runtime-Tab umbauen

Der große UI-Umbau sollte erst beginnen, wenn:

```text
Support-Artefakt-Contract stabil
Pairing-Daten verfügbar
Structured-Output-Capability definiert
Regressionstests grün
```

Sonst würde die UI um ein noch instabiles Datenmodell gebaut.

---

## 17. Produktionsreife

Für Codee ist jetzt besonders wichtig:

```text
Modelindex
→ findet und klassifiziert

Capability Engine
→ beweist Chat, Coding, Review, JSON und Vision

Pairing Engine
→ verbindet Basismodell und MMProj

Runtime Profile
→ lädt die richtige Kombination

Broker
→ routet nur verifizierte Modelle
```

Die wichtigste neue Erkenntnis aus dem aktuellen Repo lautet:

> Modellformat und Modellname reichen nicht.  
> Für Codee ist zuverlässiger strukturierter Output ebenso wichtig wie Vision- oder Coding-Fähigkeit.
