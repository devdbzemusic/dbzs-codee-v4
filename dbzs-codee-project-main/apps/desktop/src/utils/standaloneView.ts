export type StandaloneView = "settings" | "runtime-chat" | "platform-diagnostics" | null;

const STANDALONE_VIEWS = new Set<Exclude<StandaloneView, null>>([
  "settings",
  "runtime-chat",
  "platform-diagnostics"
]);

function isStandaloneView(value: string | undefined | null): value is Exclude<StandaloneView, null> {
  return value != null && STANDALONE_VIEWS.has(value as Exclude<StandaloneView, null>);
}

export function readStandaloneView(): StandaloneView {
  const hash = globalThis.location.hash.replace(/^#/, "").trim().toLowerCase();
  if (isStandaloneView(hash)) {
    return hash;
  }

  const queryView = new URLSearchParams(globalThis.location.search).get("view")?.trim().toLowerCase();
  if (isStandaloneView(queryView)) {
    return queryView;
  }

  return null;
}

export function buildRuntimeChatWindowUrl(rendererUrl: string): string {
  const base = rendererUrl.split("#")[0]?.split("?")[0] ?? rendererUrl;
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalizedBase}/?view=runtime-chat#runtime-chat`;
}
