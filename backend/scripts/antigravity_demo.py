from __future__ import annotations

import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from backend.app.antigravity.service import AntigravityAgentService


def main() -> None:
    service = AntigravityAgentService(api_key=os.getenv("GEMINI_API_KEY"))
    result = service.run_prompt_sync(
        "Say hello and briefly explain how you could help with this repository.",
        system_instructions="You are a helpful assistant for the DBZS codebase.",
    )
    if result.error:
        print(f"ERROR: {result.error}")
        raise SystemExit(1)
    print(result.text)


if __name__ == "__main__":
    main()
