import { useRef, useState } from "react";
import type { AppSettings } from "@dbzs/shared";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSettingsDraftStore } from "./settingsDraftStore";
import { SettingsDiffPreview } from "./SettingsDiffPreview";
import {
  buildResetChanges,
  buildSettingsExportPayload,
  computeSettingsDiff,
  downloadTextFile,
  parseSettingsImport,
  type SettingsDiffEntry,
} from "./settingsTransfer";

type PendingAction =
  | { kind: "import"; changes: Partial<AppSettings>; diff: SettingsDiffEntry[]; errors: string[]; fieldErrors: Record<string, string> }
  | { kind: "reset-tab"; changes: Partial<AppSettings>; diff: SettingsDiffEntry[] }
  | { kind: "reset-global"; changes: Partial<AppSettings>; diff: SettingsDiffEntry[] }
  | null;

export function SettingsTransferBar({
  activeCategoryLabel,
  activeKeys,
}: {
  activeCategoryLabel: string;
  activeKeys: Array<keyof AppSettings>;
}) {
  const settings = useSettingsStore((state) => state.settings);
  const patchSettings = useSettingsStore((state) => state.patchSettings);
  const discardDraft = useSettingsDraftStore((state) => state.discardDraft);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const exportSettings = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadTextFile(
      `codee-settings-${stamp}.json`,
      buildSettingsExportPayload(settings),
    );
    setMessage("Export erstellt (Secrets redigiert).");
  };

  const onImportFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const result = parseSettingsImport(text, settings);
    setPending({
      kind: "import",
      changes: result.changes,
      diff: result.diff,
      errors: result.errors,
      fieldErrors: result.fieldErrors,
    });
  };

  const previewResetTab = () => {
    const changes = buildResetChanges(settings, "keys", activeKeys);
    setPending({
      kind: "reset-tab",
      changes,
      diff: computeSettingsDiff(settings, changes),
    });
  };

  const previewResetGlobal = () => {
    const changes = buildResetChanges(settings, "global");
    setPending({
      kind: "reset-global",
      changes,
      diff: computeSettingsDiff(settings, changes),
    });
  };

  const confirmPending = async () => {
    if (!pending || pending.diff.length === 0) return;
    if (pending.kind === "import" && Object.keys(pending.fieldErrors).length > 0) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      discardDraft();
      const ok = await patchSettings(pending.changes);
      if (ok) {
        setMessage(
          pending.kind === "import"
            ? `${pending.diff.length} Felder importiert.`
            : `${pending.diff.length} Felder auf Defaults gesetzt.`,
        );
        setPending(null);
      } else {
        setMessage("Übernehmen fehlgeschlagen.");
      }
    } finally {
      setBusy(false);
    }
  };

  const title =
    pending?.kind === "import"
      ? "Import-Vorschau"
      : pending?.kind === "reset-tab"
        ? "Tab auf Defaults zurücksetzen"
        : pending?.kind === "reset-global"
          ? "Alle Settings zurücksetzen"
          : "";

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          className="border border-dbzs-border px-2 py-1 text-[11px] text-dbzs-muted hover:border-dbzs-cyan/40"
          onClick={exportSettings}
          type="button"
        >
          Export
        </button>
        <button
          className="border border-dbzs-border px-2 py-1 text-[11px] text-dbzs-muted hover:border-dbzs-cyan/40"
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          Import…
        </button>
        <button
          className="border border-dbzs-border px-2 py-1 text-[11px] text-dbzs-muted hover:border-dbzs-cyan/40"
          onClick={previewResetTab}
          type="button"
        >
          {activeCategoryLabel} zurücksetzen
        </button>
        <button
          className="border border-dbzs-amber/40 px-2 py-1 text-[11px] text-dbzs-amber hover:border-dbzs-amber"
          onClick={previewResetGlobal}
          type="button"
        >
          Alles zurücksetzen
        </button>
        <input
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = "";
            void onImportFile(file);
          }}
          ref={fileInputRef}
          type="file"
        />
      </div>
      {message ? <p className="text-[10px] text-dbzs-cyan">{message}</p> : null}
      {pending ? (
        <SettingsDiffPreview
          busy={busy}
          confirmLabel={pending.kind === "import" ? "Import anwenden" : "Defaults anwenden"}
          diff={pending.diff}
          errors={pending.kind === "import" ? pending.errors : []}
          fieldErrors={pending.kind === "import" ? pending.fieldErrors : {}}
          onCancel={() => setPending(null)}
          onConfirm={() => void confirmPending()}
          title={title}
        />
      ) : null}
    </div>
  );
}
