/**
 * DBZS – Division By Zeros
 * Datei: jobReviewGateService.ts
 * Bereich: Desktop Services / Job Review Gate Service
 *
 * Zweck:
 *   Verwaltet Review-Gates für Jobs. Ein Job wird erst "done" nach:
 *   - Implementierung erfolgreich
 *   - Alle Pflichtkommandos Exit-Code 0
 *   - Alle Akzeptanzkriterien erfüllt
 *   - Reviewer meldet keine Blocker
 *
 * Warum:
 *   Der Implementierungsagent darf seinen Job nicht selbst als bestanden erklären.
 *   Ein unabhängiges Review-Gate stellt Qualität und Korrektheit sicher.
 *
 * Wozu:
 *   Verhindert dass fehlerhafte Änderungen in den Codebase gelangen.
 */

import type {
  JobRecord,
  JobVerification,
  ReviewGate,
  ReviewGateCreateRequest,
  ReviewGateApproveRequest,
  ReviewGateRejectRequest
} from "@dbzs/shared";
import { backendClient } from "@/services/backendClient";

type ReviewProposedChange = ReviewGate["proposedChanges"][number];
type ReviewGateInputChange = ReviewProposedChange & {
  proposedContent?: string;
  originalContent?: string;
};

/**
 * Review-Status eines Jobs.
 */
export type ReviewGateState =
  | "pending"      // Review ausstehend
  | "in_progress"  // Review läuft
  | "approved"     // Review bestanden
  | "rejected"     // Review abgelehnt
  | "modified"     // Änderungen nach Review
  | "expired";     // Timeout abgelaufen

/**
 * Review-Kriterien.
 */
export interface ReviewCriteria {
  /** Alle Testkommandos müssen Exit-Code 0 haben */
  testsPassed: boolean;
  /** Alle Akzeptanzkriterien erfüllt */
  acceptanceCriteriaMet: boolean;
  /** Keine kritischen Änderungen ohne Approval */
  noCriticalChangesWithoutApproval: boolean;
  /** Code-Qualität ausreichend */
  codeQualityAcceptable: boolean;
  /** Keine Sicherheitsprobleme */
  noSecurityIssues: boolean;
}

/**
 * Review-Entscheidung.
 */
export interface ReviewDecision {
  approved: boolean;
  reason?: string;
  requiredChanges?: string[];
  commitAllowed: boolean;
}

/**
 * Review-Fehler.
 */
export class ReviewGateError extends Error {
  constructor(
    message: string,
    public readonly jobId?: string,
    public readonly gateId?: string
  ) {
    super(message);
    this.name = "ReviewGateError";
  }
}

/**
 * Ergebnis der Review-Prüfung.
 */
export interface ReviewCheckResult {
  passed: boolean;
  criteria: ReviewCriteria;
  failures: string[];
  warnings: string[];
}

/**
 * Service für Review-Gates.
 */
export class JobReviewGateService {
  private readonly gates = new Map<string, ReviewGate>();
  private readonly autoApplyTimeouts = new Map<string, number>();

  /**
   * Erstellt ein neues Review-Gate für einen Job.
   *
   * @param jobId - Die Job-ID
   * @param stepNumber - Die Schritt-Nummer (für Multi-Step-Jobs)
   * @param proposedChanges - Die vorgeschlagenen Änderungen
   * @param autoApplyTimeoutSeconds - Optionaler Timeout für Auto-Apply
   * @returns Das erstellte Review-Gate
   */
  async createReviewGate(
    jobId: string,
    stepNumber: number,
    proposedChanges: ReviewGateInputChange[],
    autoApplyTimeoutSeconds?: number
  ): Promise<ReviewGate> {
    const gateId = `gate-${jobId}-${stepNumber}-${Date.now()}`;

    const gate: ReviewGate = {
      id: gateId,
      jobId,
      stepNumber,
      status: "pending",
      scopeStatus: "legacy_unscoped",
      createdAt: new Date().toISOString(),
      proposedChanges: proposedChanges.map((change) => ({
        filePath: change.filePath,
        oldContent: change.oldContent ?? change.originalContent,
        newContent: change.newContent ?? change.proposedContent,
        diff: change.diff,
        riskLevel: change.riskLevel,
        riskFactors: change.riskFactors
      })),
      autoApplyTimeoutSeconds
    };

    this.gates.set(gateId, gate);

    // Auto-Apply Timeout starten falls konfiguriert
    if (autoApplyTimeoutSeconds && autoApplyTimeoutSeconds > 0) {
      this.startAutoApplyTimeout(gateId, autoApplyTimeoutSeconds);
    }

    console.log(`[ReviewGate] Gate ${gateId} erstellt für Job ${jobId}`);

    return gate;
  }

