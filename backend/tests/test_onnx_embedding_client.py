"""Tests for the ONNX Runtime embedding client (Plan 14, Phase 2).

Uses injected fake session/tokenizer objects throughout, so no real .onnx file
or tokenizer.json is needed - only the pooling/normalization math and the
optional-dependency error handling are under test here.
"""
from pathlib import Path

import pytest

import app.rag.onnx_embedding_client as onnx_embedding_client
from app.rag.onnx_embedding_client import OnnxEmbeddingClient, onnx_embedding_backend_available


class FakeEncoding:
    def __init__(self, ids: list[int], attention_mask: list[int]) -> None:
        self.ids = ids
        self.attention_mask = attention_mask


class FakeTokenizer:
    def __init__(self, encodings: dict[str, FakeEncoding]) -> None:
        self._encodings = encodings

    def encode(self, text: str) -> FakeEncoding:
        return self._encodings[text]


class FakeInputInfo:
    def __init__(self, name: str) -> None:
        self.name = name


class FakeSession:
    def __init__(self, last_hidden_state: list, input_names: tuple[str, ...] = ("input_ids", "attention_mask")) -> None:
        self._last_hidden_state = last_hidden_state
        self._input_names = input_names

    def get_inputs(self) -> list[FakeInputInfo]:
        return [FakeInputInfo(name) for name in self._input_names]

    def run(self, output_names: object, feed: dict) -> list:
        assert set(feed.keys()) == set(self._input_names)
        return [self._last_hidden_state]


def test_embed_pools_and_normalizes_two_token_sequence(tmp_path: Path) -> None:
    tokenizer = FakeTokenizer({"hello world": FakeEncoding(ids=[10, 20], attention_mask=[1, 1])})
    session = FakeSession(last_hidden_state=[[[1.0, 0.0], [0.0, 1.0]]])
    client = OnnxEmbeddingClient(
        tmp_path / "model.onnx", tmp_path / "tokenizer.json", session=session, tokenizer=tokenizer
    )

    vectors = client.embed(["hello world"])

    assert len(vectors) == 1
    assert vectors[0] == pytest.approx([0.7071067811865476, 0.7071067811865476])


def test_embed_ignores_padding_tokens_in_pooling(tmp_path: Path) -> None:
    tokenizer = FakeTokenizer(
        {
            "short": FakeEncoding(ids=[5], attention_mask=[1]),
            "longer text": FakeEncoding(ids=[5, 6], attention_mask=[1, 1]),
        }
    )
    session = FakeSession(
        last_hidden_state=[
            [[2.0, 0.0], [100.0, 100.0]],  # "short" - second slot is padding, must be ignored
            [[1.0, 1.0], [3.0, 3.0]],  # "longer text" - both real tokens
        ]
    )
    client = OnnxEmbeddingClient(
        tmp_path / "model.onnx", tmp_path / "tokenizer.json", session=session, tokenizer=tokenizer
    )

    vectors = client.embed(["short", "longer text"])

    assert vectors[0] == pytest.approx([1.0, 0.0])
    assert vectors[1] == pytest.approx([0.7071067811865476, 0.7071067811865476])


def test_embed_includes_token_type_ids_when_the_model_expects_them(tmp_path: Path) -> None:
    tokenizer = FakeTokenizer({"hi": FakeEncoding(ids=[1], attention_mask=[1])})
    session = FakeSession(
        last_hidden_state=[[[4.0, 0.0]]],
        input_names=("input_ids", "attention_mask", "token_type_ids"),
    )
    client = OnnxEmbeddingClient(
        tmp_path / "model.onnx", tmp_path / "tokenizer.json", session=session, tokenizer=tokenizer
    )

    vectors = client.embed(["hi"])

    assert vectors[0] == pytest.approx([1.0, 0.0])


def test_embed_returns_empty_list_for_no_texts(tmp_path: Path) -> None:
    client = OnnxEmbeddingClient(
        tmp_path / "model.onnx", tmp_path / "tokenizer.json", session=object(), tokenizer=object()
    )

    assert client.embed([]) == []


def test_raises_clear_error_when_onnxruntime_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(onnx_embedding_client, "onnxruntime", None)
    client = OnnxEmbeddingClient(tmp_path / "model.onnx", tmp_path / "tokenizer.json", tokenizer=FakeTokenizer({}))

    with pytest.raises(RuntimeError, match="onnxruntime"):
        client.embed(["hi"])


def test_raises_clear_error_when_tokenizers_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(onnx_embedding_client, "Tokenizer", None)
    client = OnnxEmbeddingClient(
        tmp_path / "model.onnx", tmp_path / "tokenizer.json", session=FakeSession([[[1.0]]])
    )

    with pytest.raises(RuntimeError, match="tokenizers"):
        client.embed(["hi"])


def test_onnx_embedding_backend_available_reflects_real_imports() -> None:
    assert onnx_embedding_backend_available() is True
