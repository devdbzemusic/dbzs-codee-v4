"""Workspace context pack builder for agent workflows."""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from app.core.context_policy import default_context_excluded_directories, is_default_context_excluded
from app.context_pack.models import ContextPackBuildRequest, ContextPackBuildResponse, RepoMap, RepoMapFile, RepoMapSymbol
from app.rag.service import estimate_tokens

IGNORED_DIRS = set(default_context_excluded_directories()) | {
    ".venv",
    "out",
    ".pytest_cache",
    "__pycache__",
}

MARKER_FILES = {
    "package.json": "node",
    "pnpm-lock.yaml": "node",
    "pyproject.toml": "python",
    "requirements.txt": "python",
    "Cargo.toml": "rust",
    "CMakeLists.txt": "cmake",
    "build.gradle": "android",
    "build.gradle.kts": "android",
    "tauri.conf.json": "tauri",
    "electron.vite.config.ts": "electron",
    "vite.config.ts": "vite",
    "fastapi": "python-fastapi",
}

TODO_PATTERN = re.compile(r"\b(TODO|FIXME|HACK|XXX)\b[: ]?(.*)", re.IGNORECASE)
BINARY_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".zip",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".woff",
    ".woff2",
}
SECRET_FILE_NAMES = {".env", ".env.local", ".env.production", ".npmrc", ".pypirc"}
CONFIG_FILE_NAMES = {
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "vitest.config.ts",
    "pyproject.toml",
    "pytest.ini",
    "ruff.toml",
}
IMPORT_PATTERN = re.compile(r"^\s*import\s+(?:.+?\s+from\s+)?['\"]([^'\"]+)['\"]|^\s*from\s+([\w.]+)\s+import\s+", re.MULTILINE)
EXPORT_PATTERN = re.compile(r"^\s*export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type)\s+([A-Za-z_$][\w$]*)", re.MULTILINE)
SYMBOL_PATTERN = re.compile(
    r"^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type)\s+([A-Za-z_$][\w$]*)|"
    r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=",
    re.MULTILINE,
)


@dataclass
class ContextPackFragment:
    name: str
    title: str
    body: str
    priority: int
    pinned: bool = False
    keep_when_empty: bool = False


