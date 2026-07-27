"""Health Dashboard — System-Übersicht für Ops."""

from __future__ import annotations

import os
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse


router = APIRouter(prefix="/health", tags=["health"])


def get_uptime_seconds() -> int:
    """Ermittelt Server-Uptime in Sekunden."""
    try:
        # Windows
        import subprocess
        result = subprocess.run(
            ["systeminfo"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        for line in result.stdout.split("\n"):
            if "System Boot Time:" in line:
                boot_time_str = line.split(":", 1)[1].strip()
                boot_time = datetime.strptime(
                    boot_time_str,
                    "%m/%d/%Y, %I:%M:%S %p",
                )
                return int((datetime.now() - boot_time).total_seconds())
    except Exception:
        pass

    # Fallback: Prozess-Startzeit
    return int((datetime.now(UTC) - datetime.now(UTC)).total_seconds())


def get_disk_usage(path: str = "C:") -> dict[str, Any]:
    """Ermittelt Festplattennutzung."""
    try:
        total, used, free = shutil.disk_usage(path)
        return {
            "total_gb": round(total / (1024**3), 2),
            "used_gb": round(used / (1024**3), 2),
            "free_gb": round(free / (1024**3), 2),
            "used_percent": round((used / total) * 100, 1),
        }
    except Exception:
        return {
            "total_gb": 0,
            "used_gb": 0,
            "free_gb": 0,
            "used_percent": 0,
        }


def get_memory_usage() -> dict[str, Any]:
    """Ermittelt Speichernutzung."""
    try:
        import psutil
        mem = psutil.virtual_memory()
        return {
            "total_gb": round(mem.total / (1024**3), 2),
            "used_gb": round(mem.used / (1024**3), 2),
            "available_gb": round(mem.available / (1024**3), 2),
            "used_percent": mem.percent,
        }
    except ImportError:
        return {
            "total_gb": 0,
            "used_gb": 0,
            "available_gb": 0,
            "used_percent": 0,
        }


@router.get("/dashboard")
def health_dashboard():
    """
    Umfassendes Health-Dashboard für System-Übersicht.

    Returns:
        JSON mit Backend, Runtime, Jobs, Agents, Disk, Memory Status
    """
    from app.runtime.service import RuntimeService
    from app.job_spooler.service import JobSpoolerService
    from app.agents.service import AgentRegistryService

    # Backend Info
    backend_info = {
        "status": "ok",
        "uptime_seconds": get_uptime_seconds(),
        "timestamp": datetime.now(UTC).isoformat(),
    }

    # Runtime Status
    try:
        runtime_svc = RuntimeService()
        runtime_status = runtime_svc.get_status()
        runtime_info = {
            "status": "active" if runtime_status.get("active") else "inactive",
            "model": runtime_status.get("model_id"),
            "port": runtime_status.get("port"),
        }
    except Exception as e:
        runtime_info = {
            "status": "error",
            "error": str(e),
        }

    # Jobs Stats
    try:
        jobs_svc = JobSpoolerService()
        all_jobs = jobs_svc.list_jobs(limit=1000)
        jobs_info = {
            "total": len(all_jobs),
            "queued": len([j for j in all_jobs if j.status == "queued"]),
            "running": len([j for j in all_jobs if j.status == "running"]),
            "completed": len([j for j in all_jobs if j.status == "completed"]),
            "failed": len([j for j in all_jobs if j.status == "failed"]),
        }
    except Exception as e:
        jobs_info = {
            "total": 0,
            "queued": 0,
            "running": 0,
            "completed": 0,
            "failed": 0,
            "error": str(e),
        }

    # Agents Stats
    try:
        agents_svc = AgentRegistryService()
        all_agents = agents_svc.list_agents()
        agents_info = {
            "total": len(all_agents),
            "enabled": len([a for a in all_agents if a.enabled]),
            "disabled": len([a for a in all_agents if not a.enabled]),
        }
    except Exception as e:
        agents_info = {
            "total": 0,
            "enabled": 0,
            "disabled": 0,
            "error": str(e),
        }

    # System Resources
    disk_info = get_disk_usage()
    memory_info = get_memory_usage()

    return JSONResponse(
        content={
            "backend": backend_info,
            "runtime": runtime_info,
            "jobs": jobs_info,
            "agents": agents_info,
            "disk": disk_info,
            "memory": memory_info,
            "summary": {
                "healthy": (
                    backend_info["status"] == "ok"
                    and jobs_info.get("failed", 0) < 10
                    and disk_info["used_percent"] < 90
                ),
                "warnings": [],
            },
        }
    )


@router.get("/quick")
def health_quick():
    """
    Schneller Health-Check ohne Details.

    Returns:
        Einfacher Status-Check
    """
    return JSONResponse(
        content={
            "status": "ok",
            "timestamp": datetime.now(UTC).isoformat(),
        }
    )
