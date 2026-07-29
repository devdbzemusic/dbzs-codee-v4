# DBZS Codee V4 – Konsolidierter Plan: Model Control Center, Multimodal-Erkennung und MMProj-Routing

## Ziel

Die bisherigen Pläne werden zu einer technisch konsistenten Erweiterung des aktuellen Codee-Standes zusammengeführt.

Der äußere Integrationsvertrag bleibt unverändert:

```tsx
runtime={<RuntimeModelsTab />}
```

## 1. Aktueller Code-Stand

Codee besitzt bereits:

- `RuntimeModelsTab`
- `modelIndexStore`
- `runtimeStore`
- `modelSelectionBroker`
- Vision-Grundlagen wie `hasImageInput`, `requiresVision`, `supportsVision`, `supportsTextOnly` und `requiresVisionProjector`
- den Slot `utility` für Embedding, Reranking und Indexing

Der Backend-Index erkennt aktuell:

```text
mmproj → artifact_type = "mmproj"
mmproj → modality = ["image"]
mmproj → compatibility = "support_artifact"
```

Problematisch ist, dass MMProj-Dateien trotzdem in derselben Modellliste auftauchen und Vision-Fähigkeiten überwiegend aus Dateinamen abgeleitet werden.

## 2. Zentrale Regel

Ein `mmproj-*.gguf` ist kein eigenständig startbares Chat-, Coding- oder Visionmodell.

Es ist ein Sidecar für ein kompatibles multimodales Basismodell.

Aufruf:

```powershell
llama-server.exe `
  --model "D:\Models\VisionModel-Q4_K_M.gguf" `
  --mmproj "D:\Models\mmproj-VisionModel-F16.gguf"
```

Daher:

```text
MMProj allein
→ indexieren
→ Metadaten lesen
→ als ORPHAN_SUPPORT_ARTIFACT markieren
→ nicht routen
→ nicht starten
```

```text
MMProj + kompatibles Basismodell
→ Paar bilden
→ Runtime-Probe
→ als MULTIMODAL_RUNTIME_PROFILE freigeben
```

## 3. Können alleinstehende MMProj-Dateien einzeln genutzt werden?

Praktisch nein.

Sie können ohne passendes Basismodell keine vollständige Antwort generieren.

Codee kann bei einem alleinstehenden MMProj nur:

- GGUF-Metadaten lesen
- Projector-Familie erkennen
- Embedding-Dimensionen prüfen
- mögliche Basismodelle suchen
- Kandidaten paaren
- eine Runtime-Probe ausführen

Erst nach erfolgreicher Paarung darf Routing erlaubt werden.

## 4. Erkennung vorhandener multimodaler Modelle

Scanbereiche bleiben die konfigurierten lokalen Modellpfade, typischerweise:

```text
D:\Models
F:\Models
H:\Models
C:\dev\prj\models\gguf
```

Jede GGUF-Datei wird klassifiziert:

```ts
type ModelArtifactClass =
  | "base_model"
  | "multimodal_base_model"
  | "vision_projector"
  | "audio_projector"
  | "embedding_model"
  | "reranker_model"
  | "lora_adapter"
  | "diffusion_model"
  | "unknown_support_artifact";
```

Harte Regel:

```text
Dateiname enthält mmproj
ODER GGUF-Metadaten weisen auf Projector hin
→ niemals base_model
```

## 5. Erkennungsstufen

### A – Dateisystem

- `mmproj-*.gguf`
- `*mmproj*.gguf`
- Basismodell und Projector im selben Ordner
- Unterordner enthält genau ein Basismodell und ein MMProj

Status:

```text
DISCOVERED
```

### B – GGUF-Metadaten

Benötigte Metadaten, soweit vorhanden:

```text
general.architecture
general.name
general.basename
general.finetune
general.size_label
clip.projector_type
clip.has_vision_encoder
clip.has_audio_encoder
embedding_length / n_embd
modellfamilienbezogene Keys
```

Status:

```text
METADATA_CLASSIFIED
```

### C – Kandidatenpaarung

Reihenfolge:

1. explizite Zuordnung aus `models.catalog.json`
2. gespeicherte manuelle Zuordnung
3. gleicher Ordner und eindeutiges Basismodell
4. passender `general.basename`
5. passende Modellfamilie
6. normalisierter Dateiname
7. kompatible Architektur und Embedding-Dimension
8. Runtime-Probe

Keine automatische Paarung bei Mehrdeutigkeit.

### D – Runtime-Probe

```powershell
llama-server.exe `
  --model "<base-model>" `
  --mmproj "<projector>" `
  --host 127.0.0.1 `
  --port <temporary-port> `
  --ctx-size 2048 `
  --parallel 1
```

Prüfen:

- Prozess startet
- kein Dimensions-Mismatch
- Healthcheck erfolgreich
- `/v1/models` meldet multimodal
- echter Bild-Prompt funktioniert

