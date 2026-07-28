# DBZS Codee — Offene Aufgaben abarbeiten + Golden-Path-Verifikation

## Kontext

`Pläne/DBZS_CODEE_PERSONAL_PRODUCTION_VERIFICATION_2026-07-28.md`, `HANDOVER.md` und `TODO.md` beschreiben übereinstimmend denselben Stand: PR #4 (Runtime-Chat-Overhaul + Personal Production Stabilization) ist nach `main` gemergt, Status **PERSONAL-RC**. Offen sind (a) eine Handvoll kleiner, konkreter Code-Aufräumpunkte, die ich direkt umsetzen kann, und (b) der reale interaktive Golden-Path-Test in der laufenden Desktop-App, der laut Verifikationsdokument die letzte Freigabevoraussetzung für `DBZS Codee 0.4.0-personal-stable` ist.

Zwei Recherche-Agents haben die vier vagen Restpunkte konkretisiert (vier lose Altänderungen, der `atomicFileWrite.ts`-Typfehler, CI-Status, Vite-Importwarnungen, sowie die beiden Review-Diagnostik-TODOs). Nutzerentscheidungen für diesen Plan:

- **GitHub-CI-Strategie / Branch Protection für `main`**: bewusst **zurückgestellt**, konsistent mit der Personal-Production-Plan-Philosophie ("vorerst nicht nötig") — nicht Teil dieses Umsetzungsplans.
- **Golden-Path-Verifikation**: zusätzlich zur konsolidierten manuellen Checkliste wird versucht, Teile über die bereits vorhandene Playwright-E2E-Suite automatisiert vorzuverifizieren.

## Reihenfolge

**Phase A (Code-Fixes, ohne GUI) → Phase B (Golden-Path-Verifikation, mit Automatisierungsversuch) → Doku-Update.** Phase C (explizit zurückgestellte Punkte) wird nur dokumentiert, nicht umgesetzt.

---

## Phase A — Code-Fixes

### A.1 `atomicFileWrite.ts`-Typfehler beheben

`apps/desktop/electron/atomicFileWrite.ts:22` — `MkdirLike` ist zu eng/falsch typisiert (`options?: { recursive?: boolean }`, `Promise<void>`), passt nicht zu Nodes echter `fs.promises.mkdir`-Recursive-Overload (`options: MakeDirectoryOptions & { recursive: true }`, `Promise<string | undefined>`). Da `writeFileAtomic` `mkdir` immer mit `{ recursive: true }` aufruft (Zeile 110), reicht es, `MkdirLike` auf genau diesen Overload zu verengen:

```ts
type MkdirLike = (filePath: string, options: { recursive: true }) => Promise<string | undefined>;
```

Damit sind sowohl der Aufrufort (`atomicFileWrite.ts:114`) als auch das Test-Fixture (`atomicFileWrite.test.ts:47`, das `...await import("node:fs/promises")` spreadet) typkompatibel. Nach dem Fix: `apps/desktop/electron/atomicFileWrite.ts` und `atomicFileWrite.test.ts` sind fertig und committbar (waren bisher nur wegen dieses Fehlers "in der Schwebe").

### A.2 Vier lose Altänderungen committen

Bestätigt: alle vier Dateien gehören zu **einer** kohärenten, fertigen Änderung (Intent-Klassifikation verschärfen: "Fix-Plan"/"Implementierungsplan"/"Umsetzungsplan"-Formulierungen werden jetzt als `plan_only` erkannt statt als Repair-Hinweis "liefere einen strukturierten Fix-Plan" zu suggerieren):

- `apps/desktop/electron/skillRunPersistenceService.ts` — verdrahtet den neuen `writeFileAtomic`-Helfer aus A.1 (ersetzt Hand-rolled mkdir/write/rename)
- `apps/desktop/src/services/executionHandoff.ts` — entfernt den "…oder liefere einen strukturierten Fix-Plan"-Repair-Hinweis
- `apps/desktop/src/services/executionIntent.ts` — ergänzt `PLAN_ONLY_PATTERNS` um Implementierungsplan/Umsetzungsplan/Fix-Plan-Formulierungen
- `apps/desktop/src/services/executionIntent.test.ts` — zwei neue Assertions für die neuen Muster

