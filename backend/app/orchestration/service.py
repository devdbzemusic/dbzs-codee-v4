from __future__ import annotations

from pathlib import Path
from app.core.workspace_paths import resolve_workspace_path
from urllib import error, request

from app.orchestration.models import (
    ContextPrepareRequest,
    ContextPrepareResponse,
    OrchestrationWorkItem,
    ToolCapability,
    ToolExecutionRequest,
    ToolExecutionResponse,
    ToolCatalogResponse,
)


class OrchestrationService:
    def list_tools(self) -> ToolCatalogResponse:
        return ToolCatalogResponse(tools=_default_tools())

    def prepare_context(self, request: ContextPrepareRequest) -> ContextPrepareResponse:
        workspace_name = request.workspace.project_name or "Workspace"
        summary = (
            f"Intent fuer {workspace_name}: {request.user_request.strip()}"
        )

        decomposition_steps = [
            "1) Intent klassifizieren (Feature, Bugfix, Analyse oder Automatisierung)",
            "2) Aufgabe in kleine Einzelschritte zerlegen",
            "3) Passende Agenten und Modelle je Schritt zuordnen",
            "4) Tools je Schritt bestimmen (Filesystem, Websuche, Screenshot/OCR)",
            "5) Ergebnis pruefen und naechsten Schritt freigeben",
        ]

        hints = [
            f"Aktiver Workspace: {request.workspace.root_path or '-'}",
            f"Aktive Datei: {request.workspace.active_file_path or '-'}",
            f"Indexierte Dateien: {request.workspace.indexed_file_count}",
            (
                "UI-Layout: "
                f"left={'collapsed' if request.ui.left_panel_collapsed else 'open'}, "
                f"right={'collapsed' if request.ui.right_panel_collapsed else 'open'}, "
                f"terminal={'collapsed' if request.ui.terminal_collapsed else 'open'}, "
                f"bottom={request.ui.bottom_panel or '-'}"
            ),
        ]

        suggested_agents = [
            "intender",
            "planner",
            "model_controller",
            "coder",
            "reviewer",
            "tester",
        ]

        work_items = [
            OrchestrationWorkItem(
                id="intent-parse",
                role="intender",
                objective="Nutzerziel klassifizieren und in ausfuehrbare Arbeitspakete zerlegen.",
                tools=["filesystem.list_dir"],
            ),
            OrchestrationWorkItem(
                id="plan-routing",
                role="model_controller",
                objective="Passende Modelle und Ports fuer Chat/Review/Coding/Translation/Reranker zuordnen.",
                depends_on=["intent-parse"],
                tools=["web.fetch_url"],
            ),
            OrchestrationWorkItem(
                id="implement-core",
                role="coder",
                objective="Code-Aenderungen implementieren und lokal verifizieren.",
                depends_on=["plan-routing"],
                tools=["filesystem.read_text", "filesystem.list_dir"],
            ),
            OrchestrationWorkItem(
                id="review-and-test",
                role="reviewer",
                objective="Risiken, Regressionen und Testabdeckung pruefen.",
                depends_on=["implement-core"],
                tools=["filesystem.read_text"],
            ),
        ]

        return ContextPrepareResponse(
            intent_summary=summary,
            decomposition_steps=decomposition_steps,
            context_hints=hints,
            suggested_agents=suggested_agents,
            work_items=work_items,
            tool_capabilities=_default_tools(),
        )

    def execute_tool(self, request_payload: ToolExecutionRequest) -> ToolExecutionResponse:
        tool = _tool_by_id(request_payload.tool_id)
        if tool is None:
            return ToolExecutionResponse(
                tool_id=request_payload.tool_id,
                scope=request_payload.scope,
                status="error",
                message="Tool unbekannt.",
            )

        if request_payload.scope not in tool.scopes:
            return ToolExecutionResponse(
                tool_id=request_payload.tool_id,
                scope=request_payload.scope,
                status="error",
                message="Scope nicht erlaubt fuer dieses Tool.",
            )

        if request_payload.tool_id == "filesystem.list_dir":
            return _exec_filesystem_list_dir(request_payload)
        if request_payload.tool_id == "filesystem.read_text":
            return _exec_filesystem_read_text(request_payload)
        if request_payload.tool_id == "filesystem.write_text":
            return _exec_filesystem_write_text(request_payload)
        if request_payload.tool_id == "web.fetch_url":
            return _exec_web_fetch(request_payload)
        if request_payload.tool_id == "vision.screenshot_text":
            # Bisher wurde hier faelschlich status="ok" zurueckgegeben, obwohl keine
            # echte OCR/Vision-Verarbeitung stattfindet. Ein aufrufender Agent koennte
            # das als erfolgreiche Text-Extraktion missverstehen. Ehrlicher Fehlerstatus,
            # bis ein echtes Vision-Backend angebunden ist.
            return ToolExecutionResponse(
                tool_id=request_payload.tool_id,
                scope=request_payload.scope,
                status="error",
                message=(
                    "Vision-Adapter ist vorbereitet, aber es ist noch kein OCR/Vision-Backend "
                    "angebunden. Dieses Tool fuehrt aktuell keine echte Text-Extraktion durch."
                ),
            )

        return ToolExecutionResponse(
            tool_id=request_payload.tool_id,
            scope=request_payload.scope,
            status="error",
            message="Tool-Handler nicht implementiert.",
        )


