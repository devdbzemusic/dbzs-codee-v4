# Modulgrenzen

## Ziel

Die Modulgrenzen verhindern, dass UI, State, Runtime, Shared und Backend wieder in wenige allwissende Dateien zusammenlaufen.

## Desktop

- `components/*`: reine Darstellung, Event-Weitergabe, kleine UI-Helfer.
- `stores/*`: Zustand, kleine Store-Actions, keine grossen Parser- oder Policy-Systeme.
- `services/*`: IO, Seiteneffekte, Adapter, Integrationslogik.
- `runtime/*`: Engines, Policies, Contracts, Tooling, Orchestrierung.
- `types/*`: lokale Frontend-Typen, keine Business-Logik.

## Shared

- `packages/shared/*`: neutrale Contracts, DTOs, Schemas, Konstanten.
- Kein Import aus `apps/desktop/*` oder `backend/*`.

## Backend

- `backend/app/runtime/*`: Runtime-Lifecycle, Warm-up, Slot-Management, Fallback, Diagnose.
- `backend/app/api/*`: HTTP-Adapter und Fehlerabbildung.
- `backend/app/core/*`: prozessweite Kernzustände und Basiskomponenten.

## Dateianhaenge im Runtime Chat

- React-Komponenten rendern nur Auswahlzustand, Vorschau und Entfernen.
- Electron/Main kapselt Datei-Dialog, Clipboard-Datei-Items und lokales Lesen leichter Anhangstypen.
- PDF- und ZIP-Aufbereitung lebt im Python-Backend, nicht in React-Komponenten und nicht als neue
  parserlastige Electron-Frontend-Landschaft.
- `packages/shared` enthaelt nur die neutralen Attachment-Vertraege, keine Datei- oder Parserlogik.

## Verbotene Richtungen

- Komponenten importieren keine Backend- oder Dateisystemlogik.
- Stores importieren keine UI-Komponenten.
- Shared importiert keine App- oder Backend-Module.
- Backend-API enthaelt keine grosse Runtime-Kernlogik.

## Godfile-Regel

- Soft Warning ab 600 Zeilen.
- Hard Stop ab 900 Zeilen fuer neue oder stark umgebaute Kernmodule.
- Bestehende Legacy-Ausnahmen muessen aktiv abgebaut werden und gelten nicht als Vorbild.
