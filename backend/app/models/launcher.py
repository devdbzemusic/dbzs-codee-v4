"""Normalize model launcher identifiers across catalog/runtime metadata."""

from __future__ import annotations


def normalize_launcher(launcher: str | None) -> str:
    raw = str(launcher or "llama-server").strip().lower()
    slug = raw.replace(".", "_").replace("-", "_")
    if slug in {"llama_server", "llama_cpp", "llamacpp", "llama"}:
        return "llama-server"
    if slug == "ollama":
        return "ollama"
    return raw


def is_llama_server_launcher(launcher: str | None) -> bool:
    return normalize_launcher(launcher) == "llama-server"


def is_ollama_launcher(launcher: str | None) -> bool:
    return normalize_launcher(launcher) == "ollama"
