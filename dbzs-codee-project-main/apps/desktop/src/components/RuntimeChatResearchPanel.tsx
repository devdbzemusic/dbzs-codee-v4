import React from "react";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";

export const RuntimeChatResearchPanel: React.FC = () => {
  const {
    activeWebSearches,
    activeWebFetches,
    webResearchStatus,
    webResearchError,
    webResearchCitations,
    webResearchApprovalMode,
    webResearchApprovedForRun,
    approveWebResearch,
    rejectWebResearch
  } = useRuntimeChatStore();

  const hasActiveSearch = activeWebSearches.length > 0;
  const hasActiveFetch = activeWebFetches.length > 0;
  const isResearching = webResearchStatus === "searching" || webResearchStatus === "fetching";
  const isWaitingApproval =
    (webResearchApprovalMode === "ask_once_per_run" && !webResearchApprovedForRun && (hasActiveSearch || hasActiveFetch)) ||
    (webResearchApprovalMode === "ask_every_request" && (hasActiveSearch || hasActiveFetch)) &&
    webResearchStatus === "idle";

  if (!hasActiveSearch && !hasActiveFetch && webResearchCitations.length === 0 && !webResearchError) {
    return null;
  }

  return (
    <div
      style={{
        margin: "12px 16px",
        padding: "12px 16px",
        background: "rgba(10, 15, 25, 0.75)",
        border: "1px solid rgba(0, 240, 255, 0.25)",
        borderRadius: "8px",
        boxShadow: "0 0 10px rgba(0, 240, 255, 0.1), inset 0 0 5px rgba(0, 240, 255, 0.05)",
        backdropFilter: "blur(8px)",
        color: "#d1f4ff",
        fontSize: "12px",
        fontFamily: "'Courier New', Courier, monospace"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: isWaitingApproval
                ? "#ff9900"
                : isResearching
                  ? "#00f0ff"
                  : webResearchStatus === "succeeded"
                    ? "#39ff14"
                    : webResearchStatus === "failed"
                      ? "#ff3131"
                      : "#888",
              boxShadow: isResearching ? "0 0 8px #00f0ff" : "none",
              display: "inline-block"
            }}
          />
          <strong style={{ textTransform: "uppercase", letterSpacing: "1px", color: "#00f0ff" }}>
            Web Research Pipeline
          </strong>
        </div>
        <span style={{ fontSize: "10px", color: "rgba(0, 240, 255, 0.5)" }}>
          Mode: {webResearchApprovalMode}
        </span>
      </div>

      {/* Approval Prompt */}
      {isWaitingApproval && (
        <div
          style={{
            margin: "8px 0",
            padding: "8px 12px",
            background: "rgba(255, 153, 0, 0.1)",
            border: "1px dashed rgba(255, 153, 0, 0.4)",
            borderRadius: "4px"
          }}
        >
          <div style={{ color: "#ff9900", fontWeight: "bold", marginBottom: "6px" }}>
            ⚠ Network Research Approval Requested
          </div>
          {activeWebSearches.map((s, idx) => (
            <div key={`search-req-${idx}`} style={{ marginBottom: "4px" }}>
              <strong>Web Search:</strong> &ldquo;{s.query}&rdquo;<br />
              <span style={{ color: "rgba(209, 244, 255, 0.7)" }}>Zweck: {s.purpose}</span>
            </div>
          ))}
          {activeWebFetches.map((f, idx) => (
            <div key={`fetch-req-${idx}`} style={{ marginBottom: "4px" }}>
              <strong>Fetch URL:</strong> {f.url}<br />
              <span style={{ color: "rgba(209, 244, 255, 0.7)" }}>Zweck: {f.purpose}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
            <button
              onClick={() => approveWebResearch()}
              style={{
                background: "#ff9900",
                color: "#0a0f19",
                border: "none",
                padding: "4px 12px",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: "bold"
              }}
            >
              Approve
            </button>
            <button
              onClick={() => rejectWebResearch()}
              style={{
                background: "transparent",
                color: "#ff3131",
                border: "1px solid #ff3131",
                padding: "4px 12px",
                borderRadius: "4px",
                cursor: "pointer"
              }}
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Ongoing Searches */}
      {activeWebSearches.map((s, idx) => (
        <div key={`search-active-${idx}`} style={{ margin: "4px 0", color: "rgba(0, 240, 255, 0.8)" }}>
          🔍 Searching: &ldquo;{s.query}&rdquo; ...
        </div>
      ))}

      {/* Ongoing Fetches */}
      {activeWebFetches.map((f, idx) => (
        <div key={`fetch-active-${idx}`} style={{ margin: "4px 0", color: "rgba(0, 240, 255, 0.8)" }}>
          🌐 Fetching: {f.url} ...
        </div>
      ))}

      {/* Citations Found */}
      {webResearchCitations.length > 0 && (
        <div style={{ marginTop: "8px", borderTop: "1px solid rgba(0, 240, 255, 0.15)", paddingTop: "6px" }}>
          <div style={{ fontWeight: "bold", color: "#39ff14", marginBottom: "4px" }}>Verified Sources:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {webResearchCitations.map((cit, idx) => (
              <a
                key={`citation-${idx}`}
                href={cit.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={cit.sourceTitle ?? cit.sourceUrl}
                style={{
                  display: "inline-block",
                  padding: "2px 6px",
                  background: "rgba(57, 255, 20, 0.1)",
                  border: "1px solid rgba(57, 255, 20, 0.3)",
                  borderRadius: "4px",
                  color: "#39ff14",
                  textDecoration: "none"
                }}
              >
                [{cit.id}] {cit.sourceDomain}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Errors */}
      {webResearchError && (
        <div style={{ marginTop: "6px", color: "#ff3131", fontSize: "11px" }}>
          Error: {webResearchError}
        </div>
      )}
    </div>
  );
};
