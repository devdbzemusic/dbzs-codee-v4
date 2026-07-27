export interface AgentWebSearchRequest {
  id: string;
  runId: string;
  query: string;
  purpose: string;
  maxResults: number;
  recencyDays?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  safeSearch: "strict" | "moderate" | "off";
  language?: string;
  region?: string;
  timeoutMs?: number;
  createdAt: string;
}

export interface AgentWebSearchResultItem {
  id: string;
  title: string;
  url: string;
  displayUrl: string;
  snippet: string;
  sourceDomain: string;
  publishedAt?: string;
  rank: number;
}

export interface AgentWebSearchResult {
  requestId: string;
  query: string;
  provider: string;
  status: "succeeded" | "failed" | "cancelled" | "timed_out";
  items: AgentWebSearchResultItem[];
  error?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface AgentWebFetchRequest {
  id: string;
  runId: string;
  url: string;
  purpose: string;
  maxBytes?: number;
  timeoutMs?: number;
  createdAt: string;
}

export interface AgentWebDocument {
  requestId: string;
  url: string;
  finalUrl: string;
  title?: string;
  sourceDomain: string;
  contentType: string;
  text: string;
  extractedAt: string;
  publishedAt?: string;
  author?: string;
  truncated: boolean;
}

export interface AgentCitation {
  id: string;
  sourceUrl: string;
  sourceTitle?: string;
  sourceDomain: string;
  quote?: string;
  startOffset?: number;
  endOffset?: number;
  retrievedAt: string;
}

export interface WebResearchPolicy {
  enabled: boolean;
  maxResults: number;
  maxFetchesPerTurn: number;
  maxBytesPerDocument: number;
  maxTotalBytesPerTurn: number;
  defaultTimeoutMs: number;
  allowHttp: boolean;
  allowPrivateNetworks: boolean;
  allowLocalhost: boolean;
  allowedDomains?: string[];
  blockedDomains: string[];
  requireUserApprovalForNetwork: boolean;
}

export const DEFAULT_WEB_RESEARCH_POLICY: WebResearchPolicy = {
  enabled: true,
  maxResults: 20,
  maxFetchesPerTurn: 5,
  maxBytesPerDocument: 1024 * 1024,
  maxTotalBytesPerTurn: 4 * 1024 * 1024,
  defaultTimeoutMs: 36000,
  allowHttp: true,
  allowPrivateNetworks: true,
  allowLocalhost: true,
  blockedDomains: [],
  requireUserApprovalForNetwork: true
};
