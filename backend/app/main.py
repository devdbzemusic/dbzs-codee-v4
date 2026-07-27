import asyncio
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.agents import router as agents_router
from app.api.agent_runner import router as agent_runner_router
from app.api.boot_events import router as boot_events_router
from app.api.context_pack import router as context_pack_router
from app.api.context import router as context_router
from app.api.docs_analysis import router as docs_analysis_router
from app.api.health import router as health_router
from app.api.health_dashboard import router as health_dashboard_router

from app.api.job_spooler import router as job_spooler_router
from app.api.models import router as models_router
from app.api.model_profiles import router as model_profiles_router, set_services
from app.api.orchestration import router as orchestration_router
from app.models.download_router import router as download_router
from app.job_spooler.sse_router import router as sse_router
from app.api.project_memory import router as project_memory_router
from app.api.runtime import get_runtime_service, router as runtime_router
from app.api.settings import router as settings_router
from app.api.task_board import router as task_board_router
from app.review_gates.router import router as review_gates_router
from app.agent_workbench.router import router as agent_workbench_router
from app.trajectories.router import router as trajectories_router
from app.rag.router import router as rag_router
from app.runtime.process_cleanup import cleanup_target_ports, terminate_cleanup_candidates

from contextlib import asynccontextmanager
from app.core.config import APP_NAME, APP_VERSION, get_app_data_dir
from app.models.profile_service import ProfileService
from app.runtime.multi_server_manager import MultiServerManager


@asynccontextmanager
async def lifespan(app: FastAPI):
    import logging
    logger = logging.getLogger(__name__)

    await _run_startup_tasks(logger)

    yield
    logger.info("FastAPI backend shutting down. Stopping active runtimes and cleaning up llama-server processes...")
    
    # 1. Stop active model profiles (MultiServerManager)
    try:
        from app.api.model_profiles import _multi_server_manager
        if _multi_server_manager:
            await _multi_server_manager.stop_profile()
    except Exception as exc:
        logger.error(f"Failed to stop active profiles on shutdown: {exc}")
        
    # 2. Stop single model runtime (RuntimeService)
    try:
        from app.api.runtime import get_runtime_service
        service = get_runtime_service()
        if service:
            service.stop_model()
    except Exception as exc:
        logger.error(f"Failed to stop default runtime model on shutdown: {exc}")

    # 3. Terminate any lingering DBZS runtime/backend helper processes on managed ports.
    try:
        terminated = terminate_cleanup_candidates(
            logger,
            current_pid=os.getpid(),
            target_ports=cleanup_target_ports(),
        )
        if terminated:
            logger.info("Shutdown runtime cleanup removed lingering processes: %s", terminated)
    except Exception as exc:
        logger.error(f"Failed to clean up remaining runtime processes on shutdown: {exc}")


async def _run_database_init(logger) -> None:
    """Boot phase 8: database initialized.

    `AgentRegistryService()` must run before `run_all_migrations()` —
    migrations 001/002 do `ALTER TABLE agent_logs`/`agents`, which only
    exist once AgentRegistryService's own idempotent `_init_db()` has
    created them (it targets the same `agents.sqlite3` file
    `run_all_migrations()` migrates by default). Running migrations first
    against a fresh install would crash with "no such table".
    """
    from app.core.boot_state import BootComponentError, get_boot_state_store
    from app.core.migrations import run_all_migrations

    store = get_boot_state_store()
    await store.set_component("database", "running", message="Initializing database...")
    try:
        from app.agents.service import AgentRegistryService

        AgentRegistryService()
        applied = await asyncio.to_thread(run_all_migrations)
        await store.set_component(
            "database", "success", message=f"Database ready ({applied} migration(s) applied)."
        )
    except Exception as exc:
        logger.error(f"Database boot initialization failed: {exc}")
        await store.set_component(
            "database",
            "failed",
            message=str(exc),
            error=BootComponentError(code="database-init-failed", technical_detail=str(exc)),
        )


async def _run_startup_tasks(logger) -> None:
    from app.core.boot_state import BootComponentError, get_boot_state_store
    from app.models.index_startup import run_model_index_startup
    from app.runtime.resident_model_startup import run_resident_model_startup

    store = get_boot_state_store()
    # Set by the desktop process when the user picked "Safe Mode" after a
    # failed boot and asked to restart the backend with it. Database init
    # still runs (the app is unusable without it); model index and resident
    # model are skipped outright -- there is no incremental-scan cache layer
    # to fall back to (see index_service.py), so "skip" is the honest choice
    # here, not a fabricated "loaded from cache" success.
    safe_mode = os.environ.get("DBZS_SAFE_MODE") == "1"

    await _run_database_init(logger)

    if safe_mode:
        asyncio.create_task(run_model_index_startup(store, cache_only=True))
    else:
        # Model index must not block readiness — scheduled, not awaited (spec §8).
        asyncio.create_task(run_model_index_startup(store))

    try:
        get_runtime_service()
        await store.set_component("runtimeManager", "success", message="Runtime manager ready.")
    except Exception as exc:
        logger.error(f"Runtime manager confirmation failed: {exc}")
        await store.set_component(
            "runtimeManager",
            "failed",
            message=str(exc),
            error=BootComponentError(code="runtime-manager-init-failed", technical_detail=str(exc)),
        )

    if safe_mode:
        await store.set_component(
            "residentModel", "skipped", message="Sicherer Modus: kein automatischer Modellstart."
        )
    else:
        # Resident model is optional (spec decision): scheduled in the background,
        # a failure degrades readiness without blocking GET /health/ready.
        asyncio.create_task(run_resident_model_startup(store))


def create_app() -> FastAPI:
    fastapi_app = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan)
    
    # Add CORS middleware
    fastapi_app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    fastapi_app.include_router(health_router)
    fastapi_app.include_router(health_dashboard_router)

    fastapi_app.include_router(settings_router)
    fastapi_app.include_router(models_router)
    fastapi_app.include_router(runtime_router)
    fastapi_app.include_router(agents_router)
    fastapi_app.include_router(project_memory_router)
    fastapi_app.include_router(task_board_router)
    fastapi_app.include_router(review_gates_router)
    fastapi_app.include_router(trajectories_router)
    fastapi_app.include_router(agent_workbench_router)
    fastapi_app.include_router(rag_router)

    fastapi_app.include_router(docs_analysis_router)
    fastapi_app.include_router(job_spooler_router)
    fastapi_app.include_router(agent_runner_router)
    fastapi_app.include_router(context_pack_router)
    fastapi_app.include_router(context_router)
    fastapi_app.include_router(model_profiles_router)
    fastapi_app.include_router(orchestration_router)
    fastapi_app.include_router(download_router)
    fastapi_app.include_router(sse_router)
    fastapi_app.include_router(boot_events_router)

    # Automatically run migrations for Agent Workbench on startup
    try:
        from app.agent_workbench.repository import AgentWorkbenchRepository
        # This will trigger database connection and table checks
        AgentWorkbenchRepository()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error(f"Failed to bootstrap AgentWorkbench database on startup: {exc}")

    profile_service = ProfileService(get_app_data_dir())
    multi_server_manager = MultiServerManager(get_runtime_service(), profile_service)
    set_services(profile_service, multi_server_manager)

    return fastapi_app


app = create_app()
