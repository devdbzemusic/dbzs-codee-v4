import type { ReviewGate } from "@dbzs/shared";

const BACKEND_URL = `http://127.0.0.1:${import.meta.env.VITE_DBZS_BACKEND_PORT ?? "8876"}`;

interface PendingReviewGatesResponse {
  gates: Array<{
    id: string;
    job_id: string;
    step_number: number;
    status: string;
    created_at: string;
    workspace_root?: string | null;
    workspace_id?: string | null;
    run_id?: string | null;
    scope_status: "scoped" | "legacy_unscoped";
    proposed_changes_count: number;
    proposed_changes: Array<{
      file_path: string;
      risk_level: string;
      risk_factors?: string[];
      diff: string;
    }>;
  }>;
}

function mapGate(raw: PendingReviewGatesResponse["gates"][number]): ReviewGate {
  return {
    id: raw.id,
    jobId: raw.job_id,
    stepNumber: raw.step_number,
    status: raw.status as ReviewGate["status"],
    createdAt: raw.created_at,
    workspaceRoot: raw.workspace_root ?? undefined,
    workspaceId: raw.workspace_id ?? undefined,
    runId: raw.run_id ?? undefined,
    scopeStatus: raw.scope_status,
    proposedChanges: raw.proposed_changes.map((change) => ({
      filePath: change.file_path,
      diff: change.diff,
      riskLevel: (change.risk_level as "low" | "medium" | "high") ?? "medium",
      riskFactors: change.risk_factors ?? []
    }))
  };
}

export const reviewGateService = {
  async listPending(options: { jobId?: string; workspaceId?: string } = {}): Promise<ReviewGate[]> {
    const query = new URLSearchParams();
    if (options.jobId) query.set("job_id", options.jobId);
    if (options.workspaceId) query.set("workspace_id", options.workspaceId);
    const url = `${BACKEND_URL}/review-gates/pending${query.size > 0 ? `?${query.toString()}` : ""}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Review-Gates konnten nicht geladen werden (${response.status}).`);
    }
    const data = (await response.json()) as PendingReviewGatesResponse;
    return (data.gates ?? []).map(mapGate);
  },

  async approve(gateId: string, workspaceId: string, reviewComment = "Freigegeben im Runtime Chat"): Promise<void> {
    const response = await fetch(`${BACKEND_URL}/review-gates/${gateId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewed_by: "runtime-chat",
        review_comment: reviewComment,
        workspace_id: workspaceId
      })
    });
    if (!response.ok) {
      throw new Error(`Review-Freigabe fehlgeschlagen (${response.status}).`);
    }
  },

  async reject(gateId: string, workspaceId: string, rejectionReason = "Abgelehnt im Runtime Chat"): Promise<void> {
    const response = await fetch(`${BACKEND_URL}/review-gates/${gateId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewed_by: "runtime-chat",
        rejection_reason: rejectionReason,
        workspace_id: workspaceId
      })
    });
    if (!response.ok) {
      throw new Error(`Review-Ablehnung fehlgeschlagen (${response.status}).`);
    }
  }
};
