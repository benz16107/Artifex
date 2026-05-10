import type { JobPayload } from "@/lib/api";

/** Single narrative block for the research preview step (rail, main stage, or compose home). */
export function buildResearchSummaryMessage(job: JobPayload): string {
  const chunks: string[] = [];
  const b = job.research_brief;
  if (b?.brand_snapshot?.trim()) chunks.push(b.brand_snapshot.trim());
  if (b?.visual_packaging_cues?.trim()) chunks.push(b.visual_packaging_cues.trim());
  if (b?.category_competitive_notes?.trim()) chunks.push(b.category_competitive_notes.trim());
  const digest = job.research_digest?.trim();
  if (digest) chunks.push(digest);
  return (
    chunks.join("\n\n") ||
    "Research is ready. Open optional details in the main panel if you want sources and raw prompts, or generate reference images."
  );
}