Reihenfolge: erst A.1 committen (da `skillRunPersistenceService.ts` von `atomicFileWrite.ts` importiert), dann alle vier zusammen mit A.1 in einem Commit. Kein neuer Code nötig — nur committen. Empfehlung: einen Test für die `fix-?plan`/`structured fix-?plan`-Muster ergänzen (aktuell nur Implementierungsplan/Umsetzungsplan getestet, nicht die Fix-Plan-Variante).

### A.3 Vite-Importwarnungen auflösen

Beide Warnungen (`backendClient.ts`, `providerRuntimeEvents.ts` gleichzeitig statisch und dynamisch importiert) haben denselben Ursprung: `apps/desktop/src/stores/runtimeChatStoreRuntimeHelpers.ts:178` (`await import("@/services/backendClient")`) und `:435` (`await import("@/services/providerRuntimeEvents")`). Beide Module sind bereits über Sibling-Stores (`runtimeChatStore.ts`, `runtimeChatStoreAgentTurnCallbacks.ts`, `runtimeChatStoreStreamingCallbacks.ts`) statisch im selben Bundle-Chunk enthalten — der dynamische Import bringt keinen echten Code-Splitting-Vorteil. Fix: beide Stellen auf normale statische Imports umstellen (`import { backendClient } from "@/services/backendClient"`, `import { isModelContentDelta } from "@/services/providerRuntimeEvents"` am Dateikopf, Aufrufe entsprechend anpassen).

### A.4 Repository-Review: Fehlerklassifikation + Diagnose-Export bei leerem Plan

Beide TODO-Punkte hängen an derselben Stelle: `apps/desktop/src/services/repositoryReview/repositoryReviewOrchestrator.ts:318-334` behandelt `plan.batches.length === 0` generisch als `outcome: "failed"`, ununterscheidbar von vier anderen Fehlerpfaden in derselben Funktion. Es existiert bereits die passende Infrastruktur, nur ungenutzt für diesen Fall:

1. **Outcome-Wert ergänzen**: `RepositoryReviewOutcome` in `packages/shared/src/index.ts:778-792` um einen neuen Wert erweitern (z. B. `"empty_plan"`) statt eines der bestehenden Legacy-Werte zweckzuentfremden.
2. **`normalizePersistedReviewOutcome()`** in `apps/desktop/src/services/repositoryReview/reviewPersistence.ts:182-199` um den neuen Wert ergänzen.
3. **Bestehenden `failedResult()`-Helfer nutzen** (`repositoryReviewOrchestrator.ts:589-619`, aktuell nur in `resume()` verwendet) für den `plan.batches.length === 0`-Zweig statt des manuellen Blocks — inklusive Detail-String, der unterscheidet: leere Schnittmenge mit `selectedPaths`, Extension-Filter hat alles ausgeschlossen, oder Budget-Splitting kollabierte auf null.
4. **`failedResult()` fixen**: persistiert aktuell nicht über `saveReviewState` — das nachholen, damit der Reason-String auch nach Reload sichtbar bleibt (`ReviewStateFile` in `apps/desktop/src/services/repositoryReview/types.ts:34-48` braucht dafür ein Reason/Detail-Feld, das bisher fehlt).
5. **UI bekommt es automatisch**: `apps/desktop/src/components/chat/CodeeRunLiveBlock.tsx:305`/`:288-289` rendert `outcome` und `currentBatchTitle` bereits — keine UI-Änderung nötig.
6. **Regressionstest ergänzen**: `apps/desktop/src/services/repositoryReview/repositoryReview.test.ts` hat aktuell keinen Test für den `plan.batches.length === 0`-Zweig bei `inventory.fileCount > 0` (nur den generischen "leeres Inventory"-Fall unter `:380-393`). Neuen Testfall ergänzen: `active_file`/`selected_paths`-Scope mit einem Pfad, der nicht zur Extension-Whitelist passt oder nicht im Inventory liegt.