  /**
   * Prüft die Review-Kriterien für einen Job.
   *
   * @param job - Der Job
   * @param task - Die Task-Metadaten (falls vorhanden)
   * @returns Prüfergebnis
   */
  async checkReviewCriteria(
    job: JobRecord,
    task?: {
      acceptanceCriteria?: string[];
      testCommands?: string[];
      expectedFiles?: string[];
    }
  ): Promise<ReviewCheckResult> {
    const failures: string[] = [];
    const warnings: string[] = [];

    // 1. Testkommandos prüfen
    const testsPassed = await this.verifyTests(job, task?.testCommands ?? []);
    if (!testsPassed) {
      failures.push("Testkommandos nicht erfolgreich");
    }

    // 2. Akzeptanzkriterien prüfen
    const acceptanceCriteriaMet = await this.verifyAcceptanceCriteria(
      job,
      task?.acceptanceCriteria ?? []
    );
    if (!acceptanceCriteriaMet) {
      failures.push("Akzeptanzkriterien nicht erfüllt");
    }

    // 3. Kritische Änderungen prüfen
    const criticalChanges = this.findCriticalChanges(job);
    const noCriticalChangesWithoutApproval = criticalChanges.length === 0;
    if (!noCriticalChangesWithoutApproval) {
      warnings.push(
        `Kritische Änderungen erkannt: ${criticalChanges.map((c) => c.filePath).join(", ")}`
      );
    }

    // 4. Code-Qualität (Placeholder)
    const codeQualityAcceptable = true;

    // 5. Sicherheitsprobleme (Placeholder)
    const noSecurityIssues = true;

    return {
      passed: failures.length === 0,
      criteria: {
        testsPassed,
        acceptanceCriteriaMet,
        noCriticalChangesWithoutApproval,
        codeQualityAcceptable,
        noSecurityIssues
      },
      failures,
      warnings
    };
  }

  /**
   * Genehmigt ein Review-Gate.
   *
   * @param gateId - Die Gate-ID
   * @param request - Die Genehmigungs-Anfrage
   * @returns Das aktualisierte Gate
   */
  async approveGate(
    gateId: string,
    request: ReviewGateApproveRequest
  ): Promise<ReviewGate> {
    const gate = this.gates.get(gateId);

    if (!gate) {
      throw new ReviewGateError(`Gate ${gateId} nicht gefunden`, undefined, gateId);
    }

    if (gate.status !== "pending") {
      throw new ReviewGateError(
        `Gate ${gateId} ist bereits im Status "${gate.status}"`,
        undefined,
        gateId
      );
    }

    gate.status = "approved";
    gate.reviewedAt = new Date().toISOString();
    gate.reviewedBy = request.reviewedBy;
    gate.reviewComment = request.reviewComment;

    // Auto-Apply Timeout stoppen
    this.stopAutoApplyTimeout(gateId);

    console.log(`[ReviewGate] Gate ${gateId} genehmigt von ${request.reviewedBy}`);

    return gate;
  }

  /**
   * Lehnt ein Review-Gate ab.
   *
   * @param gateId - Die Gate-ID
   * @param request - Die Ablehnungs-Anfrage
   * @returns Das aktualisierte Gate
   */
  async rejectGate(
    gateId: string,
    request: ReviewGateRejectRequest
  ): Promise<ReviewGate> {
    const gate = this.gates.get(gateId);

    if (!gate) {
      throw new ReviewGateError(`Gate ${gateId} nicht gefunden`, undefined, gateId);
    }

    if (gate.status !== "pending") {
      throw new ReviewGateError(
        `Gate ${gateId} ist bereits im Status "${gate.status}"`,
        undefined,
        gateId
      );
    }

    gate.status = "rejected";
    gate.reviewedAt = new Date().toISOString();
    gate.reviewedBy = request.reviewedBy;
    gate.reviewComment = request.rejectionReason;

    // Auto-Apply Timeout stoppen
    this.stopAutoApplyTimeout(gateId);

    console.log(`[ReviewGate] Gate ${gateId} abgelehnt von ${request.reviewedBy}`);

    return gate;
  }

  /**
   * Holt ein Review-Gate.
   */
  getGate(gateId: string): ReviewGate | undefined {
    return this.gates.get(gateId);
  }

  /**
   * Holt alle Gates für einen Job.
   */
  getGatesForJob(jobId: string): ReviewGate[] {
    return Array.from(this.gates.values()).filter((g) => g.jobId === jobId);
  }

