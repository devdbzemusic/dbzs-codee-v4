# CODEX TASK — Safe Agent Web Search and Research Execution

Repository: `devdbzemusic/dbzs-codee-project`

## Ziel

CODEE soll im Runtime Chat und in Agent Runs kontrollierte Websuchen ausführen können.

Der Agent darf nicht beliebig und intransparent auf das Internet zugreifen. Jeder Webzugriff muss über eine typisierte, nachvollziehbare Research-Pipeline laufen:

```text
Runtime Chat / Agent Run
→ strukturierter Tool Call
→ Query Validation
→ Search Policy
→ Provider Adapter
→ Search Results
→ Fetch ausgewählter Quellen
→ Content Normalization
→ Citation Mapping
→ Ergebnis zurück in Agent Run und Chat
```

Die Websuche muss explizit ausgelöst werden, Quellen offenlegen, Zeitouts besitzen, sensible Daten schützen und Webinhalte als untrusted behandeln.

Keine direkte Browser-Automation als Hauptweg.
Keine unkontrollierten HTTP-Requests aus dem Renderer.
Keine unsichtbare Websuche ohne Audit-Trail.

## 1. Bestehenden Tool-Pfad auditieren

Prüfe mindestens:

```text
apps/desktop/src/services/runtimeChatAgentRunner.ts
apps/desktop/src/services/agentRunService.ts
apps/desktop/src/services/agentWorkbenchService.ts
apps/desktop/src/stores/runtimeChatStore.ts
apps/desktop/electron/main.ts
apps/desktop/electron/preload.ts
packages/shared/src/index.ts
backend/app/runtime/
backend/app/agent_workbench/
backend/app/trajectories/
```

Dokumentiere:

1. Registrierung von Tool Calls
2. Rückgabe strukturierter Tool Results
3. Verknüpfung mit Chat und Agent Run
4. vorhandene HTTP-/Netzwerk-Utilities
5. Secret- und Provider-Konfiguration
6. zentralen Integrationspunkt für Web Research

## 2. Shared Contracts

```ts
export interface AgentWebSearchRequest {
  id: string;
  runId: string;
  query: string;
  purpose: string;
  maxResults: number;
  recencyDays?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  safeSearch: "strict" | "moderate" | "off";
  language?: string;
  region?: string;
  timeoutMs?: number;
  createdAt: string;
}

export interface AgentWebSearchResultItem {
  id: string;
  title: string;
  url: string;
  displayUrl: string;
  snippet: string;
  sourceDomain: string;
  publishedAt?: string;
  rank: number;
}

export interface AgentWebSearchResult {
  requestId: string;
  query: string;
  provider: string;
  status: "succeeded" | "failed" | "cancelled" | "timed_out";
  items: AgentWebSearchResultItem[];
  error?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}
```

Für Quellenabruf:

```ts
export interface AgentWebFetchRequest {
  id: string;
  runId: string;
  url: string;
  purpose: string;
  maxBytes?: number;
  timeoutMs?: number;
  createdAt: string;
}

export interface AgentWebDocument {
  requestId: string;
  url: string;
  finalUrl: string;
  title?: string;
  sourceDomain: string;
  contentType: string;
  text: string;
  extractedAt: string;
  publishedAt?: string;
  author?: string;
  truncated: boolean;
}
```

## 3. Agent Tools

### `web_search`

```json
{
  "name": "web_search",
  "arguments": {
    "query": "latest TypeScript 5.9 migration notes",
    "purpose": "Verify current compiler changes relevant to this repository.",
    "max_results": 5,
    "recency_days": 365,
    "allowed_domains": ["typescriptlang.org", "github.com"],
    "safe_search": "strict",
    "language": "en"
  }
}
```

### `web_fetch`

```json
{
  "name": "web_fetch",
  "arguments": {
    "url": "https://www.typescriptlang.org/docs/",
    "purpose": "Read the official documentation referenced by the search result.",
    "max_bytes": 1000000,
    "timeout_ms": 20000
  }
}
```

## 4. Zentraler Research Service

Implementiere `AgentWebResearchService`.

Verantwortung:

1. Requests validieren
2. Policy anwenden
3. Provider auswählen
4. Search ausführen
5. Ergebnisse normalisieren
6. URLs filtern
7. Quellen abrufen
8. HTML in Text umwandeln
9. Metadaten extrahieren
10. Resultate in Agent Run und Chat zurückgeben
11. Audit-Events speichern

Keine Weblogik direkt im Store oder in UI-Komponenten.

## 5. Provider Adapter

```ts
export interface WebSearchProvider {
  id: string;
  search(
    request: AgentWebSearchRequest,
    signal: AbortSignal
  ): Promise<AgentWebSearchResult>;
}
```

Mögliche Provider:

```text
Brave Search API
Bing Web Search API
Serper
Tavily
SearXNG
lokaler Meta-Search-Proxy
```

Anforderungen:

- Provider austauschbar
- API Keys nur im Host/Backend
- keine Secrets im Renderer
- kein stiller Provider-Wechsel
- Fehler und Quoten zentral behandeln
- Local-First bevorzugen