Risiko: niedrig-mittel — berührt einen gemeinsamen Typ (`packages/shared`) und vier Dateien, aber alles additiv, bestehende Fälle bleiben unverändert.

---

## Phase B — Golden-Path-Verifikation

### B.1 Automatisierungsversuch

Diese Sandbox hat `ELECTRON_RUN_AS_NODE=1` gesetzt, wodurch ein direkter Electron-Start nur als Node-Prozess läuft (kein echtes Fenster) — das hat den vorherigen `e2e/boot.spec.ts`-Lauf verhindert. Versuch: den Playwright-E2E-Lauf mit für den Kindprozess **entfernter** `ELECTRON_RUN_AS_NODE`-Variable erneut starten (`env -u ELECTRON_RUN_AS_NODE npx playwright test`, Backend+Renderer-Dev-Server wie zuvor manuell vorstarten, da `uv` in dieser Shell fehlt). Falls das den echten Electron-Prozess startet: die **volle vorhandene E2E-Suite** laufen lassen, nicht nur `boot.spec.ts` — `e2e/coding-assistant.spec.ts`, `runtime-chat.spec.ts`, `job-monitor.spec.ts`, `command-palette.spec.ts`, `context-integration.spec.ts`, `mission-control.spec.ts`, `agent-capabilities.spec.ts` decken vermutlich Teile der Golden-Path-Kriterien automatisiert ab (Boot, Chat, Review, Testlauf-Trigger). Falls der Start weiterhin fehlschlägt: Abbruch dokumentieren, ohne die Sandbox-Beschränkung zu umgehen, und vollständig auf die manuelle Checkliste (B.2) verweisen.

### B.2 Konsolidierte Checkliste

Die 10 Kriterien aus dem Original-Plan und die 12 aus dem Verifikationsdokument werden zu einer Liste zusammengeführt (Duplikate entfernt, "Projekt bleibt gespeichert" und "Freigabe wird verlangt" als eigene Punkte ergänzt). Pro Punkt wird markiert, ob B.1 automatisiert Abdeckung liefert oder ob er zwingend manuell (auf dem echten Windows-Rechner) bleibt:

| # | Kriterium | Voraussichtlich automatisierbar via B.1? |
|---|---|---|
| 1 | App startet 10× fehlerfrei | Teilweise (`boot.spec.ts` prüft einen sauberen Start; 10× Wiederholung bleibt sinnvollerweise manuell) |
| 2 | Projekt öffnet sich und bleibt gespeichert | Nein — manuell |
| 3 | Lokales Modell verbindet sich automatisch | Teilweise, falls `runtime-chat.spec.ts` das abdeckt |
| 4 | Chat beantwortet Projektfrage | Möglich via `runtime-chat.spec.ts`/Tuning-Lab-Fixture |
| 5 | Full-Repository-Review läuft durch | Möglich via `coding-assistant.spec.ts` |
| 6 | `.codee`/`.env`/Logs/Builds fehlen im Inventory | Automatisiert abgedeckt durch bestehende Unit-Tests (Area 2, bereits grün) + manueller Stichprobenblick |
| 7 | Änderung erscheint zuerst als Diff | Möglich via `coding-assistant.spec.ts` |
| 8 | Änderung verlangt Freigabe | Möglich, falls Approval-Flow im E2E-Fixture getriggert wird |
| 9 | Änderung lässt sich anwenden | Möglich via `coding-assistant.spec.ts` |
| 10 | Tests lassen sich aus Codee starten | Möglich via `command-palette.spec.ts`/`job-monitor.spec.ts` |
| 11 | Rollback/Restore-Point funktioniert | Nein — manuell |
| 12 | Backup/Restore funktioniert (Diagnostics-Tab) | Nein — manuell (UI-Klick, kein bestehender E2E-Test) |
| 13 | Neustart nach Abbruch erhält Zustand | Nein — manuell (harter Kill nötig) |
| 14 | Gepackter Installer-Build: `backupService.ts`-userData-Pfad stimmt | Nein — manuell, erfordert echten Installer-Build |

