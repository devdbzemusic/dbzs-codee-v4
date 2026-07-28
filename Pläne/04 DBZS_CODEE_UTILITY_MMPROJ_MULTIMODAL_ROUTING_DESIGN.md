# DBZS Codee V4 – Utility Role, MMProj und multimodales Runtime-Routing

## Klare Architekturentscheidung

Die bestehende `UTILITY`-Rolle ist sinnvoll und soll beibehalten werden.

Sie darf jedoch nicht so interpretiert werden, dass eine `mmproj`-Datei als eigenständiges Modell in einem eigenen Runtime-Slot gestartet wird.

Ein `mmproj` ist ein **Vision Projector**. Er wird gemeinsam mit einem kompatiblen multimodalen Basismodell in derselben llama.cpp-Instanz geladen.

Beispiel:

```text
Vision-Basismodell:
Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf

zugehöriger Projector:
mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf
```

Runtime-Start:

```powershell
llama-server.exe ^
  --model "D:\Models\Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf" ^
  --mmproj "D:\Models\mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf"
```

Damit gilt:

```text
UTILITY verwaltet und liefert den Projector
MULTIMODAL startet Basismodell + Projector gemeinsam
```

---

# 1. Aktueller Stand

Der aktuelle Broker kennt bereits:

```text
hasImageInput
requiresVision
supportsTextOnly
requiresVisionProjector
supportsVision
```

Außerdem verhindert der Vision-Gate bereits, dass ein reines Visionmodell ohne Text-only-Unterstützung für normale Textanfragen verwendet wird.

Das ist eine gute Grundlage.

Der vorhandene `utility`-Slot ist aktuell für diese Aufgaben vorgesehen:

```text
embedding
reranking
indexing
```

Multimodale Ausführung ist noch nicht als eigener Slot oder Workflow modelliert.

---

# 2. Neue Bedeutung der Utility-Rolle

`UTILITY` sollte künftig zwei Arten von Hilfsmodellen und Artefakten verwalten.

## A. Eigenständig ausführbare Utility-Modelle

```text
Embedding-Modelle
Reranker
OCR-Spezialmodelle
ASR-Modelle
kleine Klassifikatoren
```

Diese können tatsächlich als eigene Runtime oder eigener Prozess laufen.

## B. Runtime-Zubehör

```text
mmproj
Tokenizer-Artefakte
Chat-Templates
Adapters
LoRA
Vocabulary-Dateien
Prompt-Templates
```

Diese werden nicht allein gestartet.

Sie werden einem Hauptmodell zugeordnet und beim Start der Haupt-Runtime eingebunden.

Dafür sollte intern unterschieden werden:

```ts
type UtilityArtifactKind =
  | "embedding_model"
  | "reranker_model"
  | "ocr_model"
  | "asr_model"
  | "vision_projector"
  | "lora_adapter"
  | "tokenizer"
  | "chat_template";
```

---

# 3. Modelindex-Verknüpfung

Der Modelindex muss Basismodell und `mmproj` zuverlässig paaren.

## Empfohlenes Profil

```json
{
  "id": "qwen2.5-vl-3b-q4",
  "name": "Qwen2.5 VL 3B",
  "model_path": "D:/Models/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf",
  "modalities": ["text", "image"],
  "supports_text_only": true,
  "supports_vision": true,
  "requires_vision_projector": true,
  "utility_artifacts": [
    {
      "kind": "vision_projector",
      "id": "qwen2.5-vl-3b-mmproj",
      "path": "D:/Models/mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf",
      "compatibility_status": "verified",
      "confidence": 1.0
    }
  ]
}
```

## Paarungsregeln

Nicht nur Dateinamen verwenden.

Beweisreihenfolge:

```text
explizite Konfiguration
→ GGUF-/Projector-Metadaten
→ bekannte Modellfamilie
→ Dateinamenheuristik
→ Runtime-Probe
```

Ein Paar gilt erst als einsatzbereit, wenn:

```text
Basismodell vorhanden
Projector vorhanden
Runtime unterstützt --mmproj
Modell und Projector kompatibel
Probe mit echtem Bild erfolgreich
```