## 6. Research Policy

```ts
export interface WebResearchPolicy {
  enabled: boolean;
  maxResults: number;
  maxFetchesPerTurn: number;
  maxBytesPerDocument: number;
  maxTotalBytesPerTurn: number;
  defaultTimeoutMs: number;
  allowHttp: boolean;
  allowPrivateNetworks: boolean;
  allowLocalhost: boolean;
  allowedDomains?: string[];
  blockedDomains: string[];
  requireUserApprovalForNetwork: boolean;
}
```

Empfohlene Defaults:

```text
allowHttp: false
allowPrivateNetworks: false
allowLocalhost: false
maxResults: 8
maxFetchesPerTurn: 5
maxBytesPerDocument: 1 MB
maxTotalBytesPerTurn: 4 MB
defaultTimeoutMs: 20 s
```

## 7. SSRF-Schutz

Blockiere:

```text
localhost
127.0.0.0/8
::1
0.0.0.0
169.254.0.0/16
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
fc00::/7
fe80::/10
file://
ftp://
gopher://
data:
javascript:
blob:
chrome:
```

Zusätzlich:

- DNS-Auflösung vor Request prüfen
- Redirect-Ziele erneut prüfen
- keine privaten IPs nach Redirect
- Redirect-Anzahl begrenzen
- standardmäßig nur HTTPS
- keine Credentials in URL
- keine freien Modell-Header

## 8. URL- und Domain-Validierung

Vor jedem Fetch:

1. URL parsen
2. Protokoll prüfen
3. Domain normalisieren
4. IDN/Punycode berücksichtigen
5. Blocklist prüfen
6. Allowlist prüfen
7. DNS/IP prüfen
8. Redirects kontrollieren

Subdomains korrekt behandeln. `github.com.evil.example` darf nicht als `github.com` gelten.

## 9. Content Fetching

Der Fetch-Service muss:

- Timeout und Abort unterstützen
- Content-Length prüfen
- Streaming-Limit erzwingen
- Content-Type prüfen
- Binärinhalte blockieren
- HTML, Text, JSON und XML unterstützen
- keine Skripte ausführen
- keine Cookies oder Browser-Sessions übernehmen
- kein Login automatisieren

Erlaubte Typen zunächst:

```text
text/html
text/plain
application/json
application/xml
text/xml
```

## 10. HTML-Normalisierung

Extrahiere:

```text
Seitentitel
Haupttext
Autor
Veröffentlichungsdatum
Canonical URL
relevante Überschriften
```

Entferne:

```text
Navigation
Werbung
Cookie-Banner
Skripte
Styles
versteckte Inhalte
Boilerplate
```

## 11. Citation Mapping

```ts
export interface AgentCitation {
  id: string;
  sourceUrl: string;
  sourceTitle?: string;
  sourceDomain: string;
  quote?: string;
  startOffset?: number;
  endOffset?: number;
  retrievedAt: string;
}
```

Agentenantworten referenzieren Quellen etwa als `[C1]`, `[C2]`.

Im UI müssen Quellen klickbar sein.

Keine erfundenen URLs.
Keine Citation ohne tatsächlich abgerufene Quelle.

## 12. Runtime-Chat-Anbindung

Benötigte Zustände:

```ts
activeWebSearches
activeWebFetches
webResearchStatus
webResearchError
webResearchCitations
```

Ablauf:

```text
Agent fordert web_search an
→ Search läuft
→ Ergebnisse als Tool Result
→ Agent wählt Quellen
→ web_fetch läuft
→ Dokumente werden normalisiert
→ Agent antwortet mit Citations
→ Chat zeigt Quellenliste
```

## 13. Agent-Run-Anbindung

Events:

```text
WEB_SEARCH_STARTED
WEB_SEARCH_COMPLETED
WEB_FETCH_STARTED
WEB_FETCH_COMPLETED
WEB_RESEARCH_FAILED
```

Speichern:

```text
Query
Purpose
Provider
Ergebnisanzahl
URLs
Dauer
Fehler
Citation IDs
```

Keine Secrets oder sensiblen Header speichern.

## 14. Approval-Modell

Konfigurierbare Modi:

```text
off
ask_once_per_run
ask_every_request
allow_search_only
allow_search_and_fetch
```

Empfohlener Standard:

```text
ask_once_per_run
```

Der Nutzer sieht Query, Purpose, geplante Domains und Ergebnis-/Fetch-Limits.

## 15. Web-Research UI

Keine vollständige Browser-UI bauen.

Kompaktes Research Panel:

```text
Suchanfrage
Zweck
Provider
Status
Ergebnisanzahl
Quellen
Fetch-Status
Dauer
Cancel
```

## 16. Cancel und Timeout

Jede Suche und jeder Fetch benötigt:

- Request-ID
- AbortController
- Timeout
- Cleanup in `finally`

Status:

```text
queued
running
succeeded
failed
cancelled
timed_out
```

Cancel muss echte Netzwerkverbindungen abbrechen.

## 17. Tool Results

Search:

