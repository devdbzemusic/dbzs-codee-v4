from __future__ import annotations

import subprocess
import threading
from collections import deque
from pathlib import Path

_MAX_TAIL_CHARS = 4096


class _ProcessLogBuffer:
    def __init__(self) -> None:
        self._stderr = deque[str]()
        self._stdout = deque[str]()
        self._lock = threading.Lock()

    def append_stderr(self, chunk: str) -> None:
        if not chunk:
            return
        with self._lock:
            self._stderr.append(chunk)
            self._trim(self._stderr)

    def append_stdout(self, chunk: str) -> None:
        if not chunk:
            return
        with self._lock:
            self._stdout.append(chunk)
            self._trim(self._stdout)

    def stderr_tail(self) -> str:
        with self._lock:
            return "".join(self._stderr)[-_MAX_TAIL_CHARS:]

    def stdout_tail(self) -> str:
        with self._lock:
            return "".join(self._stdout)[-_MAX_TAIL_CHARS:]

    @staticmethod
    def _trim(buffer: deque[str]) -> None:
        combined = "".join(buffer)
        if len(combined) <= _MAX_TAIL_CHARS:
            return
        trimmed = combined[-_MAX_TAIL_CHARS:]
        buffer.clear()
        buffer.append(trimmed)


def _stream_reader(stream, buffer: _ProcessLogBuffer, attr: str) -> None:
    try:
        while True:
            chunk = stream.read(512)
            if not chunk:
                break
            text = chunk.decode("utf-8", errors="replace")
            if attr == "stderr":
                buffer.append_stderr(text)
            else:
                buffer.append_stdout(text)
    finally:
        stream.close()


class CapturingSubprocessRunner:
    def __init__(self) -> None:
        self._buffers: dict[int, _ProcessLogBuffer] = {}

    def start(
        self,
        command: list[str],
        cwd: Path,
        env: dict[str, str] | None = None,
    ) -> subprocess.Popen[str]:
        process = subprocess.Popen(
            command,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
            env=env,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
        )
        buffer = _ProcessLogBuffer()
        self._buffers[process.pid] = buffer

        if process.stderr is not None:
            threading.Thread(
                target=_stream_reader,
                args=(process.stderr, buffer, "stderr"),
                daemon=True,
            ).start()
        if process.stdout is not None:
            threading.Thread(
                target=_stream_reader,
                args=(process.stdout, buffer, "stdout"),
                daemon=True,
            ).start()

        return process

    def stderr_tail(self, process: subprocess.Popen[str]) -> str:
        buffer = self._buffers.get(process.pid)
        return buffer.stderr_tail() if buffer else ""

    def stdout_tail(self, process: subprocess.Popen[str]) -> str:
        buffer = self._buffers.get(process.pid)
        return buffer.stdout_tail() if buffer else ""

    def drain_process(self, process: subprocess.Popen[str]) -> None:
        if process.poll() is None:
            return
        buffer = self._buffers.get(process.pid)
        if buffer is None:
            return
        if process.stderr is not None and not process.stderr.closed:
            remaining = process.stderr.read()
            if remaining:
                buffer.append_stderr(remaining.decode("utf-8", errors="replace"))
        if process.stdout is not None and not process.stdout.closed:
            remaining = process.stdout.read()
            if remaining:
                buffer.append_stdout(remaining.decode("utf-8", errors="replace"))
