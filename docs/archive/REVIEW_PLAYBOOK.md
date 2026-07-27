# Review Playbook

## Zweck
Dieses Playbook hilft, je nach Risiko und Aenderungsumfang den passenden Review-Modus zu waehlen.

## Entscheidungsbaum

1. Betrifft der PR Sicherheitslogik, Prozessausfuehrung, Persistenz oder API-Vertraege?
- Ja: Deep Pass
- Nein: weiter mit 2

2. Betrifft der PR mehr als 5 Dateien oder mehr als 200 geaenderte Zeilen?
- Ja: Deep Pass
- Nein: weiter mit 3

3. Sind nur UI-Texte, kleine Refactors oder Tests ohne Verhaltensaenderung betroffen?
- Ja: Quick Pass
- Nein: Deep Pass

## Quick Pass (5 Minuten)
Nutze [REVIEW_QUICK_PASS.md](REVIEW_QUICK_PASS.md) fuer einen schnellen Risiko-Scan.

Einsatz:
- kleine Aenderungen
- geringe Seiteneffekte
- keine sicherheitskritischen Pfade

Erwartetes Ergebnis:
- PASS, SOFT BLOCK oder HARD BLOCK

## Deep Pass (30 Minuten)
Nutze [REVIEW_DEEP_PASS.md](REVIEW_DEEP_PASS.md) fuer eine gruendliche technische Pruefung.

Einsatz:
- neue Module/Services
- neue IPC/API-Flaechen
- persistente Datenpfade
- potenziell sicherheitskritische Aenderungen

Erwartetes Ergebnis:
- priorisierte Findings
- offene Fragen
- klare Review-Entscheidung

## Reviewer-Ablauf

1. Entscheide Modus per Entscheidungsbaum.
2. Fuehre Checkliste des Modus vollstaendig aus.
3. Dokumentiere Findings nach Schweregrad.
4. Markiere Entscheidung: `APPROVE` oder `REQUEST_CHANGES`.
5. Ergaenze optionale Follow-ups (nicht-blockierend).

## Severity-Leitlinie

- High: Sicherheitsrisiko, Datenverlust, Contract-Break
- Medium: funktionale Instabilitaet, falsche Fehlerbehandlung, unvollstaendige Validierung
- Low: Wartbarkeit, Lesbarkeit, Konsistenz

## Empfehlungen fuer dieses Repo

- Bei Backend-API + Bridge + Store Aenderungen standardmaessig Deep Pass.
- Bei reinen Doku- oder Textaenderungen Quick Pass.
- Vor Freigabe mindestens folgende Checks verifizieren:
  - `pnpm typecheck`
  - `uv run pytest`