```json
{
  "query": "TypeScript 5.9 release notes",
  "provider": "searxng",
  "items": [
    {
      "title": "TypeScript 5.9",
      "url": "https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html",
      "snippet": "...",
      "source_domain": "typescriptlang.org"
    }
  ]
}
```

Fetch:

```json
{
  "url": "https://...",
  "title": "...",
  "text": "...normalized content...",
  "citation_id": "C1"
}
```

## 18. Coding-Aufgaben

Websuche soll in Coding Runs funktionieren, z. B.:

```text
aktuelle API-Dokumentation
Breaking Changes
CVE-Informationen
Migrationshinweise
Installationsdokumentation
```

Wichtig:

- Webinhalte niemals direkt ausführen
- Installationsbefehle nur als Vorschlag
- Terminalausführung ausschließlich über Safe Command Pipeline
- keine automatische Paketinstallation

## 19. Prompt-Injection-Schutz

Webinhalte sind untrusted input.

Technische Regeln:

- Webdokumente klar als untrusted markieren
- getrennte Tool-Result-Rolle
- keine Übernahme in System Prompt
- enthaltene Tool-Aufrufe ignorieren
- keine Secrets offenlegen
- keine Policy-Änderung durch Webinhalt
- keine Dateiänderung aufgrund von Webseitenanweisungen

## 20. Cache

Optional:

```ts
export interface WebResearchCacheEntry {
  key: string;
  url?: string;
  query?: string;
  provider: string;
  createdAt: string;
  expiresAt: string;
  payload: unknown;
}
```

Kurze TTL, manuell leerbar, keine Secrets, begrenzte Größe.

## 21. Acceptance-Test

Mit Mock-Provider und lokalem HTTP-Testserver:

1. Agent erzeugt `web_search`
2. Policy validiert Request
3. Provider liefert drei Ergebnisse
4. Agent wählt eine Quelle
5. `web_fetch` ruft Testserver ab
6. HTML wird normalisiert
7. Citation wird erzeugt
8. Agent Run erhält Ergebnisse
9. Chat zeigt Antwort mit Citation
10. Audit Events sind vorhanden

SSRF-Test:

```text
Fetch auf http://127.0.0.1/
→ vor Netzwerkzugriff blockieren
```

Testserver nur über expliziten Test-Override erlauben.

## 22. Pflicht-Tests

1. gültige Websuche
2. unbekannter Provider blockiert
3. maxResults begrenzt
4. Timeout
5. Cancel
6. gültiger HTTPS-Fetch
7. HTTP blockiert
8. localhost blockiert
9. private IP blockiert
10. Redirect auf private IP blockiert
11. zu großer Body blockiert
12. Binärinhalt blockiert
13. HTML-Normalisierung
14. echte Citation
15. Prompt Injection als untrusted markiert
16. Resultat im Agent Run
17. Quellen im Chat
18. Approval erzwungen
19. Provider-Key nicht in Logs
20. maxFetchesPerTurn erzwungen

## 23. Testkommando

```powershell
pnpm test:agent-web
```

Der Test muss Search, Fetch, Citation, Cancel, Timeout und SSRF-Schutz prüfen.

## 24. Qualitäts-Gates

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm doctor:all
pnpm smoke-test
pnpm test:capabilities
pnpm test:coding-loop
pnpm test:file-apply
pnpm test:chat-file-apply
pnpm test:agent-shell
pnpm test:agent-web
```

## 25. Definition of Done

Der Nutzer kann schreiben:

```text
Prüfe online die aktuelle offizielle Dokumentation zu dieser Library und passe deinen Lösungsvorschlag daran an.
```

CODEE muss:

1. strukturierte Websuche erzeugen
2. Query und Purpose anzeigen
3. Policy anwenden
4. Ergebnisse liefern
5. offizielle Quellen abrufen
6. Inhalte sicher normalisieren
7. Antwort mit überprüfbaren Quellen erzeugen
8. Quellen im Chat anzeigen
9. Cancel und Timeout unterstützen
10. SSRF und private Netze blockieren
11. Webinhalte als untrusted behandeln
12. Research Events im Agent Run speichern

## 26. Nicht Teil dieser Phase

Nicht umsetzen:

```text
vollwertige Browser-Automation
Login auf Webseiten
CAPTCHA-Umgehung
Formulare absenden
Käufe
automatische Downloads und Installation
private Netzwerke
freie HTTP-Requests durch das Modell
Ausführung von Webcode
```

## 27. Abschlussbericht

Liefern:

1. bestehender Tool-/Agent-Pfad
2. Integrationslücke
3. Provider-Architektur
4. Research Policy
5. SSRF-Schutz
6. geänderte Dateien
7. unterstützte Tools
8. Citation-Nachweis
9. Testresultate
10. bekannte Einschränkungen

Empfohlene Commits:

```text
feat(agent): add web search and fetch contracts
feat(research): add web search provider abstraction
feat(security): enforce web research and ssrf policy
feat(agent): connect web research to runtime chat
feat(ui): show agent web research and citations
test(agent): verify safe web search and fetch
docs(status): document agent web research capability
```
