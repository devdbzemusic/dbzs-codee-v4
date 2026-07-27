"""
Multi-Server Manager: Orchestrates simultaneous startup and monitoring of multiple model servers.
Handles resource allocation, task routing, and performance monitoring.
"""

from __future__ import annotations

import asyncio
import time
from typing import Optional, AsyncGenerator
from dataclasses import dataclass, field
from datetime import datetime

try:
    import psutil  # type: ignore[import-not-found]
except ModuleNotFoundError:
    psutil = None

from app.runtime.service import RuntimeService
from app.runtime.schemas import RuntimeStatus, RuntimeState
from app.models.profiles import ServerProfile, ModelInstance, TaskType
from app.models.profile_service import ProfileService


@dataclass
class ServerHealthMetrics:
    """Health and performance metrics for a running server."""
    model_id: str
    timestamp: datetime = field(default_factory=datetime.utcnow)
    state: RuntimeState = "stopped"
    
    # CPU usage
    cpu_percent: float = 0.0
    
    # Memory usage
    memory_mb: float = 0.0
    memory_percent: float = 0.0
    
    # GPU usage (if available)
    gpu_memory_mb: Optional[float] = None
    gpu_memory_percent: Optional[float] = None
    
    # Response time
    last_response_time_ms: Optional[float] = None
    avg_response_time_ms: float = 0.0
    
    # Error tracking
    error_count: int = 0
    last_error: Optional[str] = None
    
    def is_healthy(self, cpu_threshold: float = 90, memory_threshold: float = 95) -> bool:
        """Check if server is within acceptable resource thresholds."""
        return (
            self.state == "running"
            and self.cpu_percent < cpu_threshold
            and self.memory_percent < memory_threshold
        )


