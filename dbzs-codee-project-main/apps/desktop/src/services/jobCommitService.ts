/**
 * DBZS – Division By Zeros
 * Datei: jobCommitService.ts
 * Bereich: Desktop Services / Job Commit Service
 *
 * Zweck:
 *   Erstellt automatische Git-Commits nach erfolgreichem Job-Abschluss.
 *   Jeder Job erhält einen eigenen Commit mit aussagekräftiger Message.
 *
 * Warum:
 *   Nach jedem erfolgreichen Job soll ein eigener Git-Commit erzeugt werden.
 *   Das ermöglicht nachvollziehbare, atomare Änderungen im Versionsverlauf.
 *
 * Wozu:
 *   Sicherstellt dass jeder Job im Git-History sichtbar ist und bei Bedarf
 *   zurückgerollt werden kann.
 */

import type {
  CommitRequest,
  CommitResult,
  CommitMessageSuggestion,
  GitStatusEntry,
  ImplementationTaskV1,
  JobRecord
} from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";

/**
 * Commit-Status.
 */
export type CommitState =
  | "idle"
  | "preparing"
  | "creating"
  | "completed"
  | "failed"
  | "skipped";

export interface CommitServiceStatus {
  state: CommitState;
  lastCommitSha: string | null;
  lastCommitMessage: string | null;
  lastError: string | null;
}

/**
 * Konfiguration für den Commit-Service.
 */
export interface CommitServiceConfig {
  /** Ob Commits automatisch erstellt werden */
  autoCommit: boolean;
  /** Commit-Template für Messages */
  commitTemplate?: string;
  /** Ob vor Commit ein Restore-Point erstellt wird */
  createRestorePoint: boolean;
  /** Branch-Name für Commits (falls nicht main) */
  targetBranch?: string;
}

/**
 * Ergebnis eines Commit-Vorgangs.
 */
export interface JobCommitResult {
  success: boolean;
  commitSha?: string | null;
  commitMessage?: string;
  skipped: boolean;
  skipReason?: string;
  errorMessage?: string;
  restorePointId?: string | null;
}

/**
 * Commit-Fehler.
 */
export class JobCommitError extends Error {
  constructor(
    message: string,
    public readonly jobId?: string,
    public readonly taskId?: string
  ) {
    super(message);
    this.name = "JobCommitError";
  }
}

/**
 * Service für Job-Commits.
 */
export class JobCommitService {
  private readonly config: CommitServiceConfig;
  private status: CommitServiceStatus = {
    state: "idle",
    lastCommitSha: null,
    lastCommitMessage: null,
    lastError: null
  };

  constructor(config: CommitServiceConfig) {
    this.config = config;
  }

  /**
   * Holt den aktuellen Status.
   */
  getStatus(): CommitServiceStatus {
    return { ...this.status };
  }

