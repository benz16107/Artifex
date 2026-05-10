"use client";

import type { JobPayload } from "@/lib/api";
import { outputUrl } from "@/lib/api";

type PipelineConceptRefsProps = {
  conceptReferences?: JobPayload["concept_references"];
  /** Visible label above the thumbnails */
  title?: string;
};

const KEYS = ["front", "three_quarter"] as const;

export function PipelineConceptRefs({
  conceptReferences,
  title = "Concept references",
}: PipelineConceptRefsProps) {
  const tiles: { key: (typeof KEYS)[number]; url: string; label: string }[] = [];
  for (const key of KEYS) {
    const url = outputUrl(conceptReferences?.[key]);
    if (url) {
      tiles.push({
        key,
        url,
        label: key === "three_quarter" ? "Three-quarter" : "Front",
      });
    }
  }

  if (tiles.length === 0) return null;

  return (
    <div className="pipelineConceptRefs" aria-label={title}>
      <p className="pipelineConceptRefs__title">{title}</p>
      <div className="pipelineConceptRefs__row">
        {tiles.map(({ key, url, label }) => (
          <figure key={key} className="pipelineConceptRefs__fig">
            <figcaption className="pipelineConceptRefs__cap">{label}</figcaption>
            <div className="pipelineConceptRefs__frame">
              <img src={url} alt={`${label} concept reference`} className="pipelineConceptRefs__img" />
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}
