# Release-Checklist — DBZS Codee

## RC-Release-Checkliste für 0.4.0-rc.1

### Pflicht-Gates

- [x] `pnpm check:version` erfolgreich
- [x] `pnpm smoke:packaging` erfolgreich
- [x] `pnpm build` erfolgreich
- [x] `pnpm typecheck` erfolgreich
- [x] `pnpm test` vollständig grün in der lokalen RC-Prüfung
- [x] `pnpm smoke-test` oder Backend-Health-Check erfolgreich
- [x] `pnpm e2e` in der Desktop-E2E-Suite aufgelistet und workflow-basiert vorbereitet

### Dokumentation

- [x] `README.md` aktuell
- [x] `RELEASE_NOTES.md` auf RC-Hardening angepasst
- [x] `docs/TESTING.md` mit Pflicht-/Optional-Gates aktualisiert
- [x] `HANDOVER.md` Checklisten vollständig

### CI/CD

- [x] Release-Workflow enthält Packaging-Smoke-Schritt
- [x] Build- und Bundle-Schritte sind im Repo vorhanden
- [x] CI-Workflow enthält verpflichtende Gates und Playwright-E2E-Execution
- [ ] Installer-/Live-Runtime-Gates separat abgenommen

---

## RC-Release-Prozess

### 1. Version prüfen

```powershell
node scripts/sync-version.mjs --check
```

### 2. RC-Gates ausführen

```powershell
pnpm check:version
pnpm smoke:packaging
pnpm build
```

### 3. Git Tag erstellen

```powershell
git add .
git commit -m "Release v0.4.0-rc.1"
git tag -a v0.4.0-rc.1 -m "DBZS Codee v0.4.0-rc.1"
git push origin release/0.4.0-rc.1 --tags
```

### 4. GitHub Release erstellen

1. GitHub → Releases → "Create a new release"
2. Tag: `v0.4.0-rc.1`
3. Title: "DBZS Codee v0.4.0-rc.1"
4. Description: Aus `RELEASE_NOTES.md` kopieren
5. "Publish Release"

### 5. Build-Artifakte hochladen

```powershell
pnpm release:win
```

Hochladen zu GitHub Release als Assets.

---

## Release-Prozess

### 1. Version Bump

```powershell
# package.json (root)
# "version": "0.2.0"

# apps/desktop/package.json
# "version": "0.2.0"

# packages/shared/package.json
# "version": "0.2.0"
```

### 2. Git Tag erstellen

```powershell
git add .
git commit -m "Release v0.2.0"
git tag -a v0.2.0 -m "DBZS Codee v0.2.0 - Phase 2B + SSE"
git push origin main --tags
```

### 3. GitHub Release erstellen

1. GitHub → Releases → "Create a new release"
2. Tag: `v0.2.0`
3. Title: "DBZS Codee v0.2.0"
4. Description: Aus `CHANGELOG.md` kopieren
5. "Publish Release"

### 4. Build-Artifakte hochladen

```powershell
# Windows
pnpm release:win

# Mac
pnpm release:mac

# Linux
pnpm release:linux
```

Hochladen zu GitHub Release als Assets.

---

## Nach Release

### Kommunikation

- [ ] Release-Notes im Team-Channel posten
- [ ] CHANGELOG.md Highlights teilen
- [ ] Demo-Termin vereinbaren (optional)

### Monitoring

- [ ] CI-Grün nach Release prüfen
- [ ] Issue-Tracker beobachten (Bugs?)
- [ ] Download-Zahlen tracken (optional)

### Retrospective

- [ ] Was lief gut?
- [ ] Was kann besser werden?
- [ ] Nächste Release planen

---

## Hotfix-Prozess

Bei kritischen Bugs nach Release:

1. Hotfix-Branch von Tag erstellen: `git checkout -b hotfix/v0.2.1 v0.2.0`
2. Fix implementieren + testen
3. Version auf `0.2.1` bumpen
4. Release wie oben
5. Hotfix auf `main` mergen

---

## Versionierung

**Schema:** `MAJOR.MINOR.PATCH`

- **Major (0.x.0 → 1.x.0):** Breaking Changes
- **Minor (0.1.0 → 0.2.0):** Neue Features
- **Patch (0.2.0 → 0.2.1):** Bugfixes

**Nächstes Release:** v0.3.0 (Phase 2C+ Autonomous Loop)

---

**Letztes Update:** 2026-06-17  
**Nächster Release-Termin:** Nach Phase 2C.1 Abschluss
