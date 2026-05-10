"use client";

import type { ReactNode } from "react";

import { outputUrl } from "@/lib/api";

type ModelViewerProps = {
  glbPath?: string;
  previewPath?: string;
  /** When true, show a spinner instead of the empty state (waiting for GLB). */
  waitingForMesh?: boolean;
  emptyTitle?: string;
  emptySubtitle?: string;
  /** Shown below the viewer (e.g. regenerate 3D). */
  footer?: ReactNode;
};

export function ModelViewer({
  glbPath,
  previewPath,
  waitingForMesh,
  emptyTitle = "3D preview",
  emptySubtitle = "Your interactive model appears here after Meshy finishes. Drag to orbit, scroll to zoom.",
  footer,
}: ModelViewerProps) {
  const glbUrl = outputUrl(glbPath);
  const previewUrl = outputUrl(previewPath);

  if (glbUrl) {
    return (
      <div className="stagePanel stagePanel--viewer">
        <div className="modelViewerFrame">
          {/* @ts-expect-error model-viewer is a custom element */}
          <model-viewer
            src={glbUrl}
            camera-controls
            auto-rotate
            shadow-intensity="1"
            exposure="1"
            environment-image="neutral"
            className="modelViewerEl"
          />
        </div>
        {previewUrl ? (
          <div className="previewStrip">
            <span className="previewStrip__cap">Mesh thumbnail</span>
            <img className="previewStrip__img" src={previewUrl} alt="Render thumbnail" width={160} height={160} />
          </div>
        ) : null}
        {footer}
      </div>
    );
  }

  if (waitingForMesh) {
    return (
      <div className="stagePanel stagePanel--loading">
        <div className="stageLoading">
          <div className="stageLoading__ring" aria-hidden />
          <p className="stageLoading__text">Building 3D geometry…</p>
          <p className="stageLoading__sub">This step usually takes several minutes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`stagePanel stagePanel--empty${footer ? " stagePanel--emptyWithFooter" : ""}`}>
      <div className="stageEmpty">
        <div className="stageEmpty__icon" aria-hidden>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M24 4L44 14V34L24 44L4 34V14L24 4Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
              opacity="0.35"
            />
            <path d="M24 16L34 22V30L24 36L14 30V22L24 16Z" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
        <h3 className="stageEmpty__title">{emptyTitle}</h3>
        <p className="stageEmpty__text">{emptySubtitle}</p>
      </div>
      {footer}
    </div>
  );
}