Status:

```text
PAIR_VERIFIED
```

## 6. Paarung im selben Ordner

Beispiel:

```text
D:\Models\Gemma3\
├── gemma-3-4b-it-Q4_K_M.gguf
└── mmproj-gemma-3-4b-it-f16.gguf
```

Bei genau einem Basismodell und einem MMProj entsteht ein starker Kandidat.

Bei mehreren Quantisierungen desselben Basismodells darf dasselbe MMProj mehrere Kandidatenprofile bilden. Jedes Paar wird separat geprüft.

Bei mehreren unterschiedlichen Basismodellen ohne eindeutige Metadaten:

```text
AMBIGUOUS
routingAllowed: false
```

## 7. Datenmodell

Bestehender `IndexedModel` bleibt kompatibel.

Additiv:

```ts
interface ModelArtifact {
  id: string;
  path: string;
  fileName: string;
  artifactClass:
    | "base_model"
    | "multimodal_base_model"
    | "vision_projector"
    | "audio_projector"
    | "lora_adapter"
    | "unknown_support_artifact";
  standaloneRunnable: boolean;
  metadataStatus: "unread" | "partial" | "complete" | "failed";
  metadata: Record<string, unknown>;
}

interface MultimodalPair {
  id: string;
  baseModelId: string;
  projectorArtifactId: string;
  modalities: Array<"text" | "image" | "audio">;
  pairingSource:
    | "catalog"
    | "manual"
    | "same_folder"
    | "metadata"
    | "filename"
    | "runtime_probe";
  confidence: number;
  status:
    | "candidate"
    | "ambiguous"
    | "verified"
    | "incompatible"
    | "missing_base"
    | "missing_projector";
  routingAllowed: boolean;
}
```

## 8. Modelindex-Ausgabe

```text
index.models
→ nur eigenständig startbare Modelle

index.supportArtifacts
→ MMProj, LoRA, Adapter, Tokenizer-Sidecars

index.multimodalPairs
→ verknüpfte Basismodell-Projector-Paare
```

Während der Migration muss `isRunnableModel()` MMProj weiterhin blockieren.

## 9. Utility-Rolle

`UTILITY` verwaltet:

### Startbare Utility-Modelle

- Embedding
- Reranker
- OCR
- ASR
- Klassifikatoren

### Nicht startbare Runtime-Artefakte

- MMProj
- LoRA
- Tokenizer
- Chat-Templates

Wichtig:

```text
UTILITY verwaltet das Artefakt.
Das multimodale Paar läuft in quality_cpu oder fast_gpu.
```

## 10. Verhalten beim App-Start

Beim Start:

```text
1. Modelindex laden
2. GGUF-Dateien klassifizieren
3. MMProj separat erfassen
4. Kandidatenpaare im selben Ordner bilden
5. gespeicherte Paarungen validieren
6. Pfade und Header prüfen
7. Status anzeigen
```

Nicht beim Start:

```text
keine Modellgewichte laden
keine Vision-Runtime dauerhaft starten
keine Benchmarks automatisch ausführen
keine mehrdeutigen Paare freigeben
```

## 11. Laden bei Verwendung

### Textanfrage

```text
kein Bild
→ normales Rollenmodell
→ kein MMProj
```

### Bild-Chat

```text
Bild vorhanden
→ verifiziertes multimodales Paar
→ Basismodell + MMProj starten
→ direkte Antwort möglich
```

### Coding mit Screenshot

Empfohlene erste Produktionsstufe:

```text
Screenshot
→ multimodales Paar analysiert Bild
→ Vision Context Pack
→ zertifiziertes Coding-Modell implementiert
```

### Review mit Screenshot

```text
Visionmodell erzeugt visuelle Findings
→ Reviewmodell gleicht sie mit dem Sourcecode ab
```

Ein Visionmodell darf nur direkt coden, wenn zusätzlich verifiziert:

```text
code_generation
code_review
structured_output
instruction_following
tool_calling
```

## 12. Runtime-Startprofil

Bestehend:

```ts
startModel(modelId)
```

bleibt erhalten.

Additiv:

```ts
interface RuntimeLaunchProfile {
  modelId: string;
  slotId: RuntimeSlotId;
  modality: "text" | "image" | "audio";
  mmprojPath?: string;
  mmprojOffload: boolean;
  contextSize: number;
  gpuLayers: number;
  imageMaxTokens?: number;
  idleTimeoutSeconds: number;
}
```

Intern:

```ts
startRuntimeProfile(profile)
```

## 13. Runtime Tab als Model Control Center

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

### Multimodale Paare

- Basismodell
- MMProj
- Ordner
- Paarungsquelle
- Confidence
- Runtime-Probe
- Modalitäten
- Text-only möglich
- Routingfreigabe

