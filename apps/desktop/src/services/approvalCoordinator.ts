export type ApprovalResolutionStatus = "approved" | "rejected" | "cancelled" | "expired";

export interface ApprovalResolution {
  requestId: string;
  status: ApprovalResolutionStatus;
  resolvedAt: string;
}

interface PendingApprovalRequest {
  requestId: string;
  resolved?: ApprovalResolution;
  waiter?: {
    resolve: (resolution: ApprovalResolution) => void;
    reject: (error: Error) => void;
  };
}

function createAbortError(): Error {
  const error = new Error("Approval wait aborted.");
  error.name = "AbortError";
  return error;
}

class ApprovalCoordinator {
  private requests = new Map<string, PendingApprovalRequest>();

  register(requestId: string): void {
    const existing = this.requests.get(requestId);
    if (existing) {
      return;
    }
    this.requests.set(requestId, { requestId });
  }

  waitForResolution(requestId: string, signal?: AbortSignal): Promise<ApprovalResolution> {
    const request = this.requests.get(requestId) ?? { requestId };
    this.requests.set(requestId, request);

    if (request.resolved) {
      return Promise.resolve(request.resolved);
    }

    if (signal?.aborted) {
      return Promise.reject(signal.reason instanceof Error ? signal.reason : createAbortError());
    }

    return new Promise<ApprovalResolution>((resolve, reject) => {
      request.waiter = { resolve, reject };
      if (signal) {
        const onAbort = () => {
          signal.removeEventListener("abort", onAbort);
          if (this.requests.get(requestId)?.waiter?.reject === reject) {
            this.requests.delete(requestId);
          }
          reject(signal.reason instanceof Error ? signal.reason : createAbortError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  resolve(requestId: string, status: ApprovalResolutionStatus): void {
    const request = this.requests.get(requestId) ?? { requestId };
    const resolution: ApprovalResolution = {
      requestId,
      status,
      resolvedAt: new Date().toISOString()
    };

    request.resolved = resolution;
    this.requests.set(requestId, request);
    request.waiter?.resolve(resolution);
    this.requests.delete(requestId);
  }

  cancel(requestId: string): void {
    this.resolve(requestId, "cancelled");
  }

  expire(requestId: string): void {
    this.resolve(requestId, "expired");
  }

  reset(): void {
    for (const request of this.requests.values()) {
      request.waiter?.reject(createAbortError());
    }
    this.requests.clear();
  }
}

export const approvalCoordinator = new ApprovalCoordinator();