  /**
   * Erstellt einen Commit für einen abgeschlossenen Job.
   *
   * @param job - Der abgeschlossene Job
   * @param task - Die Task-Metadaten
   * @param workspaceRoot - Der Workspace-Pfad
   * @returns Ergebnis des Commit-Vorgangs
   */
  async createCommitForJob(
    job: JobRecord,
    task: ImplementationTaskV1,
    workspaceRoot: string
  ): Promise<JobCommitResult> {
    // Prüfen ob Auto-Commit aktiviert ist
    if (!this.config.autoCommit) {
      return {
        success: false,
        skipped: true,
        skipReason: "Auto-Commit ist deaktiviert"
      };
    }

    this.updateStatus({ state: "preparing" });

    try {
      // Schritt 1: Geänderte Dateien ermitteln
      const changedFiles = await this.getChangedFiles(workspaceRoot, task.expectedFiles);

      if (changedFiles.length === 0) {
        this.updateStatus({ state: "skipped" });
        return {
          success: true,
          skipped: true,
          skipReason: "Keine geänderten Dateien zum Committen"
        };
      }

      // Schritt 2: Optional Restore-Point erstellen
      let restorePointId: string | null = null;
      if (this.config.createRestorePoint) {
        restorePointId = await this.createRestorePoint(
          workspaceRoot,
          changedFiles.map((f) => f.filePath),
          job.id
        );
      }

      // Schritt 3: Commit-Message generieren
      const commitMessage = this.generateCommitMessage(task, job);
      const commitSuggestion = this.toCommitSuggestion(task, commitMessage, changedFiles);

      this.updateStatus({ state: "creating" });

      // Schritt 4: Commit erstellen
      const commitRequest: CommitRequest = {
        message: commitSuggestion,
        includeFiles: changedFiles.map((f) => f.filePath)
      };

      const commitResult = await backendClient.createCommit(workspaceRoot, commitRequest);

      if (!commitResult.success) {
        throw new JobCommitError(
          commitResult.error ?? "Commit fehlgeschlagen",
          job.id,
          task.id
        );
      }

      this.updateStatus({
        state: "completed",
        lastCommitSha: commitResult.commitHash ?? null,
        lastCommitMessage: commitMessage
      });

      console.log(
        `[JobCommit] Commit erstellt: ${commitResult.commitHash?.slice(0, 7)} - ${commitMessage}`
      );

      return {
        success: true,
        commitSha: commitResult.commitHash,
        commitMessage,
        skipped: false,
        restorePointId
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.updateStatus({
        state: "failed",
        lastError: errorMessage
      });

      throw new JobCommitError(
        `Commit für Job ${job.id} fehlgeschlagen: ${errorMessage}`,
        job.id,
        task.id
      );
    }
  }

  /**
   * Erstellt einen Commit für eine Task ohne Job-Kontext.
   */
  async createCommitForTask(
    task: ImplementationTaskV1,
    workspaceRoot: string,
    jobId?: string
  ): Promise<JobCommitResult> {
    if (!this.config.autoCommit) {
      return {
        success: false,
        skipped: true,
        skipReason: "Auto-Commit ist deaktiviert"
      };
    }

    this.updateStatus({ state: "preparing" });

    try {
      // Geänderte Dateien ermitteln
      const changedFiles = await this.getChangedFiles(workspaceRoot, task.expectedFiles);

      if (changedFiles.length === 0) {
        this.updateStatus({ state: "skipped" });
        return {
          success: true,
          skipped: true,
          skipReason: "Keine geänderten Dateien zum Committen"
        };
      }

      // Commit-Message generieren
      const commitMessage = this.generateCommitMessage(task, jobId ? { id: jobId, title: task.title } : undefined);
      const commitSuggestion = this.toCommitSuggestion(task, commitMessage, changedFiles);

      this.updateStatus({ state: "creating" });

      const commitRequest: CommitRequest = {
        message: commitSuggestion,
        includeFiles: changedFiles.map((f) => f.filePath)
      };

      const commitResult = await backendClient.createCommit(workspaceRoot, commitRequest);

      if (!commitResult.success) {
        throw new JobCommitError(
          commitResult.error ?? "Commit fehlgeschlagen",
          jobId,
          task.id
        );
      }

      this.updateStatus({
        state: "completed",
        lastCommitSha: commitResult.commitHash ?? null,
        lastCommitMessage: commitMessage
      });

      return {
        success: true,
        commitSha: commitResult.commitHash,
        commitMessage,
        skipped: false
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.updateStatus({
        state: "failed",
        lastError: errorMessage
      });

      throw new JobCommitError(
        `Commit für Task ${task.id} fehlgeschlagen: ${errorMessage}`,
        jobId,
        task.id
      );
    }
  }

  /**
   * Generiert eine Commit-Message für eine Task.
   */
  private generateCommitMessage(task: ImplementationTaskV1, job?: { id: string; title: string }): string {
    // Template-basiert falls konfiguriert
    if (this.config.commitTemplate) {
      return this.config.commitTemplate
        .replace("{title}", task.title)
        .replace("{description}", task.description)
        .replace("{taskId}", task.id)
        .replace("{jobId}", job?.id ?? "unknown");
    }

    // Default-Template: Conventional Commits Style
    const type = this.inferCommitType(task);
    const scope = this.inferCommitScope(task.expectedFiles);
    const scopePrefix = scope ? `(${scope})` : "";

    return `${type}${scopePrefix}: ${task.title}

${task.description}

Task: ${task.id}${job ? `\nJob: ${job.id}` : ""}
Files: ${task.expectedFiles.join(", ") || "n/a"}
`;
  }

  /**
   * Leitet den Commit-Type aus der Task ab.
   */
  private inferCommitType(task: ImplementationTaskV1): string {
    const titleLower = task.title.toLowerCase();
    const descLower = task.description.toLowerCase();

    if (titleLower.includes("fix") || descLower.includes("fix") || descLower.includes("beheben")) {
      return "fix";
    }

    if (titleLower.includes("feature") || titleLower.includes("add")) {
      return "feat";
    }

    if (titleLower.includes("refactor") || titleLower.includes("cleanup")) {
      return "refactor";
    }

    if (titleLower.includes("test")) {
      return "test";
    }

    if (titleLower.includes("doc")) {
      return "docs";
    }

    return "chore";
  }

  private toCommitSuggestion(
    task: ImplementationTaskV1,
    message: string,
    changedFiles: GitStatusEntry[]
  ): CommitMessageSuggestion {
    const [title, ...bodyLines] = message.trim().split(/\r?\n/);
    return {
      id: `job-${task.id}-${Date.now()}`,
      title,
      body: bodyLines.join("\n").trim() || undefined,
      type: this.inferCommitType(task) as CommitMessageSuggestion["type"],
      scope: this.inferCommitScope(task.expectedFiles) || undefined,
      affectedFiles: changedFiles.map((file) => file.filePath),
      riskLevel: task.requiresApproval ? "medium" : "low",
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Leitet den Scope aus den Dateien ab.
   */
  private inferCommitScope(expectedFiles: string[]): string {
    if (expectedFiles.length === 0) {
      return "";
    }

    // Extrahiere den ersten Pfad-Teil (Ordner)
    const firstFile = expectedFiles[0];
    const parts = firstFile.replace(/\\/g, "/").split("/");

    if (parts.length > 1) {
      return parts[0];
    }

    return "";
  }

  /**
   * Holt die geänderten Dateien.
   */
  private async getChangedFiles(
    workspaceRoot: string,
    expectedFiles: string[]
  ): Promise<GitStatusEntry[]> {
    try {
      // Alle geänderten Dateien im Workspace holen
      const allChanges = await backendClient.getGitChangedFiles(workspaceRoot);

      if (expectedFiles.length === 0) {
        // Keine expectedFiles – alle Änderungen committen
        return allChanges.filter((f) => f.status !== "untracked");
      }

      // Nur expectedFiles filtern die tatsächlich geändert wurden
      const expectedSet = new Set(expectedFiles.map((f) => f.replace(/\\/g, "/").toLowerCase()));

      return allChanges.filter((f) => {
        const normalizedPath = f.filePath.replace(/\\/g, "/").toLowerCase();
        return expectedSet.has(normalizedPath) || expectedSet.has(`./${normalizedPath}`);
      });
    } catch (error) {
      console.error(`[JobCommit] Fehler beim Laden geänderter Dateien:`, error);
      return [];
    }
  }

  /**
   * Erstellt einen Restore-Point vor dem Commit.
   */
  private async createRestorePoint(
    workspaceRoot: string,
    filePaths: string[],
    jobId: string
  ): Promise<string | null> {
    try {
      // Placeholder für Restore-Point-Erstellung
      // In Production: backendClient.createRestorePoint
      console.log(`[JobCommit] Restore-Point für ${filePaths.length} Dateien vor Job ${jobId}`);
      return null;
    } catch (error) {
      console.warn(`[JobCommit] Restore-Point konnte nicht erstellt werden:`, error);
      return null;
    }
  }

  /**
   * Aktualisiert den Status.
   */
  private updateStatus(updates: Partial<CommitServiceStatus>): void {
    this.status = { ...this.status, ...updates };
    console.log(`[JobCommit] Status: ${this.status.state}`, {
      sha: this.status.lastCommitSha?.slice(0, 7),
      error: this.status.lastError
    });
  }
}

/**
 * Singleton-Instanz des Commit-Service.
 */
export const jobCommitService = new JobCommitService({
  autoCommit: true,
  createRestorePoint: true,
  commitTemplate: "{title}\n\nTask: {taskId}\nJob: {jobId}"
});
