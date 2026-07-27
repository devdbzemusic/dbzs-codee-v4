"""
P2 Phase 5: Runtime Tool Registry

Discovers and manages available llama-server tools:
- llama-server: Main inference engine
- llama-cli: Command-line interface for model operations
- llama-bench: Performance benchmarking tool
- llama-tokenize: Tokenization utility

Provides version detection, command discovery, and availability checking.
"""

from __future__ import annotations

import subprocess
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Optional

from app.runtime.schemas import (
    LlamaRuntimeCapabilities,
    ToolInfo,
    ToolCommand,
    ToolName,
    RuntimeToolRegistry as RuntimeToolRegistrySchema,
    ToolStatus,
)

# Exact flag names to probe for in `llama-server --help`, independent of the
# generic top-10-lines parse in _get_tool_commands (which is display-only and
# may not include these flags if they appear further down in --help output).
_PROBED_FLAGS: dict[str, str] = {
    "--batch-size": "supports_batch_size",
    "--ubatch-size": "supports_ubatch_size",
    "--cache-type-k": "supports_cache_type_k",
    "--cache-type-v": "supports_cache_type_v",
    "--cache-reuse": "supports_cache_reuse",
    "--prompt-cache": "supports_prompt_cache",
}


class RuntimeToolRegistry:
    """Discovers and caches runtime tools."""

    TOOLS: list[ToolName] = ["llama-server", "llama-cli", "llama-bench", "llama-tokenize"]

    def __init__(
        self,
        search_paths: Optional[list[str]] = None,
        allow_system_path: bool = True,
    ):
        """
        Initialize tool registry.

        Args:
            search_paths: Additional paths to search for tools. Defaults to PATH.
            allow_system_path: If False, only searches provided search_paths (P1 Req 10).
        """
        self.search_paths = search_paths or []
        self.allow_system_path = allow_system_path
        self._registry: Optional[RuntimeToolRegistrySchema] = None
        self._discovered_paths: dict[ToolName, str] = {}
        self._capabilities: Optional[LlamaRuntimeCapabilities] = None

    def discover_tools(self, force_refresh: bool = False) -> RuntimeToolRegistrySchema:
        """
        Discover available tools.

        Returns cached registry unless force_refresh=True.
        """
        if self._registry and not force_refresh:
            return self._registry

        registry = RuntimeToolRegistrySchema()

        for tool_name in self.TOOLS:
            tool_info = self._discover_tool(tool_name)
            registry.tools[tool_name] = tool_info

        registry.timestamp = datetime.now(UTC).isoformat()
        self._registry = registry
        return registry

    def _discover_tool(self, tool_name: ToolName) -> ToolInfo:
        """Discover a single tool."""
        try:
            path = self._find_tool(tool_name)
            if not path:
                return ToolInfo(
                    name=tool_name,
                    status="not_found",
                    error_message=f"Tool '{tool_name}' not found in PATH or search paths",
                )

            # Get version
            version = self._get_tool_version(tool_name, path)

            # Get available commands
            commands = self._get_tool_commands(tool_name, path)

            self._discovered_paths[tool_name] = path

            return ToolInfo(
                name=tool_name,
                status="available",
                path=path,
                version=version,
                available_commands=commands,
            )

        except Exception as e:
            return ToolInfo(
                name=tool_name,
                status="error",
                error_message=str(e),
            )

    def _find_tool(self, tool_name: str) -> Optional[str]:
        """Find tool in PATH or search paths."""
        from shutil import which

        # Only try system PATH if allowed
        if self.allow_system_path:
            path = which(tool_name)
            if path:
                return path

        # Try search paths
        for search_path in self.search_paths:
            tool_path = Path(search_path) / tool_name
            if tool_path.exists() and tool_path.is_file():
                return str(tool_path)

            # On Windows, try with .exe extension
            tool_exe = Path(search_path) / f"{tool_name}.exe"
            if tool_exe.exists() and tool_exe.is_file():
                return str(tool_exe)

        return None

    def _get_tool_version(self, tool_name: str, tool_path: str) -> Optional[str]:
        """Extract version from tool."""
        try:
            result = subprocess.run(
                [tool_path, "--version"],
                capture_output=True,
                text=True,
                timeout=5,
            )

            if result.returncode == 0:
                version_text = result.stdout.strip()
                # Try to extract version number
                match = re.search(r"(\d+\.\d+\.\d+|\d+\.\d+)", version_text)
                if match:
                    return match.group(1)
                return version_text

            # Fallback: try help output
            result = subprocess.run(
                [tool_path, "--help"],
                capture_output=True,
                text=True,
                timeout=5,
            )

            if result.returncode == 0:
                # Some tools report version in help
                first_line = result.stdout.split("\n")[0]
                match = re.search(r"(\d+\.\d+\.\d+|\d+\.\d+)", first_line)
                if match:
                    return match.group(1)

            return None

        except Exception:
            return None

    def _get_tool_commands(self, tool_name: str, tool_path: str) -> list[ToolCommand]:
        """Extract available commands from tool help."""
        try:
            result = subprocess.run(
                [tool_path, "--help"],
                capture_output=True,
                text=True,
                timeout=5,
            )

            if result.returncode != 0:
                return []

            # Parse help output to find common commands
            commands = []
            help_text = result.stdout

            # For llama-server: parse options like --model, --port, etc.
            for line in help_text.split("\n"):
                # Look for lines starting with --
                if line.strip().startswith("--"):
                    parts = line.split()
                    if parts:
                        cmd_name = parts[0].lstrip("-")
                        description = " ".join(parts[1:]) if len(parts) > 1 else ""

                        commands.append(
                            ToolCommand(
                                name=cmd_name,
                                description=description,
                            )
                        )

            # Return top 10 most relevant commands
            return commands[:10]

        except Exception:
            return []

    def detect_capabilities(self, force_refresh: bool = False) -> LlamaRuntimeCapabilities:
        """Probe `llama-server --help` for specific flag names.

        Independent of _get_tool_commands' generic, capped (top-10) parse —
        scans the full --help text so flags appearing anywhere in the output
        are detected, not just the first 10 `--`-prefixed lines.
        """
        if self._capabilities is not None and not force_refresh:
            return self._capabilities

        path = self._find_tool("llama-server")
        if not path:
            self._capabilities = LlamaRuntimeCapabilities()
            return self._capabilities

        try:
            result = subprocess.run(
                [path, "--help"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            help_text = result.stdout if result.returncode == 0 else ""
        except Exception:
            help_text = ""

        flags_present = {flag: flag in help_text for flag in _PROBED_FLAGS}
        self._capabilities = LlamaRuntimeCapabilities(
            **{attr: flags_present[flag] for flag, attr in _PROBED_FLAGS.items()}
        )
        return self._capabilities

    def get_registry(self) -> RuntimeToolRegistrySchema:
        """Get current registry (discover if not cached)."""
        if self._registry is None:
            return self.discover_tools()
        return self._registry

    def is_tool_available(self, tool_name: ToolName) -> bool:
        """Check if a tool is available."""
        registry = self.get_registry()
        tool = registry.get_tool(tool_name)
        return tool is not None and tool.status == "available"

    def get_tool_path(self, tool_name: ToolName) -> Optional[str]:
        """Get path to tool if available."""
        return self._discovered_paths.get(tool_name)

    def refresh(self) -> RuntimeToolRegistrySchema:
        """Force refresh tool discovery."""
        return self.discover_tools(force_refresh=True)
