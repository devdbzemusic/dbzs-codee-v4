from app.runtime.chat_stream import (
    iter_llama_server_stream,
    parse_llama_server_sse_line,
    parse_llama_server_sse_usage,
    parse_ollama_ndjson_line,
)


def test_parse_llama_server_sse_line_extracts_delta_content() -> None:
    line = 'data: {"choices":[{"delta":{"content":"Hallo"}}]}'
    assert parse_llama_server_sse_line(line) == "Hallo"


def test_parse_llama_server_sse_line_ignores_done_marker() -> None:
    assert parse_llama_server_sse_line("data: [DONE]") is None


def test_parse_ollama_ndjson_line_extracts_content_and_done_flag() -> None:
    line = '{"message":{"content":"Chunk"},"done":false}'
    content, done = parse_ollama_ndjson_line(line)
    assert content == "Chunk"
    assert done is False


def test_parse_ollama_ndjson_line_marks_final_chunk() -> None:
    line = '{"message":{"content":""},"done":true}'
    content, done = parse_ollama_ndjson_line(line)
    assert content is None
    assert done is True


def test_parse_llama_server_sse_usage_extracts_token_counts() -> None:
    line = 'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":120,"completion_tokens":45}}'

    usage = parse_llama_server_sse_usage(line)

    assert usage == {"prompt_tokens": 120, "completion_tokens": 45}


def test_parse_llama_server_sse_usage_returns_none_when_absent() -> None:
    line = 'data: {"choices":[{"delta":{"content":"Hallo"}}]}'

    assert parse_llama_server_sse_usage(line) is None


def test_parse_llama_server_sse_usage_ignores_done_marker() -> None:
    assert parse_llama_server_sse_usage("data: [DONE]") is None


def test_iter_llama_server_stream_calls_on_usage_when_present() -> None:
    lines = [
        'data: {"choices":[{"delta":{"content":"Hallo"}}]}',
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":120,"completion_tokens":45}}',
        "data: [DONE]",
    ]
    captured: list[dict] = []

    chunks = list(iter_llama_server_stream(lines, on_usage=captured.append))

    assert chunks == ["Hallo"]
    assert captured == [{"prompt_tokens": 120, "completion_tokens": 45}]


def test_iter_llama_server_stream_without_on_usage_is_unaffected() -> None:
    """Backward compatibility: existing callers that don't pass on_usage see no behavior change."""
    lines = ['data: {"choices":[{"delta":{"content":"Hallo"}}]}', "data: [DONE]"]

    chunks = list(iter_llama_server_stream(lines))

    assert chunks == ["Hallo"]


def test_iter_llama_server_stream_stops_on_finish_reason() -> None:
    finished: list[str] = []
    lines = [
        'data: {"choices":[{"delta":{"content":"Hallo"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        'data: {"choices":[{"delta":{"content":"DARF NICHT KOMMEN"}}]}',
    ]
    assert list(iter_llama_server_stream(lines, on_finish=finished.append)) == ["Hallo"]
    assert finished == ["stop"]


def test_iter_llama_server_stream_stops_on_done() -> None:
    finished: list[str] = []
    lines = [
        'data: {"choices":[{"delta":{"content":"Hallo"}}]}',
        "data: [DONE]",
        'data: {"choices":[{"delta":{"content":"DARF NICHT KOMMEN"}}]}',
    ]
    assert list(iter_llama_server_stream(lines, on_finish=finished.append)) == ["Hallo"]
    assert finished == ["stop"]