class ContextPackService:
    def build(
        self,
        request: ContextPackBuildRequest,
        *,
        tokenizer: Callable[[str], int] | None = None,
    ) -> ContextPackBuildResponse:
        root = Path(request.workspace_root).resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError("workspace_root existiert nicht oder ist kein Verzeichnis.")

        files: list[Path] = []
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if _is_ignored(path, root):
                continue
            files.append(path)
            if len(files) >= request.max_files * 3:
                break

        files.sort(key=lambda item: (len(item.parts), str(item)))
        selected = files[: request.max_files]

        detected: set[str] = set()
        package_files: list[str] = []
        test_files: list[str] = []
        important_files: list[str] = []
        source_sample: list[str] = []
        todo_markers: list[str] = []
        risk_notes: list[str] = []

        for path in selected:
            rel = str(path.relative_to(root)).replace("\\", "/")
            name = path.name.lower()
            if name in MARKER_FILES or any(marker in rel for marker in MARKER_FILES):
                for marker, stack in MARKER_FILES.items():
                    if marker in rel or name == marker:
                        detected.add(stack)
                package_files.append(rel)
                important_files.append(rel)
            if "test" in rel.lower() or rel.endswith("_test.py") or ".test." in rel:
                test_files.append(rel)
            if path.suffix.lower() in {".ts", ".tsx", ".py", ".rs", ".kt", ".java", ".md", ".cpp", ".h"}:
                source_sample.append(rel)
            if name in {"readme.md", "agents.md", "handover.md"}:
                important_files.append(rel)

            if path.suffix.lower() in BINARY_EXTENSIONS:
                continue
            try:
                raw = path.read_bytes()
            except OSError:
                continue
            if b"\0" in raw[:1024]:
                continue
            text = raw[: request.max_bytes_per_file].decode("utf-8", errors="ignore")
            for match in TODO_PATTERN.finditer(text):
                snippet = match.group(2).strip()[:120]
                todo_markers.append(f"{rel}: {match.group(1).upper()} {snippet}".strip())
                if len(todo_markers) >= 30:
                    break

        if (root / "node_modules").exists():
            risk_notes.append("node_modules present — excluded from scan")
        if (root / ".env").exists():
            risk_notes.append(".env detected — do not expose secrets to agents")
        if not package_files:
            risk_notes.append("No package manifest detected")

        detected.update(_infer_stack_from_tree(root, selected))
        recommended = _recommended_commands(detected)
        repo_map = _build_repo_map(root, selected, request.repo_map_token_budget, request.max_bytes_per_file)
        important = sorted(set(important_files))[:30]
        packages = sorted(set(package_files))[:20]
        tests = sorted(set(test_files))[:20]
        source_sample = sorted(set(source_sample))[:30]
        detected_stack = sorted(detected)
        token_counter = tokenizer or estimate_tokens

        fragments = self._build_fragments(
            project_name=root.name,
            request=request,
            detected=detected_stack,
            important=important,
            package_files=packages,
            test_files=tests,
            source_sample=source_sample,
            todo_markers=todo_markers[:30],
            risk_notes=risk_notes,
            recommended=recommended,
            repo_map=repo_map,
        )
        shrink_result = _shrink_fragments_to_budget(
            fragments,
            token_counter=token_counter,
            token_budget=request.target_token_budget,
        )
        trimmed = shrink_result["trimmed"]
        markdown = _render_markdown(root.name, trimmed)
        final_token_count = token_counter(markdown)

        return ContextPackBuildResponse(
            project_name=root.name,
            detected_stack=trimmed["detected_stack"],
            important_files=trimmed["important_files"],
            package_files=trimmed["package_files"],
            test_files=trimmed["test_files"],
            source_files_sample=trimmed["source_files_sample"],
            todo_markers=trimmed["todo_markers"],
            risk_notes=trimmed["risk_notes"],
            recommended_commands=trimmed["recommended_commands"],
            markdown_context=markdown,
            repo_map=repo_map,
            metadata={
                "scanned_files": len(selected),
                "workspace_root": str(root),
                "tokenizer_slot_id": request.tokenizer_slot_id,
                "target_token_budget": request.target_token_budget,
                "fragment_token_counts": shrink_result["fragment_token_counts"],
                "dropped_fragments": shrink_result["dropped_fragments"],
                "dropped_items": shrink_result["dropped_items"],
                "pre_shrink_token_estimate": shrink_result["pre_shrink_tokens"],
                "post_shrink_token_estimate": final_token_count,
                "budget_fit": final_token_count <= request.target_token_budget,
            },
        )

    def _build_fragments(
        self,
        *,
        project_name: str,
        request: ContextPackBuildRequest,
        detected: list[str],
        important: list[str],
        package_files: list[str],
        test_files: list[str],
        source_sample: list[str],
        todo_markers: list[str],
        risk_notes: list[str],
        recommended: list[str],
        repo_map: RepoMap,
    ) -> list[ContextPackFragment]:
        repo_summary_lines = [
            f"files: {len(repo_map.files)}",
            f"entry_points: {', '.join(repo_map.entry_points[:10]) or '-'}",
            f"config_files: {', '.join(repo_map.config_files[:10]) or '-'}",
            f"git_status: {', '.join(repo_map.git_status[:10]) or '-'}",
            f"truncated: {repo_map.truncated}",
        ]
        return [
            ContextPackFragment("user_request", "User Request", request.user_request, 100, pinned=True),
            ContextPackFragment("active_file", "Active File", str(request.active_file_path or "-"), 95, pinned=True, keep_when_empty=True),
            ContextPackFragment("detected_stack", "Detected Stack", _join_lines(detected), 85, pinned=True),
            ContextPackFragment("important_files", "Important Files", _join_lines(important[:20]), 90, pinned=True),
            ContextPackFragment("package_files", "Package / Build Files", _join_lines(package_files[:15]), 75),
            ContextPackFragment("test_files", "Test Files", _join_lines(test_files[:15]), 60),
            ContextPackFragment("source_files_sample", "Source Sample", _join_lines(source_sample[:20]), 55),
            ContextPackFragment("todo_markers", "TODO / FIXME", _join_lines(todo_markers[:20]), 70),
            ContextPackFragment("risk_notes", "Risk Notes", _join_lines(risk_notes[:20]), 88, pinned=True),
            ContextPackFragment("recommended_commands", "Recommended Commands", _join_lines([f"`{item}`" for item in recommended]), 65),
            ContextPackFragment("repo_map", "Repository Map", _join_lines(repo_summary_lines), 68, pinned=True),
        ]


