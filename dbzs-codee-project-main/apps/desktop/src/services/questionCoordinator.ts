import type { AssistantAnswer } from "@dbzs/shared";

interface PendingQuestionRequest {
  requestId: string;
  resolved?: AssistantAnswer;
  waiter?: {
    resolve: (answer: AssistantAnswer) => void;
    reject: (error: Error) => void;
  };
}

function createAbortError(): Error {
  const error = new Error("Question wait aborted.");
  error.name = "AbortError";
  return error;
}

class QuestionCoordinator {
  private requests = new Map<string, PendingQuestionRequest>();

  register(requestId: string): void {
    const existing = this.requests.get(requestId);
    if (existing) {
      return;
    }
    this.requests.set(requestId, { requestId });
  }

  waitForAnswer(requestId: string, signal?: AbortSignal): Promise<AssistantAnswer> {
    const request = this.requests.get(requestId) ?? { requestId };
    this.requests.set(requestId, request);

    if (request.resolved) {
      const resolved = request.resolved;
      this.requests.delete(requestId);
      return Promise.resolve(resolved);
    }

    if (signal?.aborted) {
      return Promise.reject(signal.reason instanceof Error ? signal.reason : createAbortError());
    }

    return new Promise<AssistantAnswer>((resolve, reject) => {
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

  resolve(requestId: string, answer: AssistantAnswer): void {
    const request = this.requests.get(requestId) ?? { requestId };

    request.resolved = answer;
    this.requests.set(requestId, request);
    if (request.waiter) {
      request.waiter.resolve(answer);
      this.requests.delete(requestId);
    }
  }

  cancel(requestId: string, questionId: string): void {
    this.resolve(requestId, {
      questionId,
      answeredAt: new Date().toISOString(),
      skipped: true
    });
  }

  reset(): void {
    for (const request of this.requests.values()) {
      request.waiter?.reject(createAbortError());
    }
    this.requests.clear();
  }
}

export const questionCoordinator = new QuestionCoordinator();
