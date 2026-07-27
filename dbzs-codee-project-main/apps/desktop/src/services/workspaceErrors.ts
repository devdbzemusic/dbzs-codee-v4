export type WorkspaceErrorCode =
  | "WORKSPACE_NOT_ACTIVE"
  | "WORKSPACE_PATH_DENIED"
  | "WORKSPACE_SCAN_DENIED"
  | "WORKSPACE_FILE_TOO_LARGE"
  | "WORKSPACE_WRITE_TOO_LARGE"
  | "WORKSPACE_PREVIEW_MISSING"
  | "WORKSPACE_PREVIEW_MISMATCH"
  | "WORKSPACE_FILE_CHANGED"
  | "WORKSPACE_INVALID_STATE"
  | "WORKSPACE_INTERNAL_ERROR";

interface ParsedWorkspaceError {
  code: WorkspaceErrorCode | null;
  message: string;
}

const WORKSPACE_ERROR_PREFIX = /^\[(WORKSPACE_[A-Z_]+)]\s*(.*)$/;

export function parseWorkspaceError(error: unknown): ParsedWorkspaceError {
  if (!(error instanceof Error)) {
    return {
      code: null,
      message: "Workspace-Operation ist fehlgeschlagen."
    };
  }

  const match = error.message.match(WORKSPACE_ERROR_PREFIX);
  if (!match) {
    return {
      code: null,
      message: error.message || "Workspace-Operation ist fehlgeschlagen."
    };
  }

  return {
    code: match[1] as WorkspaceErrorCode,
    message: match[2]?.trim() || error.message
  };
}

export function toWorkspaceUserMessage(error: unknown, fallback: string): string {
  const parsed = parseWorkspaceError(error);
  switch (parsed.code) {
    case "WORKSPACE_NOT_ACTIVE":
      return "Kein aktiver Workspace vorhanden. Bitte zuerst ein Projekt oeffnen.";
    case "WORKSPACE_PATH_DENIED":
    case "WORKSPACE_SCAN_DENIED":
      return "Zugriff ausserhalb des aktiven Workspace ist nicht erlaubt.";
    case "WORKSPACE_FILE_TOO_LARGE":
      return "Die Datei ist zu gross fuer das sichere Lese-Limit im Workspace.";
    case "WORKSPACE_WRITE_TOO_LARGE":
      return "Die Aenderung ist zu gross fuer das sichere Schreib-Limit im Workspace.";
    case "WORKSPACE_PREVIEW_MISSING":
      return "Die Diff-Preview ist abgelaufen. Bitte Speichern erneut ausfuehren.";
    case "WORKSPACE_PREVIEW_MISMATCH":
      return "Die gespeicherte Diff-Preview passt nicht mehr. Bitte Speichern erneut ausfuehren.";
    case "WORKSPACE_FILE_CHANGED":
      return "Die Datei wurde extern geaendert. Bitte Diff-Preview neu laden.";
    case "WORKSPACE_INVALID_STATE":
      return "Die Workspace-Einstellungen sind ungueltig und konnten nicht gespeichert werden.";
    case "WORKSPACE_INTERNAL_ERROR":
      return parsed.message || fallback;
    default:
      return parsed.message || fallback;
  }
}
