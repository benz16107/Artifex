"use client";

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { postAnalyzeAssets, type AnalyzeAssetRole } from "@/lib/api";

const MAX_FILES = 6;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const ACCEPT_REFERENCE =
  "image/*,application/pdf,.pdf,text/*,.md,.markdown,.txt,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.rtf,.log,.toml,.ini";
const ACCEPT_SKETCH = "image/*,.png,.jpg,.jpeg,.webp,.gif,.heif,.heic";

export type AddAssetKind = "image_file" | "sketch";

export type AddAssetsHandle = {
  openFilePicker: (kind: AddAssetKind) => void;
  flushPendingReferenceFilesForGenerate: () => Promise<string[]>;
  reset: () => void;
  canGenerateConceptArt: () => boolean;
};

type Entry = {
  key: string;
  file: File;
  kind: AddAssetKind;
  status: "pending" | "analyzing" | "analyzed" | "failed";
  error?: string;
  mergedSection?: string;
};

function newKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  return Boolean(e && typeof e === "object" && "name" in e && (e as { name: string }).name === "AbortError");
}

function canGenerate(entries: Entry[]): boolean {
  if (entries.length === 0) return true;
  return entries.every((e) => e.status === "analyzed");
}

type Props = {
  disabled?: boolean;
  onMergeDocumentSections: (sections: string[]) => void;
  onRevokeDocumentSections: (sections: string[]) => void;
  onGenerateReadinessChange?: (ready: boolean) => void;
};