---

# 4. Was bedeutet „MM“ für Codee?

Multimodal ist keine einzelne Rolle.

Es ist eine **Eingabefähigkeit**, die mit einer fachlichen Aufgabe kombiniert wird.

Beispiele:

```text
Chat + Bild
Coding + Screenshot
Review + UI-Mock-up
Debug + Fehlermeldungsbild
Docs + Diagramm
Audio + Spektrogramm
```

Deshalb sollte das Routing zweidimensional arbeiten:

```text
Fachrolle
+
Modalität
```

## Beispiele

```text
CHAT + IMAGE
→ multimodales Chatmodell

CODER + IMAGE
→ Screenshot analysieren
→ visuellen Kontext in strukturierte Fakten umwandeln
→ Coding-Modell implementiert

REVIEW + IMAGE
→ UI-Screenshot gegen Sourcecode prüfen

DEBUG + IMAGE
→ Fehlermeldung/OCR extrahieren
→ Debugger-Modell analysiert Ursache
```

---

# 5. Soll ein multimodales Modell auch coden?

## Ja, aber nicht automatisch

Ein Visionmodell kann Coding-Aufgaben übernehmen, wenn seine Coding-Capability tatsächlich verifiziert wurde.

Es gibt drei Qualitätsstufen.

### Stufe A – Visueller Zubringer

Das multimodale Modell analysiert nur das Bild.

Ausgabe:

```json
{
  "screen": "Runtime Tab",
  "observations": [
    "Tabelle ist horizontal überladen",
    "Statusinformationen sind doppelt",
    "Aktionsbuttons sind zu klein"
  ],
  "referenced_ui_elements": [
    "RuntimeModelsTab",
    "ModelInventoryPanel"
  ]
}
```

Danach arbeitet das normale Coding-Modell.

**Das ist für Codee zunächst die beste Variante.**

### Stufe B – Multimodaler Coding-Assistent

Das Visionmodell darf zusätzlich:

- relevante Dateien bestimmen
- Implementierungsvorschläge formulieren
- Codefragmente erzeugen

Die eigentliche Änderung bleibt beim zertifizierten Coder.

### Stufe C – Vollständiger multimodaler Coder

Das multimodale Modell darf selbst Änderungen erzeugen und anwenden.

Nur zulässig, wenn verifiziert:

```text
vision
code_generation
code_review
structured_output
instruction_following
```

und die Mindest-Confidence erreicht ist.

---

# 6. Empfohlenes Routing für Codee

## Standard ohne Bild

```text
Chat
→ CHAT-Modell

Coding
→ CODER-Modell

Review
→ REVIEW-Modell
```

Kein Visionmodell wird geladen.

## Anfrage mit Bild

```text
Benutzer hängt Bild an
→ Modalitätsdetektor erkennt IMAGE
→ Model Broker prüft Visionbedarf
→ multimodales Modell + mmproj wird geladen
→ Bildanalyse wird erzeugt
→ Ergebnis wird als strukturierter Context Pack gespeichert
```

Danach:

### Chatfrage

```text
Bildanalyse
→ multimodales Modell beantwortet direkt
```

### Coding-Aufgabe

```text
Bildanalyse
→ Context Pack
→ normales CODER-Modell
→ Diff
→ Approval
→ Apply
```

### Debugging

```text
OCR + visuelle Fehleranalyse
→ DEBUG-Modell
```

### UI-Review

```text
Visionmodell
→ visuelle Findings

Reviewmodell
→ Findings gegen Sourcecode und Projektregeln prüfen
```

---

# 7. Ladeverhalten beim App-Start

## Nicht empfehlenswert

Beim Start der App sofort zu laden:

```text
Textmodell
Visionmodell
mmproj
Embedding
Reranker
```

Das würde Startzeit, RAM und VRAM unnötig belasten.

## Empfohlener Startpfad

Beim App-Start nur:

```text
Modelindex laden
→ Utility-Artefakte erkennen
→ Basismodell-mmproj-Paare bilden
→ Pfade prüfen
→ Runtime-Kompatibilität prüfen
→ Status anzeigen
```

