/*
 * DBZS – Division By Zeros
 * Datei: modelLabIpc.ts
 * Bereich: Electron Main / IPC
 *
 * Zweck:
 *   Registriert die IPC-Handler fuer das Model Lab (backend/app/model_lab,
 *   Router unter /model-lab/*). Analog zu runtimeAndJobIpc.ts ausgelagert,
 *   damit main.ts nicht weiter waechst.
 */

import { ipcMain } from "electron";
import type {
  ModelLabCollectionCreate,
  ModelLabBenchmarkRequest,
  ModelLabCertificationRequest,
  ModelLabMetadataUpdate,
  ModelLabProbeRequest,
  ModelLabRoleAssignmentRequest,
  ModelLabScanRequest,
  ModelLabSourceCreate
} from "@dbzs/shared";

interface RegisterModelLabIpcOptions {
  requestBackend: <T>(pathname: string, init?: RequestInit) => Promise<T>;
}

export function registerModelLabIpcHandlers(options: RegisterModelLabIpcOptions): void {
  const { requestBackend } = options;

  ipcMain.handle("dbzs:model-lab:sources:list", () => requestBackend("/model-lab/sources"));
  ipcMain.handle("dbzs:model-lab:sources:create", (_event, request: ModelLabSourceCreate) =>
    requestBackend("/model-lab/sources", {
      method: "POST",
      body: JSON.stringify(request)
    })
  );
  ipcMain.handle("dbzs:model-lab:scan", (_event, request?: ModelLabScanRequest) =>
    requestBackend("/model-lab/scan", {
      method: "POST",
      body: JSON.stringify(request ?? {})
    })
  );
  ipcMain.handle("dbzs:model-lab:jobs:list", () => requestBackend("/model-lab/jobs"));
  ipcMain.handle("dbzs:model-lab:models:list", () => requestBackend("/model-lab/models"));
  ipcMain.handle("dbzs:model-lab:models:get", (_event, bundleId: string) =>
    requestBackend(`/model-lab/models/${encodeURIComponent(bundleId)}`)
  );
  ipcMain.handle(
    "dbzs:model-lab:models:update-metadata",
    (_event, bundleId: string, request: ModelLabMetadataUpdate) =>
      requestBackend(`/model-lab/models/${encodeURIComponent(bundleId)}/metadata`, {
        method: "PUT",
        body: JSON.stringify(request)
      })
  );
  ipcMain.handle("dbzs:model-lab:collections:list", () => requestBackend("/model-lab/collections"));
  ipcMain.handle("dbzs:model-lab:collections:create", (_event, request: ModelLabCollectionCreate) =>
    requestBackend("/model-lab/collections", {
      method: "POST",
      body: JSON.stringify(request)
    })
  );
  ipcMain.handle(
    "dbzs:model-lab:collections:add-member",
    (_event, collectionId: string, bundleId: string) =>
      requestBackend(`/model-lab/collections/${encodeURIComponent(collectionId)}/members`, {
        method: "POST",
        body: JSON.stringify({ bundle_id: bundleId })
      })
  );
  ipcMain.handle(
    "dbzs:model-lab:collections:remove-member",
    (_event, collectionId: string, bundleId: string) =>
      requestBackend(
        `/model-lab/collections/${encodeURIComponent(collectionId)}/members/${encodeURIComponent(bundleId)}`,
        { method: "DELETE" }
      )
  );
  ipcMain.handle("dbzs:model-lab:duplicates", () => requestBackend("/model-lab/duplicates"));
  ipcMain.handle(
    "dbzs:model-lab:hf-search",
    (_event, query: string, category = "", limit = 25) => {
      const params = new URLSearchParams({ query });
      if (category) {
        params.set("category", category);
      }
      params.set("limit", String(limit));
      return requestBackend(`/model-lab/hf/search?${params.toString()}`);
    }
  );
  ipcMain.handle("dbzs:model-lab:hf-repo", (_event, repoId: string, revision?: string) => {
    const params = revision ? `?revision=${encodeURIComponent(revision)}` : "";
    return requestBackend(`/model-lab/hf/repos/${encodeURIComponent(repoId)}${params}`);
  });
  ipcMain.handle("dbzs:model-lab:hardware", () => requestBackend("/model-lab/hardware"));
  ipcMain.handle("dbzs:model-lab:logical-models:list", () => requestBackend("/model-lab/logical-models"));
  ipcMain.handle("dbzs:model-lab:logical-models:get", (_event, logicalModelId: string) =>
    requestBackend(`/model-lab/logical-models/${encodeURIComponent(logicalModelId)}`)
  );
  ipcMain.handle("dbzs:model-lab:variants:list", (_event, logicalModelId?: string) => {
    const params = logicalModelId ? `?logical_model_id=${encodeURIComponent(logicalModelId)}` : "";
    return requestBackend(`/model-lab/variants${params}`);
  });
  ipcMain.handle("dbzs:model-lab:runtime-adapters:list", () => requestBackend("/model-lab/runtime-adapters"));
  ipcMain.handle("dbzs:model-lab:runtime-presets:list", () => requestBackend("/model-lab/runtime-presets"));
  ipcMain.handle("dbzs:model-lab:probe", (_event, request: ModelLabProbeRequest) =>
    requestBackend("/model-lab/probe", {
      method: "POST",
      body: JSON.stringify(request)
    })
  );
  ipcMain.handle("dbzs:model-lab:probe-runs:list", (_event, bundleId?: string) => {
    const params = bundleId ? `?bundle_id=${encodeURIComponent(bundleId)}` : "";
    return requestBackend(`/model-lab/probe-runs${params}`);
  });
  ipcMain.handle("dbzs:model-lab:benchmark", (_event, request: ModelLabBenchmarkRequest) =>
    requestBackend("/model-lab/benchmark", {
      method: "POST",
      body: JSON.stringify(request)
    })
  );
  ipcMain.handle("dbzs:model-lab:benchmark-runs:list", (_event, bundleId?: string) => {
    const params = bundleId ? `?bundle_id=${encodeURIComponent(bundleId)}` : "";
    return requestBackend(`/model-lab/benchmark-runs${params}`);
  });
  ipcMain.handle("dbzs:model-lab:certifications:create", (_event, request: ModelLabCertificationRequest) =>
    requestBackend("/model-lab/certifications", {
      method: "POST",
      body: JSON.stringify(request)
    })
  );
  ipcMain.handle("dbzs:model-lab:certifications:list", (_event, bundleId?: string) => {
    const params = bundleId ? `?bundle_id=${encodeURIComponent(bundleId)}` : "";
    return requestBackend(`/model-lab/certifications${params}`);
  });
  ipcMain.handle("dbzs:model-lab:role-assignments:create", (_event, request: ModelLabRoleAssignmentRequest) =>
    requestBackend("/model-lab/role-assignments", {
      method: "POST",
      body: JSON.stringify(request)
    })
  );
  ipcMain.handle("dbzs:model-lab:role-assignments:list", (_event, role?: string) => {
    const params = role ? `?role=${encodeURIComponent(role)}` : "";
    return requestBackend(`/model-lab/role-assignments${params}`);
  });
  ipcMain.handle("dbzs:model-lab:failures:list", (_event, bundleId?: string) => {
    const params = bundleId ? `?bundle_id=${encodeURIComponent(bundleId)}` : "";
    return requestBackend(`/model-lab/failures${params}`);
  });
}
