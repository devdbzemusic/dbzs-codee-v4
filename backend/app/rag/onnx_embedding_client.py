"""
In-process ONNX Runtime embedding client (Plan 14, Phase 2 - first non-llama.cpp/
Ollama runtime adapter).

Unlike `app/runtime/chat_clients.py`'s `LlamaServerChatClient`/`OllamaChatClient`
(HTTP-endpoint-shaped, chat-message-in/text-out), an embedding model runs
in-process: no subprocess, no port, text(s) in, vectors out. This is a
deliberately separate, simpler interface rather than a third implementation of
the chat client shape.

`onnxruntime`/`tokenizers` are optional at import time (mirrors
`app/model_lab/hf_integration.py`'s `HfApi` guard) so importing this module
never crashes even if the packages are somehow missing at runtime.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any

try:
    import onnxruntime  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - exercised when the optional dependency is absent
    onnxruntime = None  # type: ignore[assignment]

try:
    from tokenizers import Tokenizer  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - exercised when the optional dependency is absent
    Tokenizer = None  # type: ignore[assignment]


def onnx_embedding_backend_available() -> bool:
    return onnxruntime is not None and Tokenizer is not None


class OnnxEmbeddingClient:
    def __init__(
        self,
        model_path: Path,
        tokenizer_path: Path,
        *,
        session: Any | None = None,
        tokenizer: Any | None = None,
        max_sequence_length: int = 512,
    ) -> None:
        self.model_path = model_path
        self.tokenizer_path = tokenizer_path
        self.max_sequence_length = max_sequence_length
        self._session = session
        self._tokenizer = tokenizer

    def _ensure_loaded(self) -> None:
        if self._session is None:
            if onnxruntime is None:
                raise RuntimeError("onnxruntime ist nicht installiert.")
            self._session = onnxruntime.InferenceSession(str(self.model_path), providers=["CPUExecutionProvider"])
        if self._tokenizer is None:
            if Tokenizer is None:
                raise RuntimeError("tokenizers ist nicht installiert.")
            self._tokenizer = Tokenizer.from_file(str(self.tokenizer_path))

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Tokenizes `texts`, runs the ONNX session, mean-pools the last-hidden-
        state output over non-padding tokens, and L2-normalizes each vector -
        the standard sentence-embedding recipe used by BGE/MiniLM-style models.
        """
        if not texts:
            return []
        self._ensure_loaded()

        encodings = [self._tokenizer.encode(text) for text in texts]
        sequence_length = min(self.max_sequence_length, max(len(encoding.ids) for encoding in encodings))

        input_ids: list[list[int]] = []
        attention_mask: list[list[int]] = []
        for encoding in encodings:
            ids = list(encoding.ids[:sequence_length])
            mask = list(encoding.attention_mask[:sequence_length])
            padding = sequence_length - len(ids)
            input_ids.append(ids + [0] * padding)
            attention_mask.append(mask + [0] * padding)

        feed = _build_input_feed(self._session, input_ids, attention_mask)
        outputs = self._session.run(None, feed)
        last_hidden_state = outputs[0]  # shape: [batch, seq_len, hidden]

        return [
            _mean_pool_and_normalize(last_hidden_state[row_index], attention_mask[row_index])
            for row_index in range(len(texts))
        ]


def _build_input_feed(session: Any, input_ids: list[list[int]], attention_mask: list[list[int]]) -> dict[str, Any]:
    input_names = {item.name for item in session.get_inputs()} if hasattr(session, "get_inputs") else set()
    feed: dict[str, Any] = {}
    if "input_ids" in input_names or not input_names:
        feed["input_ids"] = _as_int_array(input_ids)
    if "attention_mask" in input_names or not input_names:
        feed["attention_mask"] = _as_int_array(attention_mask)
    if "token_type_ids" in input_names:
        feed["token_type_ids"] = _as_int_array([[0] * len(row) for row in input_ids])
    return feed


def _as_int_array(values: list[list[int]]) -> Any:
    try:
        import numpy as np  # local import: only needed on the real-session path

        return np.array(values, dtype=np.int64)
    except ImportError:  # pragma: no cover - numpy ships with onnxruntime
        return values


def _mean_pool_and_normalize(token_vectors: Any, mask: list[int]) -> list[float]:
    hidden_size = len(token_vectors[0])
    valid_count = sum(mask)
    if valid_count == 0:
        return [0.0] * hidden_size

    summed = [0.0] * hidden_size
    for token_index, flag in enumerate(mask):
        if not flag:
            continue
        token_vector = token_vectors[token_index]
        for dim in range(hidden_size):
            summed[dim] += float(token_vector[dim])

    pooled = [value / valid_count for value in summed]
    norm = math.sqrt(sum(value * value for value in pooled))
    if norm == 0:
        return pooled
    return [value / norm for value in pooled]
