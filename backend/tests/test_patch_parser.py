import json

import pytest

from app.agent_runner.patch_parser import parse_patch_proposals, validate_patch_path


def test_parse_patch_proposals_from_json_fence(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    (workspace / "README.md").write_text("# Old\n", encoding="utf-8")

    llm_content = """Here are the patches:
```json
{
  "patches": [
    {
      "file_path": "README.md",
      "proposed_content": "# New\\n",
      "summary": "Updated heading"
    }
  ]
}
```
"""
    proposals = parse_patch_proposals(llm_content, str(workspace))
    assert len(proposals) == 1
    assert proposals[0].file_path == "README.md"
    assert proposals[0].proposed_content == "# New\n"
    assert proposals[0].summary == "Updated heading"


def test_parse_patch_proposals_rejects_outside_workspace(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    payload = json.dumps(
        {
            "patches": [
                {
                    "file_path": "../outside.txt",
                    "proposed_content": "nope",
                    "summary": "bad",
                }
            ]
        }
    )
    with pytest.raises(ValueError, match="Ungültiger Patch-Pfad"):
        parse_patch_proposals(payload, str(workspace))


def test_validate_patch_path_accepts_relative_path(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    assert validate_patch_path(str(workspace), "src/app.ts") == "src/app.ts"


def test_validate_patch_path_rejects_absolute_path(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    with pytest.raises(ValueError, match="Ungültiger Patch-Pfad"):
        validate_patch_path(str(workspace), "/tmp/evil.txt")

