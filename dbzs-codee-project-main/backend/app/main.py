import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.agents import router as agents_router
from app.api.agent_runner import router as agent_runner_router
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


def _autostart_orchestrator_runtime() -> None:
    """Best-effort autostart for the orchestrator_cpu (FunctionGemma) slot.

    Net-new: no other slot has an autostart path yet (autoStartChatRuntime/
    autoStartCodingRuntime are unused settings today). Fail-soft by design —
    any error here must not prevent the backend from starting, and there is
    no retry loop (no circuit breaker for this slot yet).
    """
    import logging
    logger = logging.getLogger(__name__)

    try:
        from app.models.discovery_mode import get_model_discovery_mode
        from app.models.index_service import FUNCTIONGEMMA_DEFAULT_PROFILE, ModelIndexService
        from app.settings.service import SettingsService

        settings = SettingsService().load()
        if not settings.autoStartOrchestratorRuntime:
            return

        model_index_service = ModelIndexService(discovery_mode=get_model_discovery_mode())
        model_id = settings.defaultOrchestratorModelId or None

        if not model_id:
            try:
                model_index_service.register_catalog_model_profile(FUNCTIONGEMMA_DEFAULT_PROFILE)
            except Exception as exc:
                logger.warning(f"Orchestrator catalog auto-registration failed: {exc}")

            index = model_index_service.build_index()
            candidates = [m for m in index.models if m.role == "ORCHESTRATOR_MODEL"]
            model_id = candidates[0].id if len(candidates) == 1 else None

        if not model_id:
            logger.info("Orchestrator autostart enabled but no unique FunctionGemma model resolved — skipping.")
            return

        service = get_runtime_service()
        status = service.start_model(model_id, slot_id="orchestrator_cpu")
        if status.state == "running":
            logger.info(f"Orchestrator runtime (FunctionGemma) autostarted on orchestrator_cpu: {model_id}")
        else:
            logger.warning(
                f"Orchestrator runtime autostart did not reach 'running' (state={status.state}): {status.message}"
            )
    except Exception as exc:
        logger.error(f"Orchestrator runtime autostart failed (fail-soft, backend continues): {exc}")
@asynccontextmanager
async def lifespan(app: FastAPI):
    import logging
    logger = logging.getLogger(__name__)
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
