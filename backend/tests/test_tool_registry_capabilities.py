from pathlib import Path
from unittest.mock import patch

from app.runtime.tool_registry import RuntimeToolRegistry


_FULL_HELP_TEXT = """
usage: llama-server [options]

options:
  --ctx-size N         size of the prompt context
  --gpu-layers N       number of layers to store in VRAM
  --threads N          number of threads to use
  --batch-size N       logical maximum batch size
  --ubatch-size N      physical maximum batch size
  --parallel N         number of parallel sequences
  --cache-type-k TYPE  KV cache data type for K
  --cache-type-v TYPE  KV cache data type for V
  --cache-reuse N      min chunk size to attempt reusing from cache
  --prompt-cache FILE  file to cache prompt state
"""

_PARTIAL_HELP_TEXT = """
usage: llama-server [options]

options:
  --ctx-size N         size of the prompt context
  --gpu-layers N       number of layers to store in VRAM
  --threads N          number of threads to use
"""


def _make_registry(tmp_path: Path, tool_path: Path) -> RuntimeToolRegistry:
    return RuntimeToolRegistry(search_paths=[str(tmp_path)], allow_system_path=False)


def test_detect_capabilities_finds_all_flags_when_present(tmp_path: Path) -> None:
    tool_path = tmp_path / "llama-server.exe"
    tool_path.write_text("fake binary", encoding="utf-8")
    registry = _make_registry(tmp_path, tool_path)

    with patch("app.runtime.tool_registry.subprocess.run") as mock_run:
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = _FULL_HELP_TEXT

        capabilities = registry.detect_capabilities()

    assert capabilities.supports_batch_size is True
    assert capabilities.supports_ubatch_size is True
    assert capabilities.supports_cache_type_k is True
    assert capabilities.supports_cache_type_v is True
    assert capabilities.supports_cache_reuse is True
    assert capabilities.supports_prompt_cache is True


def test_detect_capabilities_reports_missing_flags(tmp_path: Path) -> None:
    tool_path = tmp_path / "llama-server.exe"
    tool_path.write_text("fake binary", encoding="utf-8")
    registry = _make_registry(tmp_path, tool_path)

    with patch("app.runtime.tool_registry.subprocess.run") as mock_run:
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = _PARTIAL_HELP_TEXT

        capabilities = registry.detect_capabilities()

    assert capabilities.supports_batch_size is False
    assert capabilities.supports_cache_type_k is False
    assert capabilities.supports_prompt_cache is False


def test_detect_capabilities_finds_flags_beyond_top_ten_help_lines(tmp_path: Path) -> None:
    """The generic _get_tool_commands parse caps at 10 lines; detect_capabilities must not."""
    tool_path = tmp_path / "llama-server.exe"
    tool_path.write_text("fake binary", encoding="utf-8")
    registry = _make_registry(tmp_path, tool_path)

    padding = "\n".join(f"  --unrelated-flag-{i} N   filler option" for i in range(20))
    help_text = f"usage: llama-server [options]\n\noptions:\n{padding}\n  --cache-type-k TYPE  KV cache data type for K\n"

    with patch("app.runtime.tool_registry.subprocess.run") as mock_run:
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = help_text

        capabilities = registry.detect_capabilities()
        commands = registry._get_tool_commands("llama-server", str(tool_path))

    assert capabilities.supports_cache_type_k is True
    assert not any(cmd.name == "cache-type-k" for cmd in commands)  # confirms the gap this fixes


def test_detect_capabilities_returns_all_false_when_tool_not_found(tmp_path: Path) -> None:
    registry = RuntimeToolRegistry(search_paths=[str(tmp_path)], allow_system_path=False)

    capabilities = registry.detect_capabilities()

    assert capabilities.supports_batch_size is False
    assert capabilities.supports_cache_reuse is False


def test_detect_capabilities_caches_result_until_force_refresh(tmp_path: Path) -> None:
    tool_path = tmp_path / "llama-server.exe"
    tool_path.write_text("fake binary", encoding="utf-8")
    registry = _make_registry(tmp_path, tool_path)

    with patch("app.runtime.tool_registry.subprocess.run") as mock_run:
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = _FULL_HELP_TEXT
        registry.detect_capabilities()
        registry.detect_capabilities()
        assert mock_run.call_count == 1

        registry.detect_capabilities(force_refresh=True)
        assert mock_run.call_count == 2
