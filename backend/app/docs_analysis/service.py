from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from app.core.context_policy import default_context_excluded_directories
from app.docs_analysis.models import DocsAnalysisSummary, DocsGenerateResponse, ExtensionStat, FileSizeStat

IGNORED_DIRS = set(default_context_excluded_directories()) | {
    ".venv",
    "venv",
    "__pycache__",
}

TEXT_EXTENSIONS = {
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".md",
    ".json",
    ".toml",
    ".yaml",
    ".yml",
    ".css",
    ".html",
}


class DocsAnalysisService:
    def analyze_workspace(self, workspace_root: str, max_files: int = 5) -> DocsAnalysisSummary:
        root = Path(workspace_root).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError(f"Invalid workspace root: {workspace_root}")

        extension_counter: Counter[str] = Counter()
        largest_files: list[tuple[str, int]] = []
        todo_count = 0
        files_scanned = 0
        directories_scanned = 0

        for current_root, dirnames, filenames in _safe_walk(root):
            directories_scanned += 1
            current_path = Path(current_root)
            dirnames[:] = [name for name in dirnames if name not in IGNORED_DIRS]

            for filename in filenames:
                file_path = current_path / filename
                try:
                    stat = file_path.stat()
                except OSError:
                    continue

                files_scanned += 1
                extension = file_path.suffix.lower() or "<none>"
                extension_counter[extension] += 1
                rel_path = str(file_path.relative_to(root))
                largest_files.append((rel_path, stat.st_size))

                if extension in TEXT_EXTENSIONS:
                    todo_count += _count_todos(file_path)

        largest_files.sort(key=lambda item: item[1], reverse=True)
        top_extensions = [
            ExtensionStat(extension=extension, count=count)
            for extension, count in extension_counter.most_common(8)
        ]

        return DocsAnalysisSummary(
            scanned_at=_utc_now(),
            workspace_root=str(root),
            files_scanned=files_scanned,
            directories_scanned=directories_scanned,
            todo_count=todo_count,
            top_extensions=top_extensions,
            largest_files=[
                FileSizeStat(path=path, size_bytes=size) for path, size in largest_files[:max_files]
            ],
        )

    def generate_markdown(self, workspace_root: str, max_files: int = 5) -> DocsGenerateResponse:
        summary = self.analyze_workspace(workspace_root, max_files=max_files)

        extension_lines = "\n".join(
            f"- {item.extension}: {item.count}" for item in summary.top_extensions
        )
        largest_lines = "\n".join(
            f"- {item.path} ({item.size_bytes} bytes)" for item in summary.largest_files
        )

        content = (
            "# Workspace Analysis\n\n"
            f"- Generated at: {summary.scanned_at}\n"
            f"- Root: {summary.workspace_root}\n"
            f"- Files scanned: {summary.files_scanned}\n"
            f"- Directories scanned: {summary.directories_scanned}\n"
            f"- TODO markers: {summary.todo_count}\n\n"
            "## Top Extensions\n"
            f"{extension_lines or '- none'}\n\n"
            "## Largest Files\n"
            f"{largest_lines or '- none'}\n"
        )

        return DocsGenerateResponse(content=content, summary=summary)


def _safe_walk(root: Path):
    for current_root, dirnames, filenames in __import__("os").walk(root):
        yield current_root, dirnames, filenames


def _count_todos(file_path: Path) -> int:
    try:
        text = file_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return 0
    lowered = text.lower()
    return lowered.count("todo") + lowered.count("fixme")


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()
