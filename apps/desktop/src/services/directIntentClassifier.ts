export interface DirectIntent {
  intent: "workspace_query";
  operation: "count_files" | "search_files" | "list_files";
  pattern: string;
  scope: "workspace";
  requiresModel: false;
  requiresToolExecution: true;
  toolId: "workspace-file-tool";
  toolInput: {
    operation: "count" | "search" | "list";
    pattern: string;
    caseSensitive: boolean;
  };
}

/**
 * Erkennt einfache, deterministische Anfragen, die direkt von einem Tool ohne LLM beantwortet werden können.
 * PRIORITÄT 1
 */
export function directIntentClassifier(input: string): DirectIntent | null {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, " ");

  // "Zähle alle gguf Modelle im Workspace"
  const countMatch = normalized.match(
    /^(zähle|count)\s+(alle|all)\s+(.+?)\s*(dateien|files|modelle|models)?\s*(im|in)\s+(ws|workspace)$/
  );
  if (countMatch) {
    const patternPart = countMatch[3];
    const pattern = patternPart.includes(".") ? `*${patternPart}` : `*.${patternPart}`;
    return {
      intent: "workspace_query",
      operation: "count_files",
      pattern,
      scope: "workspace",
      requiresModel: false,
      requiresToolExecution: true,
      toolId: "workspace-file-tool",
      toolInput: {
        operation: "count",
        pattern,
        caseSensitive: false
      }
    };
  }

  // "Suche alle README-Dateien"
  const searchMatch = normalized.match(
    /^(suche|find|search)\s+(alle|all)\s+(.+?)\s*(dateien|files)?\s*(im|in)?\s*(ws|workspace)?$/
  );
  if (searchMatch) {
    const patternPart = searchMatch[3];
    const pattern = patternPart.includes(".") ? `*${patternPart}` : `*${patternPart}*`;
    return {
      intent: "workspace_query",
      operation: "search_files",
      pattern,
      scope: "workspace",
      requiresModel: false,
      requiresToolExecution: true,
      toolId: "workspace-file-tool",
      toolInput: {
        operation: "search",
        pattern,
        caseSensitive: false
      }
    };
  }

  // "Liste alle tsx-Dateien"
  const listMatch = normalized.match(
    /^(liste|list)\s+(alle|all)\s+(.+?)\s*(dateien|files)?\s*(im|in)?\s*(ws|workspace)?$/
  );
  if (listMatch) {
    const patternPart = listMatch[3];
    const pattern = patternPart.includes(".") ? `*${patternPart}` : `*.${patternPart}`;
    return {
      intent: "workspace_query",
      operation: "list_files",
      pattern,
      scope: "workspace",
      requiresModel: false,
      requiresToolExecution: true,
      toolId: "workspace-file-tool",
      toolInput: {
        operation: "list",
        pattern,
        caseSensitive: false
      }
    };
  }

  return null;
}
