"""Tests for the ONNX Runtime reranker (cross-encoder) client (Plan 14, Phase 2
continuation).

Uses injected fake session/tokenizer objects throughout, so no real .onnx file
or tokenizer.json is needed - only the logit-to-score math and the
optional-dependency error handling are under test here.
"""
from pathlib import Path

import pytest

import app.rag.onnx_reranker_client as onnx_reranker_client
from app.rag.onnx_reranker_client import OnnxRerankerClient, onnx_reranker_backend_available


class FakeEncoding:
    def __init__(self, ids: list[int], attention_mask: list[int]) -> None:
        self.ids = ids
        self.attention_mask = attention_mask


class FakeTokenizer:
    def __init__(self, encodings: dict[tuple[str, str], FakeEncoding]) -> None:
        self._encodings = encodings

    def encode(self, query: str, document: str) -> FakeEncoding:
        return self._encodings[(query, document)]


class FakeInputInfo:
    def __init__(self, name: str) -> None:
        self.name = name


class FakeSession:
    def __init__(self, logits: list, input_names: tuple[str, ...] = ("input_ids", "attention_mask")) -> None:
        self._logits = logits
        self._input_names = input_names

    def get_inputs(self) -> list[FakeInputInfo]:
        return [FakeInputInfo(name) for name in self._input_names]

    def run(self, output_names: object, feed: dict) -> list:
        assert set(feed.keys()) == set(self._input_names)
        return [self._logits]


def test_rerank_converts_single_logit_via_sigmoid(tmp_path: Path) -> None:
    tokenizer = FakeTokenizer({("q", "doc a"): FakeEncoding(ids=[1, 2], attention_mask=[1, 1])})
    session = FakeSession(logits=[[0.0]])
    client = OnnxRerankerClient(tmp_path / "model.onnx", tmp_path / "tokenizer.json", session=session, tokenizer=tokenizer)

    scores = client.rerank("q", ["doc a"])

    assert scores == pytest.approx([0.5])


def test_rerank_converts_two_logits_via_softmax_relevant_index(tmp_path: Path) -> None:
    tokenizer = FakeTokenizer({("q", "doc a"): FakeEncoding(ids=[1, 2], attention_mask=[1, 1])})
    session = FakeSession(logits=[[0.0, 0.0]])
    client = OnnxRerankerClient(tmp_path / "model.onnx", tmp_path / "tokenizer.json", session=session, tokenizer=tokenizer)

    scores = client.rerank("q", ["doc a"])

    assert scores == pytest.approx([0.5])


def test_rerank_scores_multiple_documents_in_order(tmp_path: Path) -> None:
    tokenizer = FakeTokenizer(
        {
            ("q", "low"): FakeEncoding(ids=[1], attention_mask=[1]),
            ("q", "high"): FakeEncoding(ids=[1, 2], attention_mask=[1, 1]),
        }
    )
    session = FakeSession(logits=[[-5.0], [5.0]])
    client = OnnxRerankerClient(tmp_path / "model.onnx", tmp_path / "tokenizer.json", session=session, tokenizer=tokenizer)

    scores = client.rerank("q", ["low", "high"])

    assert len(scores) == 2
    assert scores[0] < scores[1]


def test_rerank_returns_empty_list_for_no_documents(tmp_path: Path) -> None:
    client = OnnxRerankerClient(
        tmp_path / "model.onnx", tmp_path / "tokenizer.json", session=object(), tokenizer=object()
    )

    assert client.rerank("q", []) == []


def test_raises_clear_error_when_onnxruntime_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(onnx_reranker_client, "onnxruntime", None)
    client = OnnxRerankerClient(tmp_path / "model.onnx", tmp_path / "tokenizer.json", tokenizer=FakeTokenizer({}))

    with pytest.raises(RuntimeError, match="onnxruntime"):
        client.rerank("q", ["doc"])


def test_raises_clear_error_when_tokenizers_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(onnx_reranker_client, "Tokenizer", None)
    client = OnnxRerankerClient(
        tmp_path / "model.onnx", tmp_path / "tokenizer.json", session=FakeSession([[0.0]])
    )

    with pytest.raises(RuntimeError, match="tokenizers"):
        client.rerank("q", ["doc"])


def test_onnx_reranker_backend_available_reflects_real_imports() -> None:
    assert onnx_reranker_backend_available() is True
