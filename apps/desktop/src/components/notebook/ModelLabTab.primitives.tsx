import type { ModelLabStatus } from "@dbzs/shared";
import { ToneBadge, type UiTone } from "./RuntimeModelsTab.primitives";

export function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function modelLabStatusTone(status: ModelLabStatus): UiTone {
  if (status === "IDENTIFIED") {
    return "ok";
  }
  if (status === "DISCOVERED") {
    return "info";
  }
  if (status === "INCOMPLETE" || status === "UNSUPPORTED") {
    return "warn";
  }
  return "error";
}

export function ModelLabStatusBadge({ status }: { status: ModelLabStatus }) {
  return (
    <ToneBadge fit tone={modelLabStatusTone(status)}>
      {status}
    </ToneBadge>
  );
}