Noch keine Modellgewichte laden.

Status:

```text
Vision-Paar erkannt
Projector validiert
Runtime bereit
nicht geladen
```

---

# 8. Lazy Loading

## Beim ersten Bildauftrag

```text
1. Bild erkannt
2. passendes multimodales Profil wählen
3. prüfen, ob benötigtes Modell bereits läuft
4. Speicherbudget prüfen
5. bei Bedarf aktuelle Runtime stoppen oder parken
6. Basismodell + mmproj gemeinsam starten
7. Healthcheck
8. Bild-Probe
9. Benutzerauftrag ausführen
```

## Nach der Aufgabe

Optionen:

```text
sofort entladen
nach Inaktivitätszeit entladen
für weitere Bildfragen warm halten
```

Für Ralles System empfohlen:

```text
Idle Timeout: 120–300 Sekunden
maximal eine schwere Modell-Runtime gleichzeitig
```

---

# 9. Runtime-Slots

Die vorhandenen Slots:

```text
quality_cpu
fast_gpu
utility
```

sollten nicht sofort gebrochen werden.

## Migrationssichere Variante

Zunächst keinen neuen physischen Slot einführen.

Stattdessen:

```text
execution_slot: quality_cpu oder fast_gpu
modality_profile: text oder vision
utility_artifacts: [mmproj]
```

Beispiel:

```json
{
  "slot_id": "fast_gpu",
  "model_id": "qwen2.5-vl-3b-q4",
  "modality_profile": "vision",
  "utility_artifact_ids": ["qwen2.5-vl-3b-mmproj"]
}
```

Später kann optional ergänzt werden:

```text
multimodal
```

als eigener logischer Slot. Technisch notwendig ist das zunächst nicht.

---

# 10. Runtime-Startvertrag

Der Startauftrag sollte erweitert werden, ohne bestehende Aufrufer zu brechen.

Bestehend:

```ts
startModel(modelId)
```

Bleibt erhalten.

Additiv:

```ts
startModel(modelId, {
  modality: "text" | "vision",
  utilityArtifacts?: string[],
  reason?: string
})
```

Oder besser intern:

```ts
startRuntimeProfile(profileId)
```

während `startModel(modelId)` als kompatibler Wrapper erhalten bleibt.

## Runtime-Profil

```ts
interface RuntimeLaunchProfile {
  id: string;
  modelId: string;
  modality: "text" | "vision" | "audio";
  projectorId?: string;
  loraIds?: string[];
  slotId: RuntimeSlotId;
  contextSize: number;
  gpuLayers: number;
  imageMaxPixels?: number;
  idleTimeoutSeconds: number;
}
```

---

# 11. Broker-Erweiterung

Der Broker besitzt bereits:

```text
hasImageInput
requiresVision
requiresVisionProjector
supportsTextOnly
```

Er sollte zusätzlich entscheiden:

```ts
interface MultimodalRoutingDecision {
  modality: "text" | "image" | "audio";
  executionMode:
    | "direct_multimodal_chat"
    | "vision_context_then_text_model"
    | "specialist_then_text_model";
  projectorId?: string;
  downstreamRole?: "chat" | "coder" | "reviewer" | "debugger";
}
```

## Grundregel

```text
Bild vorhanden ≠ automatisch Visionmodell macht alles
```

Stattdessen:

```text
Bild vorhanden
→ Visionanalyse erforderlich

Aufgabentyp
→ entscheidet über nachgeschaltete Rolle
```

---

# 12. Konkrete Routing-Matrix

| Eingabe | Aufgabe | Visionmodell | nachgeschaltetes Modell |
|---|---|---:|---|
| Text | Chat | nein | Chat |
| Text | Coding | nein | Coder |
| Bild | einfache Frage | ja | keines oder Chat |
| Screenshot | Coding | ja | Coder |
| Screenshot | Debug | ja | Debugger |
| UI-Bild | Review | ja | Reviewer |
| Diagramm | Architektur | ja | Planner |
| PDF-Seite | Dokumentfrage | ja | Docs/Chat |
| Audio | Transkription | Spezialmodell | Chat |
| Audio | Musikverständnis | Audioanalyse | Music/Chat |