def _default_tools() -> list[ToolCapability]:
    return [
        ToolCapability(
            id="filesystem.list_dir",
            category="filesystem",
            description="Listet Verzeichnisse innerhalb des Workspace-Scope sicher auf.",
            scopes=["read"],
        ),
        ToolCapability(
            id="filesystem.read_text",
            category="filesystem",
            description="Liest Textdateien innerhalb des Workspace-Scope mit Byte-Limit.",
            scopes=["read"],
        ),
        ToolCapability(
            id="filesystem.write_text",
            category="filesystem",
            description="Schreibt eine Textdatei innerhalb des Workspace-Scope (max 512KB). Erstellt Verzeichnisse automatisch.",
            scopes=["write"],
        ),
        ToolCapability(
            id="web.fetch_url",
            category="web",
            description="Ruft Webinhalte fuer Referenzen/API-Dokumentation mit Timeout und URL-Validierung ab.",
            scopes=["network"],
        ),
        ToolCapability(
            id="vision.screenshot_text",
            category="vision",
            description="(Noch nicht implementiert) Vorgesehen fuer Screenshot-/Bildanalyse mit Text-Extraktion; aktuell ohne echtes OCR/Vision-Backend angebunden.",
            scopes=["vision"],
        ),
    ]


def _tool_by_id(tool_id: str) -> ToolCapability | None:
    for tool in _default_tools():
        if tool.id == tool_id:
            return tool
    return None


def _resolve_safe_path(workspace_root: str | None, candidate: str | None) -> Path:
    if not workspace_root:
        raise ValueError("workspace_root ist erforderlich.")
    if not candidate:
        raise ValueError("Pfad fehlt.")

    return resolve_workspace_path(workspace_root, candidate, allow_missing=True)


def _exec_filesystem_list_dir(request_payload: ToolExecutionRequest) -> ToolExecutionResponse:
    try:
        target = _resolve_safe_path(
            request_payload.workspace_root,
            str(request_payload.params.get("path") or request_payload.workspace_root),
        )
        if not target.exists() or not target.is_dir():
            raise ValueError("Verzeichnis nicht gefunden.")

        entries = sorted(item.name for item in target.iterdir())[:200]
        return ToolExecutionResponse(
            tool_id=request_payload.tool_id,
            scope=request_payload.scope,
            status="ok",
            message="Verzeichnis gelistet.",
            output={"path": str(target), "entries": entries},
        )
    except Exception as exc:
        return ToolExecutionResponse(
            tool_id=request_payload.tool_id,
            scope=request_payload.scope,
            status="error",
            message=str(exc),
        )


def _exec_filesystem_read_text(request_payload: ToolExecutionRequest) -> ToolExecutionResponse:
    try:
        target = _resolve_safe_path(request_payload.workspace_root, str(request_payload.params.get("path") or ""))
        if not target.exists() or not target.is_file():
            raise ValueError("Datei nicht gefunden.")

        limit = int(request_payload.params.get("max_bytes") or 16384)
        limit = max(256, min(limit, 262144))
        text = target.read_text(encoding="utf-8", errors="replace")[:limit]
        return ToolExecutionResponse(
            tool_id=request_payload.tool_id,
            scope=request_payload.scope,
            status="ok",
            message="Datei gelesen.",
            output={"path": str(target), "content": text, "truncated": len(text) >= limit},
        )
    except Exception as exc:
        return ToolExecutionResponse(
            tool_id=request_payload.tool_id,
            scope=request_payload.scope,
            status="error",
            message=str(exc),
        )


def _exec_filesystem_write_text(request_payload: ToolExecutionRequest) -> ToolExecutionResponse:
    try:
        target = _resolve_safe_path(request_payload.workspace_root, str(request_payload.params.get("path") or ""))
        content = str(request_payload.params.get("content") or "")
        if len(content.encode("utf-8")) > 524_288:
            raise ValueError("Inhalt ueberschreitet 512KB Limit.")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return ToolExecutionResponse(
            tool_id=request_payload.tool_id,
            scope=request_payload.scope,
            status="ok",
            message=f"Datei geschrieben: {target.name}",
            output={"path": str(target), "bytes_written": len(content.encode("utf-8"))},
        )
    except Exception as exc:
        return ToolExecutionResponse(
            tool_id=request_payload.tool_id,
            scope=request_payload.scope,
            status="error",
            message=str(exc),
        )


def _exec_web_fetch(request_payload: ToolExecutionRequest) -> ToolExecutionResponse:
    try:
        url = str(request_payload.params.get("url") or "").strip()
        if not (url.startswith("http://") or url.startswith("https://")):
            raise ValueError("Nur http/https URLs sind erlaubt.")

        req = request.Request(url, headers={"user-agent": "DBZS-Orchestration/1.0"}, method="GET")
        with request.urlopen(req, timeout=8) as response:
            body = response.read(32768).decode("utf-8", errors="replace")
            return ToolExecutionResponse(
                tool_id=request_payload.tool_id,
                scope=request_payload.scope,
                status="ok",
                message="URL erfolgreich abgerufen.",
                output={"url": url, "status_code": int(response.status), "content": body},
            )
    except error.URLError as exc:
        return ToolExecutionResponse(
            tool_id=request_payload.tool_id,
            scope=request_payload.scope,
            status="error",
            message=f"Netzwerkfehler: {exc}",
        )
    except Exception as exc:
        return ToolExecutionResponse(
            tool_id=request_payload.tool_id,
            scope=request_payload.scope,
            status="error",
            message=str(exc),
        )