def _is_ignored(path: Path, root: Path) -> bool:
    rel_parts = path.relative_to(root).parts
    if is_default_context_excluded(path.relative_to(root)) or any(part in IGNORED_DIRS for part in rel_parts):
        return True
    if path.name.lower() in SECRET_FILE_NAMES:
        return True
    return path.suffix.lower() in {".pem", ".key", ".p12", ".pfx", ".sqlite", ".db"}


def _language_for_path(path: Path) -> str:
    suffix = path.suffix.lower()
    return {
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "javascript",
        ".jsx": "javascript",
        ".py": "python",
        ".md": "markdown",
        ".json": "json",
        ".toml": "toml",
        ".yaml": "yaml",
        ".yml": "yaml",
    }.get(suffix, suffix.lstrip(".") or "text")


def _is_test_file(rel: str) -> bool:
    lowered = rel.lower()
    return "test" in lowered or lowered.endswith("_test.py") or ".spec." in lowered


def _is_config_file(path: Path) -> bool:
    return path.name in CONFIG_FILE_NAMES or path.name.lower().endswith((".config.js", ".config.ts", ".ini"))


def _extract_imports(text: str) -> list[str]:
    imports: list[str] = []
    for match in IMPORT_PATTERN.finditer(text):
        value = match.group(1) or match.group(2)
        if value and value not in imports:
            imports.append(value)
        if len(imports) >= 30:
            break
    return imports


def _extract_exports(text: str) -> list[str]:
    exports: list[str] = []
    for match in EXPORT_PATTERN.finditer(text):
        value = match.group(1)
        if value and value not in exports:
            exports.append(value)
        if len(exports) >= 30:
            break
    return exports


