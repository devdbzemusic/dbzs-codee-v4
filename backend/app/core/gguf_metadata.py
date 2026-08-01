"""
Real GGUF binary metadata reader (Plan 14, Phase 0.1).

Both the legacy model index (`app/models/index_service.py`) and Model Lab
(`app/model_lab/analyzer.py`) previously only guessed architecture/quantization
from filenames or HF-style `config.json` sidecars - GGUF files rarely ship one.
This reads the actual GGUF key/value metadata block that every real GGUF file
carries, giving authoritative architecture/quantization/context data instead.

Only the header + KV metadata block is read - never the tensor data itself, and
STRING/ARRAY values we don't need (e.g. the tokenizer vocabulary, which can hold
tens of thousands of entries) are skipped via `seek()` rather than decoded, so
this stays fast even on multi-GB files.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

GGUF_MAGIC = b"GGUF"

_GGUF_TYPE_UINT8 = 0
_GGUF_TYPE_INT8 = 1
_GGUF_TYPE_UINT16 = 2
_GGUF_TYPE_INT16 = 3
_GGUF_TYPE_UINT32 = 4
_GGUF_TYPE_INT32 = 5
_GGUF_TYPE_FLOAT32 = 6
_GGUF_TYPE_BOOL = 7
_GGUF_TYPE_STRING = 8
_GGUF_TYPE_ARRAY = 9
_GGUF_TYPE_UINT64 = 10
_GGUF_TYPE_INT64 = 11
_GGUF_TYPE_FLOAT64 = 12

_FIXED_SIZE_TYPES: dict[int, str] = {
    _GGUF_TYPE_UINT8: "<B",
    _GGUF_TYPE_INT8: "<b",
    _GGUF_TYPE_UINT16: "<H",
    _GGUF_TYPE_INT16: "<h",
    _GGUF_TYPE_UINT32: "<I",
    _GGUF_TYPE_INT32: "<i",
    _GGUF_TYPE_FLOAT32: "<f",
    _GGUF_TYPE_BOOL: "<B",
    _GGUF_TYPE_UINT64: "<Q",
    _GGUF_TYPE_INT64: "<q",
    _GGUF_TYPE_FLOAT64: "<d",
}

# ggml_ftype "mostly" quantization values, as written into the GGUF
# "general.file_type" metadata key by llama.cpp's converters/quantizer.
QUANT_FILE_TYPE_MAP: dict[int, str] = {
    0: "F32",
    1: "F16",
    2: "Q4_0",
    3: "Q4_1",
    7: "Q8_0",
    8: "Q5_0",
    9: "Q5_1",
    10: "Q2_K",
    11: "Q3_K_S",
    12: "Q3_K_M",
    13: "Q3_K_L",
    14: "Q4_K_S",
    15: "Q4_K_M",
    16: "Q5_K_S",
    17: "Q5_K_M",
    18: "Q6_K",
    19: "IQ2_XXS",
    20: "IQ2_XS",
    21: "Q2_K_S",
    22: "IQ3_XS",
    23: "IQ3_XXS",
    24: "IQ1_S",
    25: "IQ4_NL",
    26: "IQ3_S",
    27: "IQ3_M",
    28: "IQ2_S",
    29: "IQ2_M",
    30: "IQ4_XS",
    31: "IQ1_M",
    32: "BF16",
    34: "TQ1_0",
    35: "TQ2_0",
}

_MAX_KV_COUNT = 100_000
_MAX_ARRAY_LEN = 5_000_000
_MAX_STRING_LEN = 10_000_000

# Keys whose values are actually decoded; everything else is skipped without
# materializing its content.
_WANTED_SCALAR_KEYS = {"general.architecture", "general.name", "general.file_type"}
_WANTED_SUFFIXES = (".context_length", ".embedding_length", ".block_count")


@dataclass
class GgufMetadata:
    architecture: str | None
    name: str | None
    quantization: str | None
    context_length: int | None
    embedding_length: int | None
    block_count: int | None


class _GgufParseError(Exception):
    pass


def _read_exact(handle: BinaryIO, size: int) -> bytes:
    data = handle.read(size)
    if len(data) != size:
        raise _GgufParseError(f"Unexpected EOF, wanted {size} bytes, got {len(data)}")
    return data


def _read_uint32(handle: BinaryIO) -> int:
    return struct.unpack("<I", _read_exact(handle, 4))[0]


def _read_uint64(handle: BinaryIO) -> int:
    return struct.unpack("<Q", _read_exact(handle, 8))[0]


def _read_gguf_string(handle: BinaryIO) -> str:
    length = _read_uint64(handle)
    if length > _MAX_STRING_LEN:
        raise _GgufParseError(f"Implausible string length {length}")
    return _read_exact(handle, length).decode("utf-8", errors="replace")


def _skip_gguf_string(handle: BinaryIO) -> None:
    length = _read_uint64(handle)
    if length > _MAX_STRING_LEN:
        raise _GgufParseError(f"Implausible string length {length}")
    if handle.seek(length, 1) < 0:
        raise _GgufParseError("Seek past string failed")


def _read_scalar_value(handle: BinaryIO, value_type: int) -> object:
    if value_type == _GGUF_TYPE_STRING:
        return _read_gguf_string(handle)
    fmt = _FIXED_SIZE_TYPES.get(value_type)
    if fmt is None:
        raise _GgufParseError(f"Unsupported GGUF value type {value_type}")
    value = struct.unpack(fmt, _read_exact(handle, struct.calcsize(fmt)))[0]
    return bool(value) if value_type == _GGUF_TYPE_BOOL else value


def _skip_scalar_value(handle: BinaryIO, value_type: int) -> None:
    if value_type == _GGUF_TYPE_STRING:
        _skip_gguf_string(handle)
        return
    fmt = _FIXED_SIZE_TYPES.get(value_type)
    if fmt is None:
        raise _GgufParseError(f"Unsupported GGUF value type {value_type}")
    handle.seek(struct.calcsize(fmt), 1)


def _skip_array_value(handle: BinaryIO) -> None:
    array_type = _read_uint32(handle)
    array_len = _read_uint64(handle)
    if array_len > _MAX_ARRAY_LEN:
        raise _GgufParseError(f"Implausible array length {array_len}")
    if array_type == _GGUF_TYPE_ARRAY:
        raise _GgufParseError("Nested arrays are not supported")
    for _ in range(array_len):
        _skip_scalar_value(handle, array_type)


def read_gguf_metadata(path: Path) -> GgufMetadata | None:
    """Reads a .gguf file's header + KV metadata block and extracts
    architecture/quantization/context data. Returns None on any parse failure
    (missing file, wrong magic, truncated/corrupt header, unsupported value
    type) so callers can fall back to their existing filename heuristics -
    this must never raise.
    """
    try:
        with path.open("rb") as handle:
            if _read_exact(handle, len(GGUF_MAGIC)) != GGUF_MAGIC:
                return None
            version = _read_uint32(handle)
            if version < 2:
                # v1 used 32-bit counts; real-world files today are v2/v3.
                return None
            _read_uint64(handle)  # tensor_count - not needed here
            kv_count = _read_uint64(handle)
            if kv_count > _MAX_KV_COUNT:
                return None

            collected: dict[str, object] = {}
            for _ in range(kv_count):
                key = _read_gguf_string(handle)
                value_type = _read_uint32(handle)
                if value_type == _GGUF_TYPE_ARRAY:
                    _skip_array_value(handle)
                    continue
                wants_value = key in _WANTED_SCALAR_KEYS or key.endswith(_WANTED_SUFFIXES)
                if wants_value:
                    collected[key] = _read_scalar_value(handle, value_type)
                else:
                    _skip_scalar_value(handle, value_type)
    except (_GgufParseError, OSError, struct.error, OverflowError):
        return None

    architecture_raw = collected.get("general.architecture")
    architecture = str(architecture_raw) if architecture_raw is not None else None
    name_raw = collected.get("general.name")
    name = str(name_raw) if name_raw is not None else None

    quantization: str | None = None
    file_type = collected.get("general.file_type")
    if isinstance(file_type, int) and not isinstance(file_type, bool):
        quantization = QUANT_FILE_TYPE_MAP.get(file_type, f"TYPE_{file_type}")

    context_length = _as_int(collected.get(f"{architecture}.context_length")) if architecture else None
    embedding_length = _as_int(collected.get(f"{architecture}.embedding_length")) if architecture else None
    block_count = _as_int(collected.get(f"{architecture}.block_count")) if architecture else None

    return GgufMetadata(
        architecture=architecture,
        name=name,
        quantization=quantization,
        context_length=context_length,
        embedding_length=embedding_length,
        block_count=block_count,
    )


def _as_int(value: object) -> int | None:
    return int(value) if isinstance(value, int) and not isinstance(value, bool) else None
