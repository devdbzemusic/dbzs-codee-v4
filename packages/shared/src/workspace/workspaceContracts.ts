export interface WorkspaceFile {
  path: string;
  name: string;
  content: string;
  language: string;
}

export interface WorkspaceProjectFile {
  path: string;
  relativePath: string;
  name: string;
  language: string;
}

export interface WorkspaceState {
  projectPath: string | null;
  projectName: string | null;
  lastOpenedAt: string | null;
  maxFileScanCount: number;
}

export type ProjectWorkflow = "dbzs-typescript" | "python-runtime" | "empty";

export interface ProjectCreationResult {
  projectPath: string;
  projectName: string;
  workflow: ProjectWorkflow;
  createdFiles: string[];
}

export interface SaveFileRequest {
  path: string;
  content: string;
}

export interface SaveFileAsRequest {
  defaultPath?: string;
  content: string;
}