### Hilfsartefakte

- Datei
- Typ
- zugeordnetes Modell
- Status
- allein nutzbar
- Grund

Für MMProj:

```text
allein nutzbar: nein
Status: zugeordnet / orphan / ambiguous / incompatible
```

## 14. Orphan-MMProj-Regeln

Ein alleinstehendes MMProj wird nicht gelöscht oder unsichtbar gemacht.

Status:

```text
ORPHAN_PROJECTOR
```

Mögliche Gründe:

- Basismodell fehlt
- Basismodell liegt in anderem Ordner
- Name unbekannt
- mehrere Kandidaten
- Metadaten unvollständig
- Runtime unterstützt Familie nicht

Routing bleibt gesperrt.

## 15. Woher weiß Codee, was ein MMProj kann?

Verlässliche Quellen:

1. GGUF-Metadaten
2. lokales Modellmanifest
3. explizite `models.catalog.json`-Zuordnung
4. bekannte llama.cpp-Modellfamilie
5. Runtime-Probe
6. manuelle Zuordnung

Nicht ausreichend:

- nur Dateiname
- nur Dateigröße
- nur gleicher Ordner
- nur das Wort `vision`
- nur `.gguf`

Die nutzbare Fähigkeit ergibt sich aus:

```text
Projector
+ kompatibles Basismodell
+ Chat-Template
+ Runtime-Unterstützung
+ erfolgreicher Medientest
```

## 16. Implementierungsphasen

### Phase 1 – Index-Härtung

- MMProj als nicht startbares Support-Artefakt erzwingen
- `supportArtifacts`
- Orphan-Status
- Regressionstest: MMProj nie startbar

### Phase 2 – Paarung

- Same-Folder-Erkennung
- Namensnormalisierung
- Metadatenvergleich
- `multimodalPairs`
- keine Freigabe bei Mehrdeutigkeit

### Phase 3 – Runtime-Probe

- temporärer Start
- Healthcheck
- `/v1/models`
- echter Bildtest
- Fehler speichern

### Phase 4 – Runtime Tab

- Multimodale Paare
- Hilfsartefakte
- manuelle Zuordnung
- Diagnose

### Phase 5 – Routing

- Bildinput an Broker
- Vision Context Pack
- Chat-, Coding-, Review- und Debug-Pipelines
- nur verifizierte Paare

### Phase 6 – Capability-Zertifizierung

- Vision
- OCR
- UI-Analyse
- Diagramme
- Coding mit Bild
- Audio später separat

## 17. Pflicht-Regressionstests

```text
MMProj wird als support_artifact erkannt
MMProj ist nicht startbar
MMProj wird nicht als primaryCodingModel gewählt
MMProj wird nicht als Chatmodell gewählt
Orphan-MMProj bleibt sichtbar
eindeutiges Same-Folder-Paar wird Kandidat
mehrdeutiges Paar wird nicht freigegeben
falscher Projector wird incompatible
erfolgreiche Probe wird verified
Textanfrage startet kein MMProj
Bildanfrage lädt Basismodell + MMProj
startModel(modelId) bleibt kompatibel
Mission Control und Runtime Chat brechen nicht
```

## 18. Produktionsreife

Für Ralles System:

```text
maximal eine schwere Runtime gleichzeitig
Vision lazy laden
Idle-Unload nach 120–300 Sekunden
Projector-Offload konfigurierbar
Bildgröße und Bildtokens begrenzen
keine automatische Cloud-Verarbeitung
```

Erster produktiver MM-Workflow:

```text
Screenshot
→ Vision Context Pack
→ Coding-/Review-Modell
→ Diff
→ Approval
```

## 19. Umsetzungsauftrag

Implementiere zunächst nur Phase 1 und Phase 2.

Pflicht:

1. Öffentliche Contracts nicht entfernen oder umbenennen.
2. `RuntimeModelsTab` und Notebook-Integration unverändert lassen.
3. `IndexedModel` kompatibel halten.
4. MMProj niemals eigenständig startbar behandeln.
5. MMProj separat als Support-Artefakt erfassen.
6. Orphan-, Ambiguous- und Candidate-Status einführen.
7. Same-Folder-Paarung implementieren.
8. Dateinamenheuristik nur als Confidence-Signal verwenden.
9. Keine Runtime-Probe beim App-Start.
10. Kein automatisches MM-Routing aktivieren.
11. Tests ergänzen.
12. Keine Build- oder Cache-Artefakte committen.

## Schlussformel

```text
Der Modelindex findet Dateien.
Die Artefaktklassifikation trennt Modelle von Zubehör.
Die Paarungslogik verbindet Basismodell und MMProj.
Die Runtime-Probe beweist Kompatibilität.
Die Capability Engine beweist den Nutzen.
Erst dann darf das Routing das multimodale Paar verwenden.
```
