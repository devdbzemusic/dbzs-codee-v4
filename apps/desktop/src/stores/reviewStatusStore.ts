import { create } from "zustand";
import type { ReviewReport } from "@dbzs/shared";

interface ReviewStatusState {
  latestReport: ReviewReport | null;
  hasErrors: boolean;
  setLatestReport: (report: ReviewReport | null) => void;
  clear: () => void;
}

export const useReviewStatusStore = create<ReviewStatusState>((set) => ({
  latestReport: null,
  hasErrors: false,
  setLatestReport: (report) =>
    set({
      latestReport: report,
      hasErrors: report ? report.findings.some((finding) => finding.severity === "error") : false
    }),
  clear: () =>
    set({
      latestReport: null,
      hasErrors: false
    })
}));
