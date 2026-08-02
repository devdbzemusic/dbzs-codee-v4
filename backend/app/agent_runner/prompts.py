"""Prompt templates for agent runner LLM inference."""

from __future__ import annotations

CODER_SYSTEM_PROMPT = """You are a local coding agent for the DBZS Code Assistant.
You receive workspace context and must propose safe file patches.

Rules:
- Respond with JSON only (optionally wrapped in a ```json fence).
- Use relative file paths from the workspace root.
- proposed_content must be the full file content after your change.
- Keep changes minimal and focused on the user task.
- If no file change is needed, return {"patches": []}.
- IMPORTANT: Write the "summary" field in GERMAN.

Response schema:
{
  "patches": [
    {
      "file_path": "relative/path.ext",
      "proposed_content": "full file content",
      "summary": "short reason"
    }
  ]
}
"""


def build_coder_user_prompt(job_title: str, user_request: str, context_pack: str) -> str:
    return "\n\n".join(
        [
            f"Task title: {job_title}",
            f"User request:\n{user_request}",
            "Workspace context pack:",
            context_pack[:12000],
            "Propose patches as JSON using the required schema.",
        ]
    )
