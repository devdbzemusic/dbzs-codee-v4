/*
 * DBZS – Division By Zeros
 * Datei: skillPackageService.ts
 * Bereich: Electron / Skill Runtime
 *
 * Zweck:
 *   Lädt und importiert deklarative Skill-Pakete aus UserData und Workspace.
 *
 * Hinweise:
 *   Es werden ausschließlich manifest.yaml, SKILL.md und README.md gelesen
 *   beziehungsweise kopiert. Symlinks, Archive und ausführbarer Inhalt sind
 *   keine Skill-Runtime-Eingaben.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createSkillPackage,
  SKILL_PACKAGE_LIMITS,
  SkillPackageError
} from "../src/runtime/skill/skillManifest";
import type {
  CodeeSkillPackage,
  SkillLoadFailure,
  SkillPackageReloadResult,
  SkillPackageSource
} from "../src/runtime/skill/skillContracts";
import { resolveCanonicalWorkspacePath } from "./workspacePathGuard";

const ALLOWED_FILES = new Set(["manifest.yaml", "SKILL.md", "README.md"]);

async function readBounded(filePath: string, limit: number): Promise<string> {
  const stat = await fs.lstat(filePath);
  if (stat.isSymbolicLink()) throw new SkillPackageError("unsafe_path", "Symlinks are not allowed.");
  if (!stat.isFile()) throw new SkillPackageError("unsafe_path", "Expected a regular file.");
  if (stat.size > limit) throw new SkillPackageError("package_too_large", `${path.basename(filePath)} is too large.`);
  return fs.readFile(filePath, "utf8");
}

function failure(
  source: SkillPackageSource,
  error: unknown,
  skillId?: string
): SkillLoadFailure {
  return {
    code: error instanceof SkillPackageError ? error.code : "manifest_invalid",
    source,
    message: error instanceof Error ? error.message : String(error),
    skillId
  };
}

async function loadPackageDirectory(
  directory: string,
  source: SkillPackageSource
): Promise<CodeeSkillPackage> {
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new SkillPackageError("unsafe_path", "Skill package must be a real directory.");
  }
  const names = await fs.readdir(directory);
  if (!names.includes("manifest.yaml")) {
    throw new SkillPackageError("manifest_missing", "manifest.yaml is missing.");
  }
  if (!names.includes("SKILL.md")) {
    throw new SkillPackageError("instructions_missing", "SKILL.md is missing.");
  }
  const manifestRaw = await readBounded(
    path.join(directory, "manifest.yaml"),
    SKILL_PACKAGE_LIMITS.manifestBytes
  );
  const instructions = await readBounded(
    path.join(directory, "SKILL.md"),
    SKILL_PACKAGE_LIMITS.instructionsBytes
  );
  const readme = names.includes("README.md")
    ? await readBounded(path.join(directory, "README.md"), SKILL_PACKAGE_LIMITS.readmeBytes)
    : undefined;
  return createSkillPackage({ manifestRaw, instructions, readme, source });
}

async function loadSourceRoot(
  root: string,
  type: "user" | "workspace"
): Promise<SkillPackageReloadResult> {
  const packages: CodeeSkillPackage[] = [];
  const failures: SkillLoadFailure[] = [];
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { packages, failures };
    throw error;
  }
  for (const entry of entries) {
    const source: SkillPackageSource = { type, path: path.join(root, entry.name) };
    if (entry.isSymbolicLink()) {
      failures.push(failure(source, new SkillPackageError("unsafe_path", "Symlink package blocked."), entry.name));
      continue;
    }
    if (!entry.isDirectory()) continue;
    try {
      const loaded = await loadPackageDirectory(source.path, source);
      packages.push(loaded);
    } catch (error) {
      failures.push(failure(source, error, entry.name));
    }
  }
  return { packages, failures };
}

export class SkillPackageService {
  constructor(private readonly userSkillsRoot: string) {}

  async reload(workspaceRoot?: string): Promise<SkillPackageReloadResult> {
    const user = await loadSourceRoot(this.userSkillsRoot, "user");
    if (!workspaceRoot) return user;
    const workspaceSkills = await resolveCanonicalWorkspacePath(
      workspaceRoot,
      path.join(workspaceRoot, ".codee", "skills"),
      { allowMissing: true }
    );
    const workspace = await loadSourceRoot(workspaceSkills, "workspace");
    return {
      packages: [...user.packages, ...workspace.packages],
      failures: [...user.failures, ...workspace.failures]
    };
  }

  async importDirectory(sourceDirectory: string): Promise<CodeeSkillPackage> {
    if (path.extname(sourceDirectory).toLowerCase() === ".zip") {
      throw new SkillPackageError("unsafe_path", "ZIP import is not supported in Skill Runtime V1.");
    }
    const source = { type: "user" as const, path: sourceDirectory };
    const loaded = await loadPackageDirectory(sourceDirectory, source);
    const targetDirectory = path.join(this.userSkillsRoot, loaded.manifest.id);
    await fs.mkdir(this.userSkillsRoot, { recursive: true });
    const targetStat = await fs.lstat(targetDirectory).catch(() => null);
    if (targetStat) {
      throw new SkillPackageError("duplicate_skill_id", `User skill ${loaded.manifest.id} already exists.`);
    }
    await fs.mkdir(targetDirectory, { recursive: false });
    try {
      for (const fileName of ALLOWED_FILES) {
        const sourcePath = path.join(sourceDirectory, fileName);
        const content = await fs.readFile(sourcePath, "utf8").catch(() => null);
        if (content != null) await fs.writeFile(path.join(targetDirectory, fileName), content, "utf8");
      }
    } catch (error) {
      await fs.rm(targetDirectory, { recursive: true, force: true });
      throw error;
    }
    return loadPackageDirectory(targetDirectory, { type: "user", path: targetDirectory });
  }
}
