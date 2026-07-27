# Dependabot — Security Review (2026-06-26)

Stand: **Alle High-Severity Alerts behoben** ✅

## Historie

### 2026-06-12: tar Alerts (transitiv)

6 offene **high** Alerts betrafen `tar` (transitive Dependency via electron-builder/node-gyp):

| # | Paket | Patch ab | Thema |
|---|-------|----------|-------|
| 12 | tar | 7.5.3 | Path Traversal / Symlink Poisoning |
| 13 | tar | 7.5.4 | Unicode-NCD Race / Hardlink-Kollision |
| 14 | tar | 7.5.7 | Hardlink/Symlink Escape |
| 15 | tar | 7.5.8 | Hardlink Target Escape via Symlink Chain |
| 16 | tar | 7.5.10 | Hardlink Path Traversal |
| 17 | tar | 7.5.11 | Symlink Path Traversal |

**Lösung:** Override in `pnpm-workspace.yaml`:
```yaml
overrides:
  tar: ">=7.5.11"
  dompurify: ">=3.4.0"
  ws: ">=8.20.1"
```

---

### 2026-06-26: Electron & Vite Alerts

**Ausgangslage:** 6 High-Severity Alerts nach `pnpm audit`

| Alert | Paket | Vulnerable | Patched | Thema |
|-------|-------|------------|---------|-------|
| 1 | electron | <39.8.1 | >=39.8.1 | Use-after-free in offscreen window |
| 2 | electron | <38.8.6 | >=38.8.6 | Use-after-free in WebContents |
| 3 | electron | <38.8.6 | >=38.8.6 | Use-after-free in PowerMonitor |
| 4 | electron | <38.8.6 | >=38.8.6 | Command-line switch injection |
| 5 | form-data | — | — | CRLF injection (moderate) |
| 6 | vite | >=7.0.0 <=7.3.4 | >=7.3.5 | `server.fs.deny` bypass (Windows) |

**Durchgeführte Updates:**

```powershell
# Electron Update (38.4.0 → 42.5.0)
cd apps/desktop
pnpm update electron --latest

# Vite Update (7.3.3 → 7.3.6)
pnpm add -D vite@^7.3.6 -w          # Workspace Root
pnpm add -D vite@^7.3.6             # Desktop App
```

**Ergebnis nach Updates:**
```
Severity: 2 low | 1 moderate | 0 high | 0 critical
```

**Verbleibende Alerts (nicht kritisch):**
- 2 Low-Severity (keine direkte Auswirkung auf Produktion)
- 1 Moderate-Severity (launch-editor: NTLMv2 hash disclosure via UNC paths)

---

## Aktuelle Security-Metrics

```
┌─────────────┬──────────────┐
│ Severity    │ Count        │
├─────────────┼──────────────┤
│ Critical    │ 0            │ ✅
│ High        │ 0            │ ✅
│ Moderate    │ 1            │ ⚠️
│ Low         │ 2            │ ℹ️
└─────────────┴──────────────┘
```

---

## Empfohlene Wartung

### Regelmäßig (monatlich)
```powershell
pnpm audit                          # Security-Check
pnpm update --latest                # Dependencies prüfen
pnpm typecheck && pnpm test         # Regression testen
pnpm build                          # Build verifizieren
```

### Bei neuen High-Alerts
1. Alert analysieren (Betroffene Pakete, Pfade)
2. Minimales Update durchführen (nur betroffene Packages)
3. `pnpm audit` erneut prüfen
4. Build + Tests validieren
5. Dieses Dokument aktualisieren

---

## CI-Integration

Security-Check ist in CI integriert (`.github/workflows/ci.yml`):
```yaml
- name: Security Audit
  run: pnpm audit
  continue-on-error: true  # Build bricht nicht bei Alerts
```

**Empfehlung:** Bei High/Critical Alerts Build abbrechen:
```yaml
- name: Security Audit (strict)
  run: |
    pnpm audit --json > audit.json
    jq '.metadata.vulnerabilities.high + .metadata.vulnerabilities.critical' audit.json
```

---

## Referenzen

- [GitHub Dependabot Alerts](https://github.com/devdbzemusic/dbzs-codee-project/security/dependabot)
- [Electron Security Advisories](https://github.com/electron/electron/security/advisories)
- [Vite Security Advisories](https://github.com/vitejs/vite/security/advisories)
- [GHSA-fx2h-pf6j-xcff (Vite fs.deny bypass)](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)