Ergebnis (automatisiert + manuell) wird als neue Datei unter `docs/audits/` abgelegt (Format wie `MAIN_READINESS_AUDIT_2026-07-27.md`), inklusive der Startbefehle aus dem Verifikationsdokument.

### B.3 Freigabekriterium

Unverändert aus dem Verifikationsdokument: vollständiger Durchlauf funktioniert und ist an zwei weiteren Tagen reproduzierbar → Tag `DBZS Codee 0.4.0-personal-stable`. Dieser Plan bereitet die Voraussetzungen vor, der reale Tag-Zeitpunkt liegt beim Nutzer.

---

## Phase C — Bewusst zurückgestellt (nicht Teil dieses Plans)

- GitHub-CI-Strategie entscheiden / reaktivieren (ohnehin durch GitHub-Billing-Sperre blockiert, `ci.yml`/`live-runtime-validation.yml` bleiben absichtlich `workflow_dispatch`-only)
- Branch Protection / Merge-Gates für `main`
- Große strukturelle Backlog-Punkte ("weitere Zerlegung grosser Runtime-/Store-Dateien", "Contract-Parity zwischen Shared und Backend weiter härten") — bleiben unpriorisierter Backlog

`HANDOVER.md`/`TODO.md` behalten diese Punkte als explizit zurückgestellt markiert, nicht gelöscht.

---

## Kritische Dateien

- `apps/desktop/electron/atomicFileWrite.ts`
- `apps/desktop/electron/skillRunPersistenceService.ts`, `apps/desktop/src/services/executionHandoff.ts`, `executionIntent.ts` (+ `.test.ts`)
- `apps/desktop/src/stores/runtimeChatStoreRuntimeHelpers.ts`
- `packages/shared/src/index.ts` (`RepositoryReviewOutcome`)
- `apps/desktop/src/services/repositoryReview/repositoryReviewOrchestrator.ts`, `reviewPersistence.ts`, `types.ts`, `repositoryReview.test.ts`
- `e2e/boot.spec.ts` + weitere `e2e/*.spec.ts`
- `HANDOVER.md`, `TODO.md`, neues `docs/audits/GOLDEN_PATH_VERIFICATION_2026-07-28.md` (o.ä.)

## Phasen-/Commit-Reihenfolge

1. A.1 + A.2 zusammen (ein Commit — Fix hängt zusammen mit den vier Altänderungen)
2. A.3 (eigener Commit, unabhängig)
3. A.4 (eigener Commit, unabhängig)
4. B.1 Automatisierungsversuch, dann B.2 Checkliste ausführen/dokumentieren
5. `HANDOVER.md`/`TODO.md` final aktualisieren: Phase A abgehakt, Phase B Ergebnis eingetragen, Phase C explizit als zurückgestellt markiert

## Verifikation

- Nach A.1/A.2: `npm run typecheck` (apps/desktop) komplett fehlerfrei (erstmals ohne die bisherigen Restfehler); betroffene Vitest-Läufe grün.
- Nach A.3: `electron-vite build` ohne die beiden Vite-Warnungen zu gemischten Imports.
- Nach A.4: neuer Regressionstest grün; bestehende `repositoryReview.test.ts`-Suite weiterhin grün; manueller Review-Lauf mit nicht-passendem `selectedPaths` zeigt jetzt spezifischen Grund statt generischem "failed".
- Nach B: Ergebnis-Dokument unter `docs/audits/` mit automatisiert vs. manuell verifizierten Punkten; falls B.1 fehlschlägt, sauber dokumentierter Abbruch ohne Sandbox-Workaround-Versuche jenseits des Env-Var-Unset.