---

# 13. Einstellungen im Runtime Tab

## Utility & Projector

- Projector automatisch zuordnen
- manuell zuordnen
- Paarung prüfen
- Runtime-Probe ausführen
- Projector deaktivieren
- bevorzugten Projector setzen

## Multimodal Routing

- Bilder automatisch erkennen
- Visionmodell
- Vision-Fallback
- direkter Vision-Chat
- Vision → Coder Pipeline
- Vision → Reviewer Pipeline
- Idle Timeout
- maximale Bildgröße
- CPU-/GPU-Profil
- Runtime nach Auftrag entladen

## Sicherheitsoptionen

- Screenshot vor Analyse anzeigen
- OCR auf Secrets prüfen
- EXIF entfernen
- Cloud-Vision aus
- temporäre Bilder nach Auftrag löschen

---

# 14. Startzustände

Jedes multimodale Modellpaar benötigt einen eindeutigen Status:

```text
discovered
paired
validated
ready
loading
running
degraded
failed
incompatible
```

Beispiele:

```text
Qwen2.5-VL
Basismodell: vorhanden
MMProj: vorhanden
Paarung: verifiziert
Runtime: bereit
Status: READY
```

oder:

```text
LLaVA
Basismodell: vorhanden
MMProj: fehlt
Status: INCOMPLETE
Routing erlaubt: nein
```

---

# 15. Umsetzung in Phasen

## Phase MM-1 – Index und Paarung

- mmproj als Utility Artifact klassifizieren
- Basismodell/Projector-Verknüpfung
- Status im Runtime Tab
- keine Runtime-Änderung

## Phase MM-2 – Startprofil

- Basismodell + mmproj gemeinsam starten
- Healthcheck
- Bild-Probe
- Lazy Loading
- Idle Unload

## Phase MM-3 – Chat

- Bildanhang
- direkter multimodaler Chat
- Context-Persistenz

## Phase MM-4 – Coding und Review

- Vision → strukturierter Context Pack
- Context Pack an Coder/Reviewer
- klare Herkunft der visuellen Findings
- keine direkte Dateischreibfreigabe für ungeprüfte Visionmodelle

## Phase MM-5 – Capability-Zertifizierung

- Vision-Benchmarks
- OCR
- UI-Verständnis
- Diagramme
- Coding mit Bild
- Confidence und Routingfreigabe

---

# 16. Empfehlung für Codee

Für die erste produktive Version:

```text
UTILITY
→ verwaltet mmproj und andere Hilfsartefakte

VISION-Modell
→ wird nur bei Bildinput lazy geladen

CHAT mit Bild
→ Visionmodell antwortet direkt

CODING mit Bild
→ Visionmodell erstellt Context Pack
→ normales Coding-Modell implementiert

REVIEW mit Bild
→ Visionmodell liefert visuelle Findings
→ Reviewmodell validiert gegen Sourcecode
```

Das ist robuster als ein einziges Modell für alles.

---

# 17. Wichtigste Regeln

1. `mmproj` nie allein starten.
2. Basismodell und Projector immer gemeinsam validieren.
3. Beim App-Start indexieren und prüfen, nicht automatisch laden.
4. Erst bei Bildinput lazy laden.
5. Multimodalität und Fachrolle getrennt routen.
6. Visionmodell darf nur coden, wenn Coding-Capability zertifiziert ist.
7. Für den Anfang Vision als Context-Zubringer für Coder und Reviewer nutzen.
8. Auf 4-GB-VRAM-Systemen maximal eine schwere Runtime gleichzeitig.
9. Nach Inaktivität multimodale Runtime entladen.
10. Bestehende Slots und Store-Verträge additiv erweitern.

---

# Schlussformel

```text
UTILITY verwaltet die Werkzeuge.
MMProj verbindet das Sehen mit dem Basismodell.
Vision versteht das Bild.
Coder, Reviewer oder Debugger erledigen die Fachaufgabe.
```
