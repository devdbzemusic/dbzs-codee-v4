"""Background GGUF download via huggingface_hub."""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable


@dataclass
class DownloadTask:
    id: str
    repo_id: str
    filename: str
    dest_dir: str
    state: str = "pending"   # pending | running | completed | failed
    progress: float = 0.0    # 0–100
    error: str | None = None
    local_path: str | None = None


class DownloadService:
    def __init__(self) -> None:
        self._tasks: dict[str, DownloadTask] = {}
        self._lock = threading.Lock()

    def start_download(self, repo_id: str, filename: str, dest_dir: str) -> DownloadTask:
        task_id = uuid.uuid4().hex[:12]
        task = DownloadTask(id=task_id, repo_id=repo_id, filename=filename, dest_dir=dest_dir)
        with self._lock:
            self._tasks[task_id] = task
        thread = threading.Thread(target=self._run, args=(task,), daemon=True)
        thread.start()
        return task

    def get_task(self, task_id: str) -> DownloadTask | None:
        with self._lock:
            return self._tasks.get(task_id)

    def list_tasks(self) -> list[DownloadTask]:
        with self._lock:
            return list(self._tasks.values())

    def _run(self, task: DownloadTask) -> None:
        try:
            from huggingface_hub import hf_hub_download  # type: ignore[import-untyped]
            task.state = "running"
            dest = Path(task.dest_dir)
            dest.mkdir(parents=True, exist_ok=True)

            local = hf_hub_download(
                repo_id=task.repo_id,
                filename=task.filename,
                local_dir=str(dest),
            )
            task.local_path = local
            task.progress = 100.0
            task.state = "completed"
        except Exception as exc:
            task.state = "failed"
            task.error = str(exc)


_download_service = DownloadService()


def get_download_service() -> DownloadService:
    return _download_service
