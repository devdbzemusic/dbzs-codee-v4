"""Offline acceptance test for CODEE coding-loop hardening."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from app.context_pack.models import ContextPackBuildRequest
from app.context_pack.service import ContextPackService

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = REPO_ROOT / "test-fixtures" / "coding-capability-project"
NODE_BIN = REPO_ROOT / "node_modules" / ".bin"
DESKTOP_NODE_BIN = REPO_ROOT / "apps" / "desktop" / "node_modules" / ".bin"
_BIN_EXT = ".cmd" if sys.platform == "win32" else ""
TSC = NODE_BIN / f"tsc{_BIN_EXT}"
VITEST = DESKTOP_NODE_BIN / f"vitest{_BIN_EXT}"


@dataclass(slots=True)
class OfflineCodingLoopLimits:
    max_iterations: int = 3
    max_files_changed: int = 4
    max_patch_size: int = 12000
    max_command_count: int = 8
    require_review_gate: bool = True
    allow_commit: bool = False


@dataclass(slots=True)
class OfflineCodingLoop:
    workspace_root: Path
    limits: OfflineCodingLoopLimits = field(default_factory=OfflineCodingLoopLimits)
    command_count: int = 0
    iterations: int = 0
    changed_files: set[str] = field(default_factory=set)
    planned_changes: list[str] = field(default_factory=list)
    review_gate_approved: bool = False

    def run_command(self, command: list[str]) -> subprocess.CompletedProcess[str]:
        if self.command_count >= self.limits.max_command_count:
            raise AssertionError("maxCommandCount exceeded")
        self.command_count += 1
        return subprocess.run(
            command,
            cwd=self.workspace_root,
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
        )

    def propose_change(self, relative_path: str, content: str, reason: str) -> None:
        if self.iterations >= self.limits.max_iterations:
            raise AssertionError("maxIterations exceeded")
        if len(content.encode("utf-8")) > self.limits.max_patch_size:
            raise AssertionError("maxPatchSize exceeded")
        if relative_path == "src/protected.audit.ts":
            raise AssertionError("protected file must not be modified")
        self.changed_files.add(relative_path)
        if len(self.changed_files) > self.limits.max_files_changed:
            raise AssertionError("maxFilesChanged exceeded")
        self.planned_changes.append(f"{relative_path}: {reason}")
        path = self.workspace_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def approve_review_gate(self) -> None:
        if not self.planned_changes:
            raise AssertionError("Review Gate requires planned changes")
        self.review_gate_approved = True

    def assert_review_gate(self) -> None:
        if self.limits.require_review_gate and not self.review_gate_approved:
            raise AssertionError("Review Gate required before completion")
        if self.limits.allow_commit:
            raise AssertionError("Offline acceptance must not commit")


def copy_fixture_workspace() -> Path:
    temp_parent = REPO_ROOT / ".tmp-coding-loop"
    temp_parent.mkdir(exist_ok=True)
    workspace = Path(tempfile.mkdtemp(prefix="workspace-", dir=temp_parent))
    shutil.copytree(FIXTURE_ROOT, workspace, dirs_exist_ok=True)
    return workspace


def run_typecheck(loop: OfflineCodingLoop) -> subprocess.CompletedProcess[str]:
    return loop.run_command([str(TSC), "--noEmit", "-p", str(loop.workspace_root / "tsconfig.json")])


def run_tests(loop: OfflineCodingLoop) -> subprocess.CompletedProcess[str]:
    return loop.run_command([str(VITEST), "run", "--root", str(loop.workspace_root)])


def test_offline_coding_loop_repairs_registration_without_touching_protected_file() -> None:
    workspace = copy_fixture_workspace()
    try:
        protected_before = (workspace / "src/protected.audit.ts").read_text(encoding="utf-8")
        loop = OfflineCodingLoop(workspace)

        context = ContextPackService().build(
            ContextPackBuildRequest(
                workspace_root=str(workspace),
                user_request=(
                    "Repair user registration; email validation broken, import missing, "
                    "tests do not cover duplicates, public API must not change."
                ),
            )
        )
        mapped_paths = {file.path for file in context.repo_map.files}
        assert "src/register.ts" in mapped_paths
        assert "src/register.test.ts" in mapped_paths

        initial_typecheck = run_typecheck(loop)
        assert initial_typecheck.returncode != 0
        assert "normalizeEmail" in (initial_typecheck.stdout + initial_typecheck.stderr)

        loop.iterations += 1
        loop.propose_change(
            "src/email.ts",
            """export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
}
""",
            "Fix missing normalizeEmail export and strict email validation",
        )
        loop.propose_change(
            "src/register.ts",
            """import { isValidEmail, normalizeEmail } from "./email";

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
}

export interface RegisterInput {
  email: string;
  displayName: string;
}

export function registerUser(existingUsers: UserRecord[], input: RegisterInput): UserRecord[] {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim();

  if (!isValidEmail(email)) {
    throw new Error("Invalid email");
  }

  if (!displayName) {
    throw new Error("Display name is required");
  }

  if (existingUsers.some((user) => normalizeEmail(user.email) === email)) {
    throw new Error("Email already registered");
  }

  const nextUser: UserRecord = {
    id: `user-${existingUsers.length + 1}`,
    email,
    displayName
  };

  return [...existingUsers, nextUser];
}
""",
            "Reject duplicate normalized emails without changing public API",
        )
        loop.propose_change(
            "src/register.test.ts",
            """import { describe, expect, it } from "vitest";
import { registerUser, type UserRecord } from "./register";

describe("registerUser", () => {
  it("normalizes and stores a valid user", () => {
    const result = registerUser([], {
      email: "  PERSON@Example.COM ",
      displayName: " Ada "
    });

    expect(result).toEqual([
      {
        id: "user-1",
        email: "person@example.com",
        displayName: "Ada"
      }
    ]);
  });

  it("rejects invalid email addresses", () => {
    expect(() => registerUser([], { email: "not-valid", displayName: "Ada" })).toThrow("Invalid email");
  });

  it("rejects duplicate email addresses after normalization", () => {
    const existing = registerUser([], {
      email: "ada@example.com",
      displayName: "Ada"
    });

    expect(() =>
      registerUser(existing, {
        email: " ADA@EXAMPLE.COM ",
        displayName: "Ada 2"
      })
    ).toThrow("Email already registered");
  });

  it("keeps the public API shape", () => {
    const existing: UserRecord[] = [];
    const result: UserRecord[] = registerUser(existing, {
      email: "ada@example.com",
      displayName: "Ada"
    });
    expect(result[0].id).toBe("user-1");
  });
});
""",
            "Add missing duplicate registration coverage",
        )
        loop.propose_change(
            "tsconfig.json",
            json.dumps(
                {
                    "compilerOptions": {
                        "target": "ES2022",
                        "module": "ESNext",
                        "moduleResolution": "Bundler",
                        "strict": True,
                        "noEmit": True,
                    },
                    "include": ["src/**/*.ts"],
                    "exclude": ["src/**/*.test.ts"],
                },
                indent=2,
            )
            + "\n",
            "Modernize controlled fixture compiler target",
        )
        loop.approve_review_gate()

        repaired_typecheck = run_typecheck(loop)
        assert repaired_typecheck.returncode == 0, repaired_typecheck.stdout + repaired_typecheck.stderr
        repaired_tests = run_tests(loop)
        assert repaired_tests.returncode == 0, repaired_tests.stdout + repaired_tests.stderr

        assert (workspace / "src/protected.audit.ts").read_text(encoding="utf-8") == protected_before
        loop.assert_review_gate()
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
