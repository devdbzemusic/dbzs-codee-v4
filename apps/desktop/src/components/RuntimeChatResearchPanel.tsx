import React from "react";
import { Button, SectionCard, StatusPill } from "@/components/ui";
import { useRuntimeChatStore } from "@/stores/runtimeChatStore";
import { resolveStatusVocabulary } from "@/utils/statusVocabulary";

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
  const statusVocabulary = resolveStatusVocabulary(
    isResearching ? "running" : webResearchStatus === "succeeded" ? "completed" : webResearchStatus
  );
  const isWaitingApproval =
    (((webResearchApprovalMode === "ask_once_per_run" && !webResearchApprovedForRun) ||
      webResearchApprovalMode === "ask_every_request") &&
      (hasActiveSearch || hasActiveFetch) &&
      webResearchStatus === "idle");

  if (!hasActiveSearch && !hasActiveFetch && webResearchCitations.length === 0 && !webResearchError) {
    return null;
  }

  return (
    <SectionCard
      title="Web-Recherche"
      description="Zeigt an, ob der Chat gerade sucht, lädt oder auf eine Netzwerkfreigabe wartet."
      actions={
        <>
          <StatusPill label="Status" tone={statusVocabulary.tone} value={statusVocabulary.label} />
          <span className="rounded border border-dbzs-border/60 bg-dbzs-bg/50 px-2 py-1 text-[10px] text-dbzs-muted">
            Modus: {webResearchApprovalMode}
          </span>
        </>
      }
    >
      {isWaitingApproval ? (
        <div className="mb-2 rounded border border-dbzs-amber/40 bg-dbzs-amber/10 px-3 py-2">
          <div className="mb-2 text-[11px] font-medium text-dbzs-amber">
            Netzwerkfreigabe für Recherche angefragt
          </div>
          {activeWebSearches.map((search, index) => (
            <div className="mb-2 text-[10px] text-dbzs-text" key={`search-req-${index}`}>
              <strong>Websuche:</strong> &ldquo;{search.query}&rdquo;<br />
              <span className="text-dbzs-muted">Zweck: {search.purpose}</span>
            </div>
          ))}
          {activeWebFetches.map((fetch, index) => (
            <div className="mb-2 text-[10px] text-dbzs-text" key={`fetch-req-${index}`}>
              <strong>URL laden:</strong> {fetch.url}<br />
              <span className="text-dbzs-muted">Zweck: {fetch.purpose}</span>
            </div>
          ))}
          <div className="mt-2 flex gap-2">
            <Button variant="primary" onClick={() => approveWebResearch()}>
              Freigeben
            </Button>
            <Button variant="danger" onClick={() => rejectWebResearch()}>
              Ablehnen
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-1 text-[10px]">
        {activeWebSearches.map((search, index) => (
          <div className="rounded border border-dbzs-cyan/20 bg-dbzs-cyan/5 px-2 py-1 text-dbzs-cyan" key={`search-active-${index}`}>
            Suche läuft: &ldquo;{search.query}&rdquo;
          </div>
        ))}
        {activeWebFetches.map((fetch, index) => (
          <div className="rounded border border-dbzs-cyan/20 bg-dbzs-cyan/5 px-2 py-1 text-dbzs-cyan" key={`fetch-active-${index}`}>
            Lade Quelle: {fetch.url}
          </div>
        ))}
      </div>

      {webResearchCitations.length > 0 ? (
        <div className="mt-3 border-t border-dbzs-border/60 pt-2">
          <div className="mb-2 text-[11px] font-medium text-dbzs-green">Verifizierte Quellen</div>
          <div className="flex flex-wrap gap-2">
            {webResearchCitations.map((citation, index) => (
              <a
                key={`citation-${index}`}
                href={citation.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={citation.sourceTitle ?? citation.sourceUrl}
                className="inline-flex items-center rounded border border-dbzs-green/30 bg-dbzs-green/10 px-2 py-1 text-[10px] text-dbzs-green no-underline transition-colors hover:bg-dbzs-green/20"
              >
                [{citation.id}] {citation.sourceDomain}
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {webResearchError ? (
        <div className="mt-2 text-[10px] text-dbzs-red">Fehler: {webResearchError}</div>
      ) : null}
    </SectionCard>
  );
};
