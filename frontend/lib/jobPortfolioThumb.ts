import type { JobPayload } from "@/lib/api";
import { outputUrl } from "@/lib/api";
import { cloudinaryThumb } from "@/lib/cloudinaryDelivery";

const THUMB = 256;

/** Preview image for portfolio tiles and nav (mesh preview, concept front, or three-quarter). */
export function jobPortfolioThumbUrl(job: JobPayload): string | null {
  const preview = cloudinaryThumb(outputUrl(job.files?.preview), THUMB);
  if (preview) return preview;
  const sel = job.selected_concept_style_index ?? 0;
  const rowFront = job.concept_styles?.find((s) => s.index === sel)?.front;
  const front = cloudinaryThumb(outputUrl(rowFront ?? job.concept_references?.front), THUMB);
  if (front) return front;
  return cloudinaryThumb(outputUrl(job.concept_references?.three_quarter), THUMB) ?? null;
}
