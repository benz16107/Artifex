import type { JobPayload } from "@/lib/api";
import { outputUrl } from "@/lib/api";

/** Preview image for portfolio tiles and nav (mesh preview, concept front, or three-quarter). */
export function jobPortfolioThumbUrl(job: JobPayload): string | null {
  const preview = outputUrl(job.files?.preview);
  if (preview) return preview;
  const sel = job.selected_concept_style_index ?? 0;
  const rowFront = job.concept_styles?.find((s) => s.index === sel)?.front;
  const front = outputUrl(rowFront ?? job.concept_references?.front);
  if (front) return front;
  return outputUrl(job.concept_references?.three_quarter) ?? null;
}
