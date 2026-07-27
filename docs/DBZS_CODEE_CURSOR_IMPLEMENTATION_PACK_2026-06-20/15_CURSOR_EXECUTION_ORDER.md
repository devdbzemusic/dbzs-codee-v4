# Cursor-Ausführungsreihenfolge

## Vor jedem Auftrag

```powershell
git status
pnpm typecheck
pnpm test
pnpm build
```

Falls der Ausgangsstand nicht grün ist:

- Fehler dokumentieren
- nicht als Folge des neuen Auftrags ausgeben
- keine breite Reparatur ohne Zustimmung

## Reihenfolge

1. `PROMPTS/01_PHASE_3A_AGENT_RUN_BACKBONE.md`
2. Review und Tests
3. Commit
4. `PROMPTS/02_PHASE_3B_EVENT_SPINE_WORKER.md`
5. Review und Tests
6. Commit
7. `PROMPTS/03_PHASE_3C_CONTEXT_AND_TOOLS.md`
8. Review und Tests
9. Commit
10. `PROMPTS/04_PHASE_3D_PROJECT_ADAPTERS_HOST_ACTIONS.md`
11. Review und Tests
12. Commit
13. `PROMPTS/05_PHASE_3E_PATCH_REVIEW_TEST_LOOP.md`
14. Review und Tests
15. Commit
16. `PROMPTS/06_PHASE_3F_AGENT_WORKBENCH_UI.md`
17. Review und Tests
18. Commit
19. `PROMPTS/07_PHASE_3G_FOLLOWUP_RESUME_HARDENING.md`

## Nicht tun

- alle Phasen in einem Cursor-Lauf
- bestehende Agentenpfade sofort löschen
- App.tsx komplett neu schreiben
- neue State-Management-Library einführen
- neue Datenbank einführen
- Auto-Apply aktivieren
- Shell-Commands aus LLM-Ausgabe ausführen
- UI zuerst bauen
- Cursor-Layout kopieren

## Cursor-Abschlussbericht je Phase

Cursor muss liefern:

1. Zusammenfassung
2. geänderte Dateien
3. neue Datenmodelle/APIs
4. ausgeführte Commands
5. Testergebnisse
6. manuell nicht geprüfte Punkte
7. bekannte Risiken
8. Migrationshinweise
9. nächster sinnvoller Auftrag