class MultiServerManager:
    """Manages coordinated startup and monitoring of multiple model servers."""

    def __init__(self, runtime_service: RuntimeService, profile_service: ProfileService):
        self.runtime_service = runtime_service
        self.profile_service = profile_service
        self.active_servers: dict[str, RuntimeStatus] = {}
        self.health_metrics: dict[str, ServerHealthMetrics] = {}
        self.monitoring_tasks: dict[str, asyncio.Task] = {}
        self._process_pids: dict[str, int] = {}

    async def start_profile(self, profile: ServerProfile) -> dict[str, RuntimeStatus]:
        """
        Start all models in a profile simultaneously with resource monitoring.
        Returns a dict of {model_id: RuntimeStatus} for all started models.
        """
        print(f"Starting profile: {profile.name}")
        print(f"Models to start: {len(profile.models)}")

        started_models = {}
        tasks = []

        # Start all models concurrently
        for model_instance in profile.models:
            task = asyncio.create_task(
                self._start_single_model(model_instance, profile)
            )
            tasks.append((model_instance.model_id, task))

        # Gather results
        for model_id, task in tasks:
            try:
                status = await task
                started_models[model_id] = status
                self.active_servers[model_id] = status
                self.profile_service.register_model_instance(model_id, status)
                
                # Start health monitoring for this model
                asyncio.create_task(self._monitor_model_health(model_id))
            except Exception as e:
                print(f"Failed to start model {model_id}: {e}")
                started_models[model_id] = RuntimeStatus(
                    state="error",
                    message=str(e),
                )

        return started_models

    async def _start_single_model(self, model_instance: ModelInstance, profile: ServerProfile) -> RuntimeStatus:
        """Start a single model with proper resource configuration."""
        print(f"  Starting {model_instance.model_id} on port {model_instance.port}...")
        
        # Build runtime configuration
        config = {
            "model_id": model_instance.model_id,
            "provider": model_instance.provider,
            "port": model_instance.port,
            "n_gpu_layers": model_instance.gpu_config.n_gpu_layers,
            "n_threads": model_instance.gpu_config.n_threads,
            "context_size": model_instance.context_config.context_size,
            "cache_size_mb": model_instance.context_config.cache_size_mb,
        }

        try:
            status = await asyncio.to_thread(
                self.runtime_service.start_model_with_config,
                model_instance.model_id,
                config,
            )
            
            if status.state == "running" and status.pid:
                self._process_pids[model_instance.model_id] = status.pid
            
            return status
        except Exception as e:
            return RuntimeStatus(
                state="error",
                message=f"Failed to start {model_instance.model_id}: {str(e)}",
            )

    async def stop_profile(self) -> None:
        """Stop all active servers in the current profile."""
        print("Stopping all active servers...")
        
        # Cancel monitoring tasks
        for model_id, task in self.monitoring_tasks.items():
            task.cancel()
        self.monitoring_tasks.clear()

        # Stop servers
        for model_id in list(self.active_servers.keys()):
            try:
                await self._stop_single_model(model_id)
            except Exception as e:
                print(f"Error stopping {model_id}: {e}")

    async def _stop_single_model(self, model_id: str) -> None:
        """Stop a single model server."""
        if pid := self._process_pids.get(model_id):
            try:
                if psutil:
                    process = psutil.Process(pid)
                    process.terminate()
                    await asyncio.sleep(0.5)
                    if process.is_running():
                        process.kill()
                print(f"  Stopped {model_id}")
            except Exception as e:
                print(f"  Error stopping {model_id}: {e}")

        if model_id in self.active_servers:
            del self.active_servers[model_id]
        if model_id in self._process_pids:
            del self._process_pids[model_id]

    async def _monitor_model_health(self, model_id: str) -> None:
        """Continuously monitor health and performance of a model."""
        while model_id in self.active_servers:
            try:
                if pid := self._process_pids.get(model_id):
                    try:
                        if not psutil:
                            await asyncio.sleep(5)
                            continue

                        process = psutil.Process(pid)
                        
                        # CPU and memory
                        cpu_percent = process.cpu_percent(interval=1)
                        mem_info = process.memory_info()
                        memory_mb = mem_info.rss / (1024 * 1024)
                        memory_percent = process.memory_percent()
                        
                        # Update metrics
                        metrics = self.health_metrics.get(model_id)
                        if not metrics:
                            metrics = ServerHealthMetrics(model_id=model_id)
                            self.health_metrics[model_id] = metrics
                        
                        metrics.state = "running"
                        metrics.cpu_percent = cpu_percent
                        metrics.memory_mb = memory_mb
                        metrics.memory_percent = memory_percent
                        metrics.timestamp = datetime.utcnow()
                        
                        # Log warnings if thresholds exceeded
                        if self.profile_service.active_profile:
                            profile = self.profile_service.active_profile
                            if cpu_percent > profile.cpu_threshold_percent:
                                print(f"  ⚠️  {model_id}: CPU {cpu_percent:.1f}% (threshold: {profile.cpu_threshold_percent}%)")
                            if memory_percent > profile.memory_threshold_percent:
                                print(f"  ⚠️  {model_id}: Memory {memory_percent:.1f}% (threshold: {profile.memory_threshold_percent}%)")
                    except Exception:
                        # Process died
                        if model_id in self.active_servers:
                            self.active_servers[model_id].state = "error"
                            if model_id in self._process_pids:
                                del self._process_pids[model_id]
                        break
                
                await asyncio.sleep(5)  # Check every 5 seconds
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Error monitoring {model_id}: {e}")
                await asyncio.sleep(5)

    async def get_profile_health_summary(self) -> dict:
        """Get overall health status of the active profile."""
        if not self.profile_service.active_profile:
            return {"profile": None, "models": {}}

        profile = self.profile_service.active_profile
        models_health = {}

        for model in profile.models:
            status = self.active_servers.get(model.model_id, RuntimeStatus(state="stopped"))
            metrics = self.health_metrics.get(model.model_id, ServerHealthMetrics(model_id=model.model_id, state="stopped"))
            
            models_health[model.model_id] = {
                "status": status.model_dump(),
                "health": {
                    "cpu_percent": metrics.cpu_percent,
                    "memory_mb": metrics.memory_mb,
                    "memory_percent": metrics.memory_percent,
                    "is_healthy": metrics.is_healthy(
                        profile.cpu_threshold_percent,
                        profile.memory_threshold_percent,
                    ),
                    "timestamp": metrics.timestamp.isoformat(),
                },
            }

        return {
            "profile": profile.name,
            "models": models_health,
            "resource_estimates": self.profile_service.estimate_total_resource_usage(),
        }

    def get_model_for_task(self, task_type: TaskType) -> Optional[str]:
        """Get the best model ID for a given task type."""
        if task_type == "review":
            task_type = "code_review"
        model = self.profile_service.get_highest_priority_model_for_task(task_type)
        if model and model.model_id in self.active_servers:
            status = self.active_servers[model.model_id]
            if status.state == "running":
                return model.model_id
        return None

    def get_all_active_models(self) -> dict[str, RuntimeStatus]:
        """Get all active models."""
        return {k: v for k, v in self.active_servers.items() if v.state == "running"}
