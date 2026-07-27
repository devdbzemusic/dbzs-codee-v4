# DBZS Codee — API Reference

**Auto-generierte OpenAPI/Swagger Dokumentation**

## Endpoints

### Health & Settings

| Method | Endpoint | Beschreibung |
|--------|----------|--------------|
| GET | `/health` | Backend-Health-Check |
| GET | `/settings` | Einstellungen lesen |
| PUT | `/settings` | Einstellungen schreiben |

### Models & Runtime

| Method | Endpoint | Beschreibung |
|--------|----------|--------------|
| GET | `/models/index` | Modell-Index (lokal + Ollama) |
| GET | `/runtime/status` | Runtime-Status |
| POST | `/runtime/start` | Runtime starten |
| POST | `/runtime/stop` | Runtime stoppen |
| POST | `/runtime/chat` | Chat gegen Runtime |

### Jobs & Agents

| Method | Endpoint | Beschreibung |
|--------|----------|--------------|
| GET | `/job-spooler` | Jobs auflisten |
| POST | `/job-spooler/enqueue` | Job einreihen |
| POST | `/job-spooler/claim` | Job claimen |
| POST | `/job-spooler/waypoint` | Waypoint speichern |
| GET | `/job-spooler/stream` | SSE-Live-Stream |
| GET | `/agents` | Agent Registry |
| POST | `/agents/{id}/start` | Agent starten |
| POST | `/agents/{id}/stop` | Agent stoppen |

### Review Gates (Phase 2C+)

| Method | Endpoint | Beschreibung |
|--------|----------|--------------|
| GET | `/review-gates/pending` | Offene Reviews |
| GET | `/review-gates/{id}` | Review-Details |
| POST | `/review-gates/{id}/approve` | Genehmigen |
| POST | `/review-gates/{id}/reject` | Ablehnen |
| DELETE | `/review-gates/{id}` | Löschen |
| GET | `/review-gates/{id}/auto-apply` | Auto-Apply prüfen |

### Orchestration & Tools

| Method | Endpoint | Beschreibung |
|--------|----------|--------------|
| GET | `/orchestration/tools` | Verfügbare Tools |
| POST | `/orchestration/execute` | Tool ausführen |
| POST | `/context-pack/build` | Workspace-Kontext |

### Project Memory & Tasks

| Method | Endpoint | Beschreibung |
|--------|----------|--------------|
| GET | `/project-memory` | Memory-Einträge |
| PUT | `/project-memory` | Eintrag erstellen |
| DELETE | `/project-memory/{id}` | Eintrag löschen |
| GET | `/tasks` | Task-Board |
| POST | `/tasks` | Task erstellen |
| PUT | `/tasks/{id}` | Task updaten |

### Model Profiles

| Method | Endpoint | Beschreibung |
|--------|----------|--------------|
| GET | `/model-profiles/list` | Profile auflisten |
| GET | `/model-profiles/{id}` | Profil-Details |
| POST | `/model-profiles/set-active` | Aktiv setzen |

### Docs Analysis

| Method | Endpoint | Beschreibung |
|--------|----------|--------------|
| GET | `/docs/analyze` | Workspace analysieren |
| POST | `/docs/generate` | Doku generieren |

---

## Interaktive Dokumentation

### Swagger UI

```
http://127.0.0.1:8876/docs
```

### ReDoc

```
http://127.0.0.1:8876/redoc
```

### OpenAPI JSON

```
http://127.0.0.1:8876/openapi.json
```

---

## Beispiele

### Health Check

```bash
curl http://127.0.0.1:8876/health
```

```json
{
  "status": "ok",
  "app": "DBZS Code Assistant",
  "version": "0.2.0"
}
```

### Job Enqueue

```bash
curl -X POST http://127.0.0.1:8876/job-spooler/enqueue \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Job",
    "task_type": "coding",
    "priority": 2,
    "assigned_agent_role": "coder"
  }'
```

### Review Gate Approve

```bash
curl -X POST http://127.0.0.1:8876/review-gates/rg-123-1/approve \
  -H "Content-Type: application/json" \
  -d '{
    "reviewed_by": "user@example.com",
    "review_comment": "Looks good"
  }'
```

---

**Generiert:** 2026-06-17  
**OpenAPI Version:** 3.0.0
