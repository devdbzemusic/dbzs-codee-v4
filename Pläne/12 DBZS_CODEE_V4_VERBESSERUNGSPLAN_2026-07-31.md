# DBZS Codee V4 — Verbesserungsplan

**Stand:** 2026-07-31
**Basis:** 18 evidenzbasierte Verbesserungsvorschläge aus einer frischen Durchsicht des aktuellen
Repository-Stands (Code, Architektur, Prozess) — konsolidiert in einen priorisierten Gesamtplan.

## Context

Nach mehreren Produktionsreife-Revisionen (Pläne 09–11) in dieser Session hat sich der Repository-Zustand
schnell weiterentwickelt — teils durch eigene Arbeit, teils durch parallel laufende Sessions desselben
Nutzers (u. a. ist währenddessen ein reales WinUI3-Projekt unter `apps/model-ops-winui/` entstanden, das dem
in Plan 11 getroffenen Entscheid "kein zweiter Frontend-Stack" widerspricht). Dieser Plan bündelt die daraus
entstandenen offenen Punkte in vier Etappen, sortiert nach Dringlichkeit und Abhängigkeit — nicht nach der
Reihenfolge, in der sie entdeckt wurden.

## Etappe 1 — Sofort: Entscheidungen, die alles andere blockieren

Diese Punkte sind kein Code-Aufwand, sondern Entscheidungen. Solange sie offen sind, entsteht bei jedem
weiteren Schritt das Risiko doppelter Arbeit.

1. **WinUI- vs. Electron-Duplikat für das Model Lab auflösen.** `apps/model-ops-winui/` ist bereits ein
   echtes, lauffähiges WinUI3-Projekt, das live gegen `/model-lab/*` spricht — parallel zum expliziten
   Plan-11-Entscheid, stattdessen die Electron-App zu erweitern. Beide Wege gleichzeitig zu verfolgen
   verdoppelt jede künftige Änderung am Model Lab. Muss vor jeder weiteren Model-Lab-Arbeit geklärt werden.
2. **Branch Protection für `main` aktivieren.** In dieser Session ist mehrfach beobachtet worden, dass
   parallele Sessions direkt auf `main` pushen konnten (Branch-Checkouts, überraschende Commits mitten in
   der eigenen Arbeit). Der `gh api`-Befehl dafür ist bereits in `HANDOVER.md` dokumentiert, aber bewusst
   nicht ausgeführt — jetzt ist der richtige Zeitpunkt, da genau das beschriebene Risiko real eingetreten ist.
3. **Leichten Session-Koordinationsmechanismus einführen.** Z. B. eine Datei mit aktivem Branch + Zeitstempel
   + kurzer Aufgabenbeschreibung, die jede Session beim Start schreibt/prüft — macht Kollisionen zwischen
   parallelen Sessions sofort sichtbar, statt sie erst über überraschende Diffs zu bemerken.

## Etappe 2 — Kurzfristig: überschaubarer Aufwand, hoher Nutzen

4. **`model_lab`-Backend-Testabdeckung erhöhen.** 1523 Zeilen neuer Code (`repository.py` allein 626 Zeilen:
   Datei-Scanning, SHA-Hashing, DB-Schreiben) haben aktuell nur 6 Testfunktionen — deutlich dünner als der
   Rest des Backends. Vor weiterem Ausbau (Enrichment, Benchmark) nachziehen.
5. **Sicherheitsregeln für Web-Enrichment jetzt durchsetzen.** `hf_integration.py` existiert bereits real.
   Der ursprüngliche Entwurf fordert "externe Metadaten nie ungeprüft übernehmen" und "API-Tokens nur im
   Windows Credential Manager" — das jetzt prüfen, bevor mehr Enrichment-Code entsteht, nicht nachträglich
   reparieren.
6. **`model_lab` gegen etablierte Backend-Konventionen abgleichen.** Fehlerbehandlung/Redaction-Patterns aus
   `runtime/service.py` und `settings/service.py` als Referenz nehmen, da der neue Code unabhängig entstanden
   ist und leicht abweichen kann.
7. **Migrations-Frameworks konsolidieren.** Es existieren bereits zwei unterschiedliche Muster
   (`app/core/migrations.py` SQLite-basiert, `app/settings/migrations.py` dict-basiert). Bevor `model_lab`
   ein drittes für eigene Tabellen erfindet: auf eines vereinheitlichen.
8. **Repo-Hygiene:** `Pläne/`-Ordner von generierten Plan-Mode-Nebenprodukten anderer Sessions bereinigen
   (`umsetzen-*.md`, `zippy-churning-teapot.md`, `lies-plane-implementierung-*-agent-*.md` — gehören nach
   `~/.claude/plans/`, nicht ins Repo), plus eine Rotation/Grenze für `.codee/diag-protokolle/`, das aktuell
   unbegrenzt anwächst.