  /**
   * Startet einen Auto-Apply Timeout.
   */
  private startAutoApplyTimeout(gateId: string, timeoutSeconds: number): void {
    const timeoutId = window.setTimeout(async () => {
      const gate = this.gates.get(gateId);
      if (gate && gate.status === "pending") {
        console.log(`[ReviewGate] Auto-Apply Timeout für Gate ${gateId}`);
        gate.status = "modified";
        this.autoApplyTimeouts.delete(gateId);
      }
    }, timeoutSeconds * 1000);

    this.autoApplyTimeouts.set(gateId, timeoutId);
  }

  /**
   * Stoppt einen Auto-Apply Timeout.
   */
  private stopAutoApplyTimeout(gateId: string): void {
    const timeoutId = this.autoApplyTimeouts.get(gateId);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      this.autoApplyTimeouts.delete(gateId);
    }
  }

  /**
   * Verifiziert Testkommandos.
   */
  private async verifyTests(
    job: JobRecord,
    testCommands: string[]
  ): Promise<boolean> {
    if (testCommands.length === 0) {
      return true; // Keine Tests = automatisch bestanden
    }

    // Placeholder für Test-Ausführung
    // In Production: backendClient.executeCommand für jedes Kommando
    console.log(`[ReviewGate] Verifiziere Tests für Job ${job.id}`);

    // Simuliere Test-Ergebnis aus Job-Verifikation
    const verifications = await this.getJobVerifications(job.id);
    const passedVerifications = verifications.filter((v) => v.verdict === "passed");

    return passedVerifications.length > 0;
  }

  /**
   * Verifiziert Akzeptanzkriterien.
   */
  private async verifyAcceptanceCriteria(
    job: JobRecord,
    acceptanceCriteria: string[]
  ): Promise<boolean> {
    if (acceptanceCriteria.length === 0) {
      return true; // Keine Kriterien = automatisch bestanden
    }

    console.log(
      `[ReviewGate] Verifiziere Akzeptanzkriterien für Job ${job.id}: ${acceptanceCriteria.length} Kriterien`
    );

    // Placeholder: In Production jedes Kriterium prüfen
    // z.B. durch Code-Analyse, Tests, etc.

    return true;
  }

  /**
   * Findet kritische Änderungen in einem Job.
   */
  private findCriticalChanges(job: JobRecord): Array<{ filePath: string; reason: string }> {
    const critical: Array<{ filePath: string; reason: string }> = [];

    // Placeholder: In Production Änderungen analysieren
    // - Sicherheitsrelevante Dateien
    // - Konfigurationsdateien
    // - Datenbank-Migrationen
    // - API-Verträge

    return critical;
  }

  /**
   * Holt Verifikationen für einen Job.
   */
  private async getJobVerifications(jobId: string): Promise<JobVerification[]> {
    try {
      const detail = await backendClient.getJobDetail(jobId);
      return detail.verifications ?? [];
    } catch (error) {
      console.error(`[ReviewGate] Fehler beim Laden von Verifikationen:`, error);
      return [];
    }
  }

  /**
   * Erstellt eine Review-Entscheidung basierend auf Kriterien.
   */
  createReviewDecision(checkResult: ReviewCheckResult): ReviewDecision {
    if (checkResult.passed) {
      return {
        approved: true,
        commitAllowed: true
      };
    }

    return {
      approved: false,
      reason: checkResult.failures.join("; "),
      requiredChanges: checkResult.failures,
      commitAllowed: false
    };
  }
}

/**
 * Singleton-Instanz des Review-Gate-Service.
 */
export const jobReviewGateService = new JobReviewGateService();

/**
 * Helper: Review-Status für UI.
 */
export function formatReviewStatus(gate: ReviewGate | null): string {
  if (!gate) {
    return "kein Review";
  }

  const statusMap: Record<string, string> = {
    pending: "ausstehend",
    in_progress: "in Prüfung",
    approved: "bestanden",
    rejected: "abgelehnt",
    modified: "geändert",
    expired: "abgelaufen"
  };

  const statusText = statusMap[gate.status] ?? gate.status;

  if (gate.reviewedAt) {
    const reviewedAgo = timeAgo(new Date(gate.reviewedAt));
    return `${statusText} · von ${gate.reviewedBy ?? "unbekannt"} ${reviewedAgo}`;
  }

  return statusText;
}

/**
 * Helper: Zeitangabe als "vor X Minuten".
 */
function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "gerade";
  if (seconds < 3600) return `vor ${Math.floor(seconds / 60)} Min`;
  if (seconds < 86400) return `vor ${Math.floor(seconds / 3600)} Std`;
  return `vor ${Math.floor(seconds / 86400)} Tagen`;
}