export const AddAssetsBlock = forwardRef<AddAssetsHandle | null, Props>(function AddAssetsBlock(
  { disabled, onMergeDocumentSections, onRevokeDocumentSections, onGenerateReadinessChange },
  ref,
) {
  const baseId = useId();
  const refInputRef = useRef<HTMLInputElement>(null);
  const sketchInputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const abortByKeyRef = useRef<Record<string, AbortController>>({});
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const totalSize = entries.reduce((sum, e) => sum + e.file.size, 0);

  useEffect(() => {
    onGenerateReadinessChange?.(canGenerate(entries));
  }, [entries, onGenerateReadinessChange]);

  const analyzeOne = useCallback(
    async (entry: Entry) => {
      const ac = new AbortController();
      abortByKeyRef.current[entry.key] = ac;
      setEntries((prev) =>
        prev.map((e) => (e.key === entry.key && e.status === "pending" ? { ...e, status: "analyzing" } : e)),
      );
      const role: AnalyzeAssetRole = entry.kind === "sketch" ? "sketch" : "reference";
      try {
        const { sections, warnings: respWarnings } = await postAnalyzeAssets([entry.file], {
          roles: [role],
          signal: ac.signal,
        });
        const raw = sections[0] ?? "";
        const piece = raw.trim();
        if (!entriesRef.current.some((e) => e.key === entry.key)) {
          return;
        }
        if (piece) {
          onMergeDocumentSections([piece]);
          setEntries((prev) =>
            prev.map((e) =>
              e.key === entry.key ? { ...e, status: "analyzed", error: undefined, mergedSection: piece } : e,
            ),
          );
        } else {
          const warning =
            respWarnings && respWarnings.length > 0
              ? respWarnings[0]
              : "No usable context was extracted from this file.";
          setEntries((prev) =>
            prev.map((e) => (e.key === entry.key ? { ...e, status: "failed", error: warning } : e)),
          );
        }
      } catch (e) {
        if (isAbortError(e)) {
          return;
        }
        setEntries((prev) => {
          if (!prev.some((x) => x.key === entry.key)) return prev;
          return prev.map((x) =>
            x.key === entry.key ? { ...x, status: "failed", error: (e as Error).message || "Analysis failed" } : x,
          );
        });
      } finally {
        delete abortByKeyRef.current[entry.key];
      }
    },
    [onMergeDocumentSections],
  );

  const handlePickFiles = useCallback(
    async (incoming: FileList | null, kind: AddAssetKind) => {
      if (!incoming || incoming.length === 0) return;
      if (disabledRef.current) return;
      setPickError(null);
      const accepted: Entry[] = [];
      const rejected: string[] = [];
      const prev = entriesRef.current;
      let runningTotal = prev.reduce((sum, e) => sum + e.file.size, 0);
      for (const file of Array.from(incoming)) {
        if (prev.length + accepted.length >= MAX_FILES) {
          rejected.push(`${file.name}: limit of ${MAX_FILES} files reached.`);
          continue;
        }
        if (kind === "sketch" && !file.type.startsWith("image/")) {
          rejected.push(`${file.name}: sketches must be image files.`);
          continue;
        }
        if (runningTotal + file.size > MAX_TOTAL_BYTES) {
          rejected.push(
            `${file.name}: would exceed combined ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))} MB upload cap.`,
          );
          continue;
        }
        runningTotal += file.size;
        accepted.push({ key: newKey(), file, kind, status: "pending" });
      }
      if (rejected.length > 0) {
        setPickError(rejected.join(" "));
      }
      if (accepted.length === 0) {
        return;
      }
      flushSync(() => {
        setEntries((e) => [...e, ...accepted]);
      });
      for (const entry of accepted) {
        if (disabledRef.current) break;
        if (!entriesRef.current.some((e) => e.key === entry.key && e.status === "pending")) continue;
        await analyzeOne(entry);
      }
      if (refInputRef.current) refInputRef.current.value = "";
      if (sketchInputRef.current) sketchInputRef.current.value = "";
    },
    [analyzeOne],
  );

  const removeEntry = useCallback(
    (key: string) => {
      abortByKeyRef.current[key]?.abort();
      setEntries((prev) => {
        const target = prev.find((e) => e.key === key);
        if (target?.mergedSection) {
          onRevokeDocumentSections([target.mergedSection]);
        }
        return prev.filter((e) => e.key !== key);
      });
    },
    [onRevokeDocumentSections],
  );

  useImperativeHandle(
    ref,
    () => ({
      openFilePicker: (kind: AddAssetKind) => {
        if (disabledRef.current) return;
        if (kind === "sketch") {
          sketchInputRef.current?.click();
        } else {
          refInputRef.current?.click();
        }
      },
      flushPendingReferenceFilesForGenerate: async () => {
        const snap = entriesRef.current;
        if (snap.some((e) => e.status === "pending" || e.status === "analyzing")) {
          throw new Error(
            "Wait until every added file finishes analyzing, or remove it with the delete control beside the file.",
          );
        }
        if (snap.some((e) => e.status === "failed")) {
          throw new Error("Remove failed uploads (or clear the list) before generating concept art.");
        }
        return [];
      },
      reset: () => {
        Object.values(abortByKeyRef.current).forEach((c) => c.abort());
        abortByKeyRef.current = {};
        setEntries([]);
        setPickError(null);
        if (refInputRef.current) refInputRef.current.value = "";
        if (sketchInputRef.current) sketchInputRef.current.value = "";
      },
      canGenerateConceptArt: () => canGenerate(entriesRef.current),
    }),
    [onRevokeDocumentSections],
  );

  return (
    <div className="addAssets">
      <input
        ref={refInputRef}
        id={`${baseId}-ref`}
        type="file"
        className="addAssets__hiddenInput"
        multiple
        accept={ACCEPT_REFERENCE}
        aria-hidden
        tabIndex={-1}
        onChange={(e) => void handlePickFiles(e.target.files, "image_file")}
      />
      <input
        ref={sketchInputRef}
        id={`${baseId}-sketch`}
        type="file"
        className="addAssets__hiddenInput"
        multiple
        accept={ACCEPT_SKETCH}
        aria-hidden
        tabIndex={-1}
        onChange={(e) => void handlePickFiles(e.target.files, "sketch")}
      />

      {entries.length > 0 ? (
        <ul className="addAssets__list" aria-label="Added files">
          {entries.map((entry) => (
            <li key={entry.key} className={`addAssets__item addAssets__item--${entry.status}`}>
              <div className="addAssets__itemMain">
                <span className="addAssets__badge" title={entry.kind === "sketch" ? "Sketch" : "Image / file"}>
                  {entry.kind === "sketch" ? "Sketch" : "File"}
                </span>
                <span className="addAssets__name" title={entry.file.name}>
                  {entry.file.name}
                </span>
                <span className="addAssets__meta">
                  {formatBytes(entry.file.size)} ·{" "}
                  {entry.status === "analyzed"
                    ? "Analyzed"
                    : entry.status === "failed"
                      ? "Failed"
                      : entry.status === "analyzing"
                        ? "Analyzing…"
                        : "Queued"}
                </span>
              </div>
              <button
                type="button"
                className="addAssets__remove"
                onClick={() => removeEntry(entry.key)}
                disabled={Boolean(disabled)}
                aria-label={entry.status === "analyzing" ? `Cancel and remove ${entry.file.name}` : `Remove ${entry.file.name}`}
              >
                {entry.status === "analyzing" ? "Cancel" : "Remove"}
              </button>
              {entry.status === "failed" && entry.error ? (
                <p className="addAssets__itemError" role="alert">
                  {entry.error}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {pickError ? (
        <p className="field__hint addAssets__error" role="alert">
          {pickError}
        </p>
      ) : null}
    </div>
  );
});