9. **Dependency-Audit nachholen.** `pnpm audit` ist Teil von `ci:local:win`, lief aber vermutlich seit
   längerem nicht mehr real (CI inaktiv, `pnpm` in der Agent-Sandbox nicht mal installiert). Einmal manuell
   nachholen und Ergebnis dokumentieren.

## Etappe 3 — Mittelfristig: größerer Aufwand, planbar

10. **Godfiles zerlegen.** `runtimeChatStore.ts` (3007 Zeilen), `electron/main.ts` (2152), `backend/app/runtime/service.py`
    (1940), `index_service.py` (1456) — seit Wochen bekanntes, dokumentiertes Problem. `RuntimeModelsTab`s
    Modularisierung (`.controller/.sections/.rows/.primitives`) als Vorbild für dieselbe Behandlung der
    genannten Dateien nutzen.
11. **Model-Registry-Contract-Verify auf die WinUI-Seite ausweiten** (falls Etappe 1 Punkt 1 zugunsten von
    WinUI oder eines Parallelbetriebs entschieden wird) — `scripts/contracts/verify-runtime-contracts.mjs`
    prüft aktuell nur TS/Python, nicht die C#-DTOs; sonst entsteht unbemerkte Schema-Drift zwischen drei
    Consumern.
12. **Playwright-E2E-Suite für neu gebaute Features nachziehen** — Restore-Index-Repair-Button,
    Diagnose-ZIP-Export, Process-Supervisor-Health-Anzeige sind aktuell nur unit-getestet, nicht in der
    gemockten E2E-Suite abgedeckt.
13. **Vision-GPU-Exklusivität real verifizieren** — bisher nur gegen Fake-Prozesse getestet, nie mit zwei
    echten, gleichzeitig ladenden Modellen unter realem VRAM-Druck. Gehört auf die nächste echte
    Abnahme-Session (siehe `docs/audits/GOLDEN_PATH_MANUAL_VERIFICATION_SCRIPT.md`, Abschnitt D.3).
14. **Offene Tier-2/3-Diagnose-Lücken aus dem früheren Leak-Audit abarbeiten** — ~19 dokumentierte,
    niedrigpriorisierte Punkte (`finish_reason` nie ausgewertet, Patch-`stdout` nie in der UI sichtbar u. a.),
    seinerzeit bewusst zurückgestellt, weiterhin offen.
15. **Code-Signing für den Windows-Installer** — Scaffolding existiert bereits (Checkliste in
    `HANDOVER.md`), aber ohne echtes Zertifikat bleibt SmartScreen-Warnung bei jeder Installation ein
    UX-Blocker für Verteilung außerhalb der eigenen Maschine. Abhängig von einer externen Beschaffung
    (Kategorie B), kein Code-Blocker.
16. **CI-Reaktivierung** — abhängig von der Auflösung der GitHub-Billing-Sperre (Kategorie B). Checkliste
    bereits in `HANDOVER.md`/`ci.yml` vorbereitet, nur noch auszuführen, sobald die Sperre aufgehoben ist.

## Etappe 4 — Laufend / Prozess

17. **Doku-Drift-Checker auf `Pläne/`-Nummerierung ausweiten** — `docs:check-drift` deckt bisher nur
    README/TODO/HANDOVER/STATUS_TODAY ab. Bei der aktuellen Geschwindigkeit paralleler Plandokumente
    (mehrere binnen Stunden, teils mit doppelten Nummern wie `07`/`03 04 05`) wäre eine ähnliche, leichte
    Prüfung für die `Pläne/`-Nummerierung sinnvoll, um Kollisionen früh zu bemerken.
18. **Wiederkehrender Kurz-Check nach jeder größeren parallelen Arbeitsphase** — angesichts der in dieser
    Session mehrfach beobachteten Kollisionen zwischen Sessions: nach jedem Abschnitt intensiver paralleler
    Arbeit kurz `git log --oneline -10` + `git status` gegenprüfen, bevor der nächste Schritt geplant wird
    (informelle Ergänzung zu Etappe 1, Punkt 3, bis der Mechanismus dort steht).

## Verifikation

- Etappe 1 hat keine Code-Verifikation — Erfolg heißt: Entscheidung getroffen und dokumentiert (z. B. in
  `HANDOVER.md`), Branch Protection sichtbar aktiv, Koordinationsdatei existiert und wird genutzt.
- Etappen 2–3: jeweils wie im gesamten bisherigen Sessionverlauf — Typecheck + volle Testsuite (Desktop
  Vitest, Backend Pytest) vor jedem Commit, Commit → PR → Merge pro abgeschlossenem Punkt.
- Etappe 4 ist dauerhaft, kein Abschlusskriterium — wird bei jeder künftigen Plan-Erstellung mitgeprüft.
