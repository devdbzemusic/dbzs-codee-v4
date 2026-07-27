from app.core.context_policy import (
    default_context_excluded_directories,
    is_context_path_allowed,
    workspace_scope_id,
)


def test_context_policy_contains_required_directories() -> None:
    assert {
        ".codee",
        "restore-points",
        "node_modules",
        ".git",
        "dist",
        "build",
        "target",
        "coverage",
    } <= default_context_excluded_directories()


def test_context_policy_is_fail_closed_for_explicit_mentions() -> None:
    assert not is_context_path_allowed(".codee/resources/foo.ts")
    assert not is_context_path_allowed(".codee/resources/foo.ts", explicit_mention=True)
    assert is_context_path_allowed(
        ".codee/resources/foo.ts",
        explicit_mention=True,
        access_confirmed=True,
    )


def test_workspace_scope_id_normalizes_windows_paths() -> None:
    assert workspace_scope_id("C:\\Users\\Demo\\Repo\\") == "c:/users/demo/repo"
