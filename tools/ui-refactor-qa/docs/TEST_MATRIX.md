# UI Refactor Test Matrix

| ID | Bereich | Automatisierung | Phase |
|---|---|---|---|
| QA-001 | aktuelles Repository erkannt | Node Static Check | baseline |
| QA-002 | Root-/Desktop-Scripts vorhanden | Node Static Check | baseline |
| QA-003 | Playwright-Konfiguration vorhanden | Node Static Check | baseline |
| QA-004 | UI-Referenz bleibt außerhalb Build | Quarantäne-Check | baseline |
| QA-005 | verbotene Demo-Imports fehlen | Source Scan | alle |
| QA-006 | `/manus-storage/` fehlt | Source Scan | alle |
| QA-007 | Feature Flag classic/neural | Source Scan | migration |
| QA-008 | Neural Workbench Shell vorhanden | Source Scan + E2E | migration |
| QA-009 | Header vorhanden | E2E | migration |
| QA-010 | Activity Rail vorhanden | E2E | migration |
| QA-011 | Workspace Sidebar vorhanden | E2E | migration |
| QA-012 | Primary Workspace vorhanden | E2E | migration |
| QA-013 | Inspector vorhanden | E2E | migration |
| QA-014 | Bottom Dock vorhanden | E2E | migration |
| QA-015 | Statusbar vorhanden | E2E | migration |
| QA-016 | 1366×768 ohne Kern-Clipping | Playwright | migration |
| QA-017 | 1920×1080 ohne Kern-Clipping | Playwright | migration |
| QA-018 | Command Palette | vorhandene E2E + Smoke | alle |
| QA-019 | Tastaturfokus sichtbar | Playwright Heuristik | final |
| QA-020 | Status nicht nur farbcodiert | DOM Check | final |
| QA-021 | Loading/Empty/Error/Degraded | Contract Tests | final |
| QA-022 | Timeout ≠ Success | Unit/E2E Contract | vor Chat-Abnahme |
| QA-023 | Panel Collapse | Playwright | migration |
| QA-024 | Layout-Persistenz | Playwright | final |
| QA-025 | Explorer produktiv | Playwright | final |
| QA-026 | Runtime Chat produktiv | Playwright | final |
| QA-027 | Editor-Verknüpfung | Playwright | final |
| QA-028 | Bottom Dock Tabs | Playwright | final |
| QA-029 | keine verschachtelten Body-Scrollbars | Playwright | final |
| QA-030 | keine 0px-Kernpanels | Playwright | migration |
| QA-031 | neue UI-Dateien lintbar | Changed-Files-Check | alle |
| QA-032 | Typecheck | Repository Script | alle |
| QA-033 | Desktop Tests | Repository Script | alle |
| QA-034 | Backend Tests | Repository Script | final |
| QA-035 | Visual Snapshots | Playwright | migration/final |
