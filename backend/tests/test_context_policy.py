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
        "out",
        ".cache",
        "playwright-report",
        "test-results",
    } <= default_context_excluded_directories()


def test_context_policy_excludes_new_directories() -> None:
    assert not is_context_path_allowed(".cache/foo.json")
    assert not is_context_path_allowed("playwright-report/index.html")
    assert not is_context_path_allowed("test-results/run.json")
    assert not is_context_path_allowed("out/bundle.js")


def test_context_policy_excludes_files_by_glob_pattern() -> None:
    assert not is_context_path_allowed("logs/app.log")
    assert not is_context_path_allowed(".env")
    assert not is_context_path_allowed(".env.local")
    assert not is_context_path_allowed(".env.production")


def test_context_policy_allows_similar_but_non_matching_files() -> None:
    assert is_context_path_allowed("src/envelope.txt")
    assert is_context_path_allowed("logs/foo.log.bak")


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
