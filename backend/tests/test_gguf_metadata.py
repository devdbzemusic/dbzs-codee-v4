"""Tests for the real GGUF binary metadata reader (Plan 14, Phase 0.1).

Builds minimal, valid GGUF byte fixtures by hand instead of needing a real
multi-GB model file - just enough header + KV pairs to exercise the parser.
"""
import struct
from pathlib import Path

from app.core.gguf_metadata import GGUF_MAGIC, read_gguf_metadata


def _gguf_string(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return struct.pack("<Q", len(encoded)) + encoded


def _kv_string(key: str, value: str) -> bytes:
    return _gguf_string(key) + struct.pack("<I", 8) + _gguf_string(value)


def _kv_uint32(key: str, value: int) -> bytes:
    return _gguf_string(key) + struct.pack("<I", 4) + struct.pack("<I", value)


def _kv_string_array(key: str, values: list[str]) -> bytes:
    body = struct.pack("<I", 8) + struct.pack("<Q", len(values))
    for item in values:
        body += _gguf_string(item)
    return _gguf_string(key) + struct.pack("<I", 9) + body


def _build_gguf(kv_entries: list[bytes], *, version: int = 3, tensor_count: int = 0) -> bytes:
    header = GGUF_MAGIC + struct.pack("<I", version) + struct.pack("<Q", tensor_count) + struct.pack("<Q", len(kv_entries))
    return header + b"".join(kv_entries)


def test_read_gguf_metadata_parses_real_fields(tmp_path: Path) -> None:
    kv = [
        _kv_string("general.architecture", "llama"),
        _kv_string("general.name", "Test Model"),
        _kv_uint32("general.file_type", 15),
        _kv_uint32("llama.context_length", 4096),
        _kv_uint32("llama.embedding_length", 4096),
        _kv_uint32("llama.block_count", 32),
    ]
    path = tmp_path / "test.gguf"
    path.write_bytes(_build_gguf(kv))

    metadata = read_gguf_metadata(path)

    assert metadata is not None
    assert metadata.architecture == "llama"
    assert metadata.name == "Test Model"
    assert metadata.quantization == "Q4_K_M"
    assert metadata.context_length == 4096
    assert metadata.embedding_length == 4096
    assert metadata.block_count == 32


def test_read_gguf_metadata_skips_large_string_arrays(tmp_path: Path) -> None:
    kv = [
        _kv_string("general.architecture", "qwen2"),
        _kv_string_array("tokenizer.ggml.tokens", [f"tok_{i}" for i in range(5000)]),
        _kv_uint32("qwen2.context_length", 32768),
    ]
    path = tmp_path / "test.gguf"
    path.write_bytes(_build_gguf(kv))

    metadata = read_gguf_metadata(path)

    assert metadata is not None
    assert metadata.architecture == "qwen2"
    assert metadata.context_length == 32768


def test_read_gguf_metadata_unknown_file_type_falls_back_to_type_label(tmp_path: Path) -> None:
    kv = [
        _kv_string("general.architecture", "llama"),
        _kv_uint32("general.file_type", 999),
    ]
    path = tmp_path / "test.gguf"
    path.write_bytes(_build_gguf(kv))

    metadata = read_gguf_metadata(path)

    assert metadata is not None
    assert metadata.quantization == "TYPE_999"


def test_read_gguf_metadata_rejects_wrong_magic(tmp_path: Path) -> None:
    path = tmp_path / "not-gguf.gguf"
    path.write_bytes(b"NOPE" + b"\x00" * 20)

    assert read_gguf_metadata(path) is None


def test_read_gguf_metadata_handles_truncated_file(tmp_path: Path) -> None:
    path = tmp_path / "truncated.gguf"
    # Header claims 5 KV pairs but the file ends immediately after.
    path.write_bytes(GGUF_MAGIC + struct.pack("<I", 3) + struct.pack("<Q", 0) + struct.pack("<Q", 5))

    assert read_gguf_metadata(path) is None


def test_read_gguf_metadata_rejects_v1_files(tmp_path: Path) -> None:
    path = tmp_path / "v1.gguf"
    path.write_bytes(_build_gguf([], version=1))

    assert read_gguf_metadata(path) is None


def test_read_gguf_metadata_returns_none_for_missing_file(tmp_path: Path) -> None:
    assert read_gguf_metadata(tmp_path / "does-not-exist.gguf") is None


def test_read_gguf_metadata_handles_no_metadata(tmp_path: Path) -> None:
    path = tmp_path / "empty-metadata.gguf"
    path.write_bytes(_build_gguf([]))

    metadata = read_gguf_metadata(path)

    assert metadata is not None
    assert metadata.architecture is None
    assert metadata.quantization is None
    assert metadata.context_length is None
