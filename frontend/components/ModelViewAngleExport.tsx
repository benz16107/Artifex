"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { outputUrl } from "@/lib/api";
import {
  MODEL_VIEW_SHOTS,
  captureModelViewsToZip,
  modelViewerWhenLoaded,
  type ModelViewerCaptureElement,
} from "@/lib/modelViewScreenshots";

type ModelViewAngleExportProps = {
  glbPath?: string;
  jobId: string;
};

export function ModelViewAngleExport({ glbPath, jobId }: ModelViewAngleExportProps) {
  const glbUrl = outputUrl(glbPath);
  const hintId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);
  const viewerRef = useRef<ModelViewerCaptureElement | null>(null);

  const start = useCallback(() => {
    if (!glbUrl) return;
    setError(null);
    setBusy(true);
    setRunId((r) => r + 1);
  }, [glbUrl]);

  useEffect(() => {
    if (runId === 0) return;
    const el = viewerRef.current;
    if (!el) {
      setBusy(false);
      return;
    }

    const ac = new AbortController();
    const { signal } = ac;

    (async () => {
      try {
        await modelViewerWhenLoaded(el);
        if (signal.aborted) return;
        const zipBlob = await captureModelViewsToZip(el, undefined, { signal });
        if (signal.aborted) return;
        const safeId = jobId.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 24);
        const objectUrl = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = `model_views_${safeId || "export"}.zip`;
        a.rel = "noopener";
        a.click();
        URL.revokeObjectURL(objectUrl);
      } catch (e) {
        if (signal.aborted) return;
        const err = e as Error;
        if (err.name === "AbortError") return;
        setError(err.message || "Could not generate views.");
      } finally {
        setBusy(false);
      }
    })();

    return () => {
      ac.abort();
    };
  }, [runId, jobId]);

  if (!glbUrl) return null;

  return (
    <div className="modelViewAngleExport">
      {busy ? (
        <div className="modelViewAngleExport__host" aria-hidden="true">
          {/* @ts-expect-error model-viewer is a custom element */}
          <model-viewer
            ref={(node: ModelViewerCaptureElement | null) => {
              viewerRef.current = node;
            }}
            key={runId}
            src={glbUrl}
            environment-image="neutral"
            shadow-intensity="1"
            exposure="1"
            interaction-prompt="none"
            interpolation-decay="32"
            className="modelViewAngleExport__viewer"
          />
        </div>
      ) : null}

      <p className="panel__muted" id={hintId}>
        Renders {MODEL_VIEW_SHOTS.length} PNGs (front, sides, back, top, bottom, four quarter angles, and two hero
        angles) using the same lighting as the preview, then downloads a single ZIP.
      </p>
      <div className="panel__actions">
        <button type="button" className="button button--ghost" onClick={start} disabled={busy} aria-describedby={hintId}>
          {busy ? "Generating views…" : "Download multi-angle PNGs (ZIP)"}
        </button>
      </div>
      {error ? (
        <p className="panel__fineprint" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
