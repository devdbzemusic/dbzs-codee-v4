/*
 * DBZS – Division By Zeros
 * Datei: atomicFileWrite.ts
 * Bereich: Electron / Workspace IO
 *
 * Zweck:
 *   Kapselt robuste, Windows-taugliche Atomic-Write-Operationen fuer Workspace-Dateien.
 *
 * Warum:
 *   Direkte rename()-Ersetzungen scheitern unter Windows sporadisch mit EPERM/EACCES/EBUSY,
 *   wenn Ziel- oder Temp-Dateien kurzzeitig von Watchern, AV oder Indexern beruehrt werden.
 *
 * Wozu:
 *   Project-Memory, Skill-Artefakte und andere lokale Persistenz sollen stabil speichern,
 *   ohne bei kurzzeitigen Dateisperren sofort zu aborten.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

type RenameLike = (from: string, to: string) => Promise<void>;
type WriteLike = (filePath: string, content: string, options?: { encoding?: BufferEncoding; flag?: string }) => Promise<void>;
type MkdirLike = (filePath: string, options: { recursive: true }) => Promise<string | undefined>;
type RmLike = (filePath: string, options?: { force?: boolean }) => Promise<void>;
type AccessLike = (filePath: string) => Promise<void>;
type SleepLike = (ms: number) => Promise<void>;

type AtomicWriteFs = {
  rename: RenameLike;
  writeFile: WriteLike;
  mkdir: MkdirLike;
  rm: RmLike;
  access: AccessLike;
};

type AtomicWriteOptions = {
  fsImpl?: AtomicWriteFs;
  sleep?: SleepLike;
  retries?: number;
  retryDelayMs?: number;
};

const DEFAULT_RETRIES = 6;
const DEFAULT_RETRY_DELAY_MS = 30;
const WINDOWS_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRenameError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && WINDOWS_RENAME_CODES.has(String(error.code)));
}

async function pathExists(fsImpl: AtomicWriteFs, filePath: string): Promise<boolean> {
  try {
    await fsImpl.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function replaceWithRetry(
  temporaryPath: string,
  targetPath: string,
  options: Required<Pick<AtomicWriteOptions, "fsImpl" | "sleep" | "retries" | "retryDelayMs">>
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      await options.fsImpl.rename(temporaryPath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableRenameError(error)) {
        throw error;
      }

      const targetExists = await pathExists(options.fsImpl, targetPath);
      if (targetExists) {
        try {
          await options.fsImpl.rm(targetPath, { force: true });
          await options.fsImpl.rename(temporaryPath, targetPath);
          return;
        } catch (replaceError) {
          lastError = replaceError;
          if (!isRetryableRenameError(replaceError)) {
            throw replaceError;
          }
        }
      }

      if (attempt >= options.retries) {
        break;
      }

      await options.sleep(options.retryDelayMs * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Atomic write failed during replace.");
}

export async function writeFileAtomic(filePath: string, content: string, options: AtomicWriteOptions = {}): Promise<void> {
  const fsImpl = options.fsImpl ?? fs;
  const sleep = options.sleep ?? wait;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.codee-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await fsImpl.writeFile(temporaryPath, content, { encoding: "utf-8", flag: "wx" });
    await replaceWithRetry(temporaryPath, filePath, { fsImpl, sleep, retries, retryDelayMs });
  } catch (error) {
    await fsImpl.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
