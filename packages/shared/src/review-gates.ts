/**
 * Review Gate Typen für Shared Package
 */

export interface ReviewGate {
  id: string;
  jobId: string;
  stepNumber: number;
  status: 'pending' | 'approved' | 'rejected' | 'modified';
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewComment?: string;
  autoApplyTimeoutSeconds?: number;
  proposedChanges: ProposedChange[];
  workspaceRoot?: string;
  workspaceId?: string;
  runId?: string;
  scopeStatus: 'scoped' | 'legacy_unscoped';
}

export interface ProposedChange {
  filePath: string;
  oldContent?: string;
  newContent?: string;
  diff: string;
  riskLevel: 'low' | 'medium' | 'high';
  riskFactors?: string[];
}

export interface ReviewGateCreateRequest {
  jobId: string;
  stepNumber: number;
  proposedChanges: Array<{
    filePath: string;
    oldContent?: string;
    newContent?: string;
    diff: string;
    riskLevel?: 'low' | 'medium' | 'high';
    riskFactors?: string[];
  }>;
  autoApplyTimeoutSeconds?: number;
  workspaceRoot: string;
  workspaceId: string;
  runId: string;
}

export interface ReviewGateApproveRequest {
  reviewedBy: string;
  reviewComment?: string;
  workspaceId?: string;
}

export interface ReviewGateRejectRequest {
  reviewedBy: string;
  rejectionReason: string;
  workspaceId?: string;
}
