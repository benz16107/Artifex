"use client";

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";

import { postAnalyzeAssets } from "@/lib/api";

const MAX_FILES = 6;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const ACCEPT_HINT =
  "image/*,application/pdf,.pdf,text/*,.md,.markdown,.txt,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.rtf,.log,.toml,.ini";

export type ReferenceFilesHandle = {
  /** Analyze files still in "ready" state; merge into context; return new sections for the same request (React state may not have flushed yet). */
  flushPendingReferenceFilesForGenerate: () => Promise<string[]>;
  /** Drop all selected files and any surfaced errors/warnings. Used when starting a fresh prototype. */
  reset: () => void;
};

type Props = {
  disabled: boolean;
  onMergeDocumentSections: (sections: string[]) => void;
};

type FileEntry = {
  key: string;
  file: File;
  status: "ready" | "analyzed" | "failed";
  error?: string;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function newKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const ReferenceFilesBlock = forwardRef<ReferenceFilesHandle | null, Props>(function ReferenceFilesBlock(
  { disabled, onMergeDocumentSections },
  ref,
) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);

  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const analyzeInteractionLock = useRef(false);

  useEffect(() => {
    analyzeInteractionLock.current = false;
  }, []);

  const totalSize = useMemo(() => entries.reduce((sum, e) => sum + e.file.size, 0), [entries]);
  const pendingEntries = useMemo(() => entries.filter((e) => e.status !== "analyzed"), [entries]);

  const blocked = disabled || analyzing;

  const applyAnalyzeResponse = useCallback(
    (targets: FileEntry[], rawSections: string[], respWarnings: string[] | undefined): string[] => {
      const cleaned = rawSections.map((s) => s.trim()).filter(Boolean);
      if (cleaned.length > 0) {
        onMergeDocumentSections(cleaned);
      }
      setWarnings(respWarnings ?? []);
      setEntries((prev) =>
        prev.map((entry) => {
          const ti = targets.findIndex((t) => t.key === entry.key);
          if (ti === -1) return entry;
          if (entry.status === "analyzed") return entry;
          const piece = (rawSections[ti] ?? "").trim();
          if (piece) {
            return { ...entry, status: "analyzed", error: undefined };
          }
          const warning =
            respWarnings && respWarnings.length > 0
              ? respWarnings[Math.min(ti, respWarnings.length - 1)]
              : "No usable context was extracted from this file.";
          return { ...entry, status: "failed", error: warning };
        }),
      );
      return cleaned;
    },
    [onMergeDocumentSections],
  );

  const handlePickFiles = useCallback((incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return;
    setPickError(null);
    setActionError(null);
    setHint(null);
    setEntries((prev) => {
      let runningTotal = prev.reduce((sum, e) => sum + e.file.size, 0);
      const accepted: FileEntry[] = [];
      const rejected: string[] = [];
      for (const file of Array.from(incoming)) {
        if (prev.length + accepted.length >= MAX_FILES) {
          rejected.push(`${file.name}: limit of ${MAX_FILES} files reached.`);
          continue;
        }
        if (runningTotal + file.size > MAX_TOTAL_BYTES) {
          rejected.push(
            `${file.name}: would exceed combined ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))} MB upload cap.`,
          );
          continue;
        }
        runningTotal += file.size;
        accepted.push({ key: newKey(), file, status: "ready" });
      }
      if (rejected.length > 0) {
        queueMicrotask(() => setPickError(rejected.join(" ")));
      }
      if (accepted.length === 0) {
        return prev;
      }
      return [...prev, ...accepted];
    });
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  const removeEntry = useCallback(
    (key: string) => {
      if (analyzing) return;
      setEntries((prev) => prev.filter((e) => e.key !== key));
    },
    [analyzing],
  );

  const clearAnalyzed = useCallback(() => {
    setEntries((prev) => prev.filter((e) => e.status !== "analyzed"));
    setWarnings([]);
  }, []);

  const onAnalyze = useCallback(async () => {
    if (disabledRef.current) return;
    if (analyzeInteractionLock.current) {
      setHint("Still working on the previous analyze request…");
      return;
    }
    const targets = entriesRef.current.filter((e) => e.status !== "analyzed");
    if (targets.length === 0) {
      setActionError(null);
      if (entriesRef.current.length === 0) {
        setHint("Use “Choose files” above to add references, then click analyze to merge them into context.");
      } else {
        setHint("Every selected file is already analyzed. Add new files or use “Clear analyzed”.");
      }
      return;
    }
    analyzeInteractionLock.current = true;
    setActionError(null);
    setHint(null);
    setWarnings([]);
    setAnalyzing(true);
    try {
      const { sections, warnings: respWarnings } = await postAnalyzeAssets(targets.map((e) => e.file));
      const cleaned = applyAnalyzeResponse(targets, sections, respWarnings);
      if (cleaned.length > 0) {
        setHint(
          cleaned.length === 1
            ? "Added 1 reference summary to context documents."
            : `Added ${cleaned.length} reference summaries to context documents.`,
        );
      } else if ((respWarnings ?? []).length > 0) {
        setActionError(respWarnings![0]);
      } else {
        setActionError("No usable context was extracted from the selected files.");
      }
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      analyzeInteractionLock.current = false;
      setAnalyzing(false);
    }
  }, [applyAnalyzeResponse]);

  useImperativeHandle(
    ref,
    () => ({
      flushPendingReferenceFilesForGenerate: async () => {
        const ready = entriesRef.current.filter((e) => e.status === "ready");
        if (ready.length === 0) {
          return [];
        }
        setActionError(null);
        setAnalyzing(true);
        try {
          const { sections, warnings: respWarnings } = await postAnalyzeAssets(ready.map((e) => e.file));
          return applyAnalyzeResponse(ready, sections, respWarnings);
        } catch (e) {
          setActionError((e as Error).message);
          throw e;
        } finally {
          setAnalyzing(false);
        }
      },
      reset: () => {
        setEntries([]);
        setPickError(null);
        setActionError(null);
        setHint(null);
        setWarnings([]);
        if (inputRef.current) {
          inputRef.current.value = "";
        }
      },
    }),
    [applyAnalyzeResponse],
  );

  const hasAnalyzed = entries.some((e) => e.status === "analyzed");

  return (
    <div className="referenceFiles">
      <label className="field__label" htmlFor={inputId}>
        Reference files <span className="field__optional">optional</span>
      </label>
      <p className="field__hint referenceFiles__intro">
        Upload up to {MAX_FILES} photos, sketches, PDFs, or text documents. Each one is analyzed with vision/LLM and
        the extracted design context is merged into the context documents above (or automatically when you generate if
        you have not clicked analyze yet).
      </p>
      <div className="referenceFiles__pickerRow">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          className="referenceFiles__input"
          multiple
          accept={ACCEPT_HINT}
          disabled={blocked || entries.length >= MAX_FILES}
          onChange={(event) => handlePickFiles(event.target.files)}
        />
        {hasAnalyzed ? (
          <button
            type="button"
            className="button button--ghost referenceFiles__clearBtn"
            onClick={clearAnalyzed}
            disabled={blocked}
          >
            Clear analyzed
          </button>
        ) : null}
      </div>
      {entries.length > 0 ? (
        <ul className="referenceFiles__list" aria-label="Selected reference files">
          {entries.map((entry) => (
            <li key={entry.key} className={`referenceFiles__item referenceFiles__item--${entry.status}`}>
              <span className="referenceFiles__name" title={entry.file.name}>
                {entry.file.name}
              </span>
              <span className="referenceFiles__meta">
                {formatBytes(entry.file.size)} ·{" "}
                {entry.status === "analyzed" ? "analyzed" : entry.status === "failed" ? "failed" : "ready"}
              </span>
              <button
                type="button"
                className="referenceFiles__remove"
                onClick={() => removeEntry(entry.key)}
                disabled={analyzing}
                aria-label={`Remove ${entry.file.name}`}
              >
                ×
              </button>
              {entry.status === "failed" && entry.error ? (
                <span className="referenceFiles__itemError">{entry.error}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="referenceFiles__actions">
        <button
          type="button"
          className="button button--ghost referenceFiles__analyzeBtn"
          onClick={onAnalyze}
          disabled={blocked}
          title="Extract design context from selected files and merge it into context documents above."
        >
          {analyzing
            ? "Analyzing…"
            : pendingEntries.length > 1
              ? `Analyze & add ${pendingEntries.length} files`
              : "Analyze & add to context"}
        </button>
        <span className="referenceFiles__hint">
          {entries.length > 0
            ? `${entries.length}/${MAX_FILES} selected · ${formatBytes(totalSize)} total`
            : `0/${MAX_FILES} selected`}
        </span>
      </div>
      {pickError ? (
        <p className="field__hint referenceFiles__error" role="alert">
          {pickError}
        </p>
      ) : null}
      {actionError ? (
        <p className="field__hint referenceFiles__error" role="alert">
          {actionError}
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="referenceFiles__warnings" role="status">
          {warnings.map((w, i) => (
            <li key={`${i}-${w.slice(0, 40)}`}>{w}</li>
          ))}
        </ul>
      ) : null}
      {hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
});
