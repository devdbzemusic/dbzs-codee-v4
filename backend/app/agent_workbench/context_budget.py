"""Per-step context budget tracking."""

from __future__ import annotations

from dataclasses import dataclass, field


DEFAULT_MAX_TOTAL_BYTES = 64_000
DEFAULT_MAX_FILE_BYTES = 16_384
DEFAULT_MAX_FILES = 20
DEFAULT_MAX_SEARCH_MATCHES = 50


@dataclass
class ContextBudget:
    """Tracks consumed context budget for a single step."""

    max_total_bytes: int = DEFAULT_MAX_TOTAL_BYTES
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES
    max_files: int = DEFAULT_MAX_FILES
    max_search_matches: int = DEFAULT_MAX_SEARCH_MATCHES
    used_bytes: int = 0
    files_read: set[str] = field(default_factory=set)
    search_matches: int = 0
    priority_paths: list[str] = field(default_factory=list)

    def can_read_file(self, path: str, byte_size: int) -> tuple[bool, str]:
        if path in self.files_read:
            return True, ""
        if len(self.files_read) >= self.max_files:
            return False, f"Max files ({self.max_files}) reached"
        effective = min(byte_size, self.max_file_bytes)
        if self.used_bytes + effective > self.max_total_bytes:
            return False, f"Total budget ({self.max_total_bytes} bytes) exceeded"
        return True, ""

    def record_file_read(self, path: str, bytes_consumed: int) -> None:
        self.files_read.add(path)
        self.used_bytes += min(bytes_consumed, self.max_file_bytes)

    def can_search(self, match_count: int) -> tuple[bool, str]:
        if self.search_matches + match_count > self.max_search_matches:
            return False, f"Search match limit ({self.max_search_matches}) exceeded"
        return True, ""

    def record_search(self, match_count: int) -> None:
        self.search_matches += match_count

    def summary(self) -> dict[str, int | list[str]]:
        return {
            "used_bytes": self.used_bytes,
            "max_total_bytes": self.max_total_bytes,
            "files_read_count": len(self.files_read),
            "max_files": self.max_files,
            "search_matches": self.search_matches,
            "max_search_matches": self.max_search_matches,
            "priority_paths": list(self.priority_paths),
        }

    def clamp_read_range(
        self,
        start_line: int,
        end_line: int,
        max_lines: int = 500,
    ) -> tuple[int, int]:
        start = max(1, start_line)
        end = max(start, end_line)
        if end - start + 1 > max_lines:
            end = start + max_lines - 1
        return start, end