def _line_number(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def _extract_symbols(text: str) -> list[RepoMapSymbol]:
    symbols: list[RepoMapSymbol] = []
    for match in SYMBOL_PATTERN.finditer(text):
        name = match.group(1) or match.group(2)
        if not name:
            continue
        line = match.group(0).strip()
        if "class" in line:
            kind = "class"
        elif "interface" in line:
            kind = "interface"
        elif "type" in line:
            kind = "type"
        elif "function" in line:
            kind = "function"
        else:
            kind = "variable"
        symbols.append(RepoMapSymbol(name=name, kind=kind, line=_line_number(text, match.start())))
        if len(symbols) >= 40:
            break
    return symbols


def _git_status(root: Path) -> list[str]:
    try:
        completed = subprocess.run(
            ["git", "-C", str(root), "status", "--short"],
            check=False,
            capture_output=True,
            text=True,
            timeout=3,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if completed.returncode != 0:
        return []
    return [line for line in completed.stdout.splitlines() if line.strip()][:100]


def _build_repo_map(root: Path, files: list[Path], token_budget: int, max_bytes_per_file: int) -> RepoMap:
    repo_files: list[RepoMapFile] = []
    config_files: list[str] = []
    test_files: list[str] = []
    entry_points: list[str] = []
    estimated_tokens = 0
    truncated = False

    for path in files:
        rel = str(path.relative_to(root)).replace("\\", "/")
        if path.suffix.lower() in BINARY_EXTENSIONS:
            continue

        size_bytes = path.stat().st_size
        file_token_estimate = max(1, size_bytes // 4)
        if estimated_tokens + file_token_estimate > token_budget:
            truncated = True
            break

        try:
            raw = path.read_bytes()[:max_bytes_per_file]
        except OSError:
            continue
        if b"\0" in raw[:1024]:
            continue
        text = raw.decode("utf-8", errors="ignore")
        is_test = _is_test_file(rel)
        is_config = _is_config_file(path)
        if is_test:
            test_files.append(rel)
        if is_config:
            config_files.append(rel)
        if path.name in {"main.py", "index.ts", "index.tsx", "App.tsx", "package.json"}:
            entry_points.append(rel)

        repo_files.append(
            RepoMapFile(
                path=rel,
                language=_language_for_path(path),
                size_bytes=size_bytes,
                imports=_extract_imports(text),
                exports=_extract_exports(text),
                symbols=_extract_symbols(text),
                is_test=is_test,
                is_config=is_config,
                truncated=size_bytes > max_bytes_per_file,
            )
        )
        estimated_tokens += file_token_estimate

    return RepoMap(
        root_name=root.name,
        files=repo_files,
        entry_points=sorted(set(entry_points)),
        config_files=sorted(set(config_files)),
        test_files=sorted(set(test_files)),
        git_status=_git_status(root),
        token_budget=token_budget,
        estimated_tokens=estimated_tokens,
        truncated=truncated,
    )


def _infer_stack_from_tree(root: Path, files: list[Path]) -> set[str]:
    stacks: set[str] = set()
    if (root / "apps" / "desktop").exists():
        stacks.add("electron")
    if (root / "backend" / "app" / "main.py").exists():
        stacks.add("python-fastapi")
    for path in files:
        if path.suffix.lower() in {".tsx", ".jsx"}:
            stacks.add("react")
        if path.suffix.lower() in {".ts", ".tsx"}:
            stacks.add("typescript")
        if path.suffix.lower() == ".py":
            stacks.add("python")
        if path.suffix.lower() == ".rs":
            stacks.add("rust")
        if path.name == "CMakeLists.txt":
            stacks.add("cmake")
        if path.suffix.lower() == ".md":
            stacks.add("markdown")
    return stacks


def _recommended_commands(stacks: set[str]) -> list[str]:
    commands: list[str] = []
    if "node" in stacks or "typescript" in stacks:
        commands.extend(["pnpm install", "pnpm test", "pnpm build"])
    if "python" in stacks or "python-fastapi" in stacks:
        commands.extend(["cd backend && uv sync", "cd backend && uv run pytest"])
    if not commands:
        commands.append("# No standard commands detected")
    return commands


def _bullet_lines(items: object) -> list[str]:
    if not items:
        return ["- (none)"]
    return [f"- {item}" for item in items]  # type: ignore[union-attr]


def _join_lines(items: list[str]) -> str:
    if not items:
        return "- (none)"
    return "\n".join(f"- {item}" for item in items)


def _shrink_fragment_body(fragment: ContextPackFragment, token_budget: int, token_counter: Callable[[str], int]) -> str:
    body = fragment.body.strip() or "- (none)"
    if token_budget <= 0:
        return "- (none)" if fragment.keep_when_empty else ""
    if token_counter(body) <= token_budget:
        return body
    lines = [line for line in body.splitlines() if line.strip()]
    kept: list[str] = []
    for line in lines:
        candidate = "\n".join([*kept, line])
        if token_counter(candidate) > token_budget and kept:
            break
        if token_counter(candidate) > token_budget:
            break
        kept.append(line)
    if kept:
        return "\n".join(kept)
    if fragment.pinned or fragment.keep_when_empty:
        shortened = body[: max(32, min(len(body), token_budget * 4))]
        return shortened if shortened else "- (none)"
    return ""


def _render_markdown(project_name: str, sections: dict[str, list[str] | str]) -> str:
    lines = [
        f"# Context Pack: {project_name}",
        "",
        "## User Request",
        str(sections["user_request"]),
        "",
        "## Active File",
        str(sections["active_file"] or "-"),
        "",
        "## Detected Stack",
        *_bullet_lines(sections["detected_stack"]),
        "",
        "## Important Files",
        *_bullet_lines(sections["important_files"]),
        "",
        "## Package / Build Files",
        *_bullet_lines(sections["package_files"]),
        "",
        "## Test Files",
        *_bullet_lines(sections["test_files"]),
        "",
        "## Source Sample",
        *_bullet_lines(sections["source_files_sample"]),
        "",
        "## TODO / FIXME",
        *_bullet_lines(sections["todo_markers"]),
        "",
        "## Risk Notes",
        *_bullet_lines(sections["risk_notes"]),
        "",
        "## Recommended Commands",
        *_bullet_lines(sections["recommended_commands"]),
        "",
        "## Repository Map",
        *_bullet_lines(sections["repo_map"]),
    ]
    return "\n".join(lines)


def _lines_to_items(body: str) -> list[str]:
    items: list[str] = []
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("- "):
            items.append(stripped[2:])
        else:
            items.append(stripped)
    return items


def _shrink_fragments_to_budget(
    fragments: list[ContextPackFragment],
    *,
    token_counter: Callable[[str], int],
    token_budget: int,
) -> dict[str, object]:
    fragment_token_counts = {fragment.name: token_counter(fragment.body) for fragment in fragments}
    pre_shrink_tokens = sum(fragment_token_counts.values())
    remaining = token_budget
    kept_bodies: dict[str, str] = {}
    dropped_fragments: list[str] = []
    dropped_items: dict[str, int] = {}

    for fragment in sorted(fragments, key=lambda item: (-int(item.pinned), -item.priority)):
        min_reserve = max(24, min(fragment_token_counts[fragment.name], token_budget // 8 or 24))
        budget_for_fragment = remaining if remaining > 0 else min_reserve
        if fragment.pinned:
            budget_for_fragment = max(min_reserve, budget_for_fragment)
        body = _shrink_fragment_body(fragment, budget_for_fragment, token_counter)
        if not body:
            dropped_fragments.append(fragment.name)
            dropped_items[fragment.name] = len(_lines_to_items(fragment.body))
            continue
        kept_bodies[fragment.name] = body
        remaining = max(0, remaining - token_counter(body))
        original_items = _lines_to_items(fragment.body)
        kept_items = _lines_to_items(body)
        if len(kept_items) < len(original_items):
            dropped_items[fragment.name] = len(original_items) - len(kept_items)

    trimmed = {
        "user_request": kept_bodies.get("user_request", fragments[0].body),
        "active_file": kept_bodies.get("active_file", "-"),
        "detected_stack": _lines_to_items(kept_bodies.get("detected_stack", "- (none)")),
        "important_files": _lines_to_items(kept_bodies.get("important_files", "- (none)")),
        "package_files": _lines_to_items(kept_bodies.get("package_files", "- (none)")),
        "test_files": _lines_to_items(kept_bodies.get("test_files", "- (none)")),
        "source_files_sample": _lines_to_items(kept_bodies.get("source_files_sample", "- (none)")),
        "todo_markers": _lines_to_items(kept_bodies.get("todo_markers", "- (none)")),
        "risk_notes": _lines_to_items(kept_bodies.get("risk_notes", "- (none)")),
        "recommended_commands": _lines_to_items(kept_bodies.get("recommended_commands", "- (none)")),
        "repo_map": _lines_to_items(kept_bodies.get("repo_map", "- (none)")),
    }
    return {
        "trimmed": trimmed,
        "fragment_token_counts": fragment_token_counts,
        "dropped_fragments": dropped_fragments,
        "dropped_items": dropped_items,
        "pre_shrink_tokens": pre_shrink_tokens,
    }
