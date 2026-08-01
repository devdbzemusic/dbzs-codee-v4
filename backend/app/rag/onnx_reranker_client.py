"""
In-process ONNX Runtime reranker (cross-encoder) client (Plan 14, Phase 2
continuation). Structural sibling of `onnx_embedding_client.py`'s
`OnnxEmbeddingClient`: same optional-dependency guards, same
constructor-injectable session/tokenizer for testing without real model
files.

A cross-encoder scores a (query, document) pair jointly - text in, a single
relevance score out - rather than encoding texts independently like an
embedding model. `tokenizers` supports this natively via pair-encoding
(`tokenizer.encode(query, document)`).
"""
from __future__ import annotations

import math
from typing import Any

from app.rag.onnx_shared import build_input_feed

try:
    import onnxruntime  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - exercised when the optional dependency is absent
    onnxruntime = None  # type: ignore[assignment]

try:
    from tokenizers import Tokenizer  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - exercised when the optional dependency is absent
    Tokenizer = None  # type: ignore[assignment]


def onnx_reranker_backend_available() -> bool:
    return onnxruntime is not None and Tokenizer is not None


class OnnxRerankerClient:
    def __init__(
        self,
        model_path: Any,
        tokenizer_path: Any,
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

    def rerank(self, query: str, documents: list[str]) -> list[float]:
        """Scores each document's relevance to `query`, one cross-encoder pass
        per document, returned in the same order as `documents`.
        """
        if not documents:
            return []
        self._ensure_loaded()

        encodings = [self._tokenizer.encode(query, document) for document in documents]
        sequence_length = min(self.max_sequence_length, max(len(encoding.ids) for encoding in encodings))

        input_ids: list[list[int]] = []
        attention_mask: list[list[int]] = []
        for encoding in encodings:
            ids = list(encoding.ids[:sequence_length])
            mask = list(encoding.attention_mask[:sequence_length])
            padding = sequence_length - len(ids)
            input_ids.append(ids + [0] * padding)
            attention_mask.append(mask + [0] * padding)

        feed = build_input_feed(self._session, input_ids, attention_mask)
        outputs = self._session.run(None, feed)
        logits = outputs[0]  # shape: [batch, num_labels]

        return [_logits_to_score(logits[row_index]) for row_index in range(len(documents))]


def _logits_to_score(logits: Any) -> float:
    values = [float(value) for value in logits]
    if len(values) == 1:
        return 1.0 / (1.0 + math.exp(-values[0]))
    if len(values) == 2:
        max_value = max(values)
        exponents = [math.exp(value - max_value) for value in values]
        total = sum(exponents)
        return exponents[1] / total
    return values[0]
