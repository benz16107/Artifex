import type { JobPayload, ResearchBrief, ResearchBriefField } from "@/lib/api";

export type ResearchBriefSection = {
  key: ResearchBriefField;
  label: string;
  description: string;
  placeholder: string;
};

/** Ordered, human-readable definitions of the structured research brief. */
export const RESEARCH_BRIEF_SECTIONS: readonly ResearchBriefSection[] = [
  {
    key: "brand_snapshot",
    label: "Brand snapshot",
    description: "Who the company is, who it serves, and how it positions itself.",
    placeholder:
      "Two to four sentences on the company, audience, and how it presents itself in market.",
  },
  {
    key: "visual_packaging_cues",
    label: "Visual & packaging cues",
    description: "Colors, finishes, materials, logo usage, packaging conventions.",
    placeholder:
      "Bullet the recurring visual signals: palette, finishes, materials, logo treatment, typography, packaging norms.",
  },
  {
    key: "category_competitive_notes",
    label: "Category & market",
    description: "Category norms, competitive context, what differentiation looks like.",
    placeholder:
      "Where this product sits in its category. What competitors do well, and what would make this version feel distinct.",
  },
  {
    key: "financial_snapshot",
    label: "Financial signals → product implications",
    description:
      "Revenue, profitability, capital allocation — translated into product decisions (material grade, finish, packaging spend, price tier).",
    placeholder:
      "Recent financial signals (revenue trajectory, profitability, cost discipline, capital allocation) and what each implies for material grade, finish quality, packaging investment, and price tier.",
  },
  {
    key: "corporate_strategy",
    label: "Corporate strategy → product direction",
    description:
      "Stated strategic priorities, target segments, growth bets — translated into what kind of product this should become.",
    placeholder:
      "Stated strategic priorities, target segments, sustainability or technology themes, and what each implies for the product archetype, feature emphasis, target user, and visual tone.",
  },
] as const;

const SECTION_LABEL_BY_KEY: Record<ResearchBriefField, string> = RESEARCH_BRIEF_SECTIONS.reduce(
  (acc, s) => {
    acc[s.key] = s.label;
    return acc;
  },
  {} as Record<ResearchBriefField, string>,
);

/** Build the digest blob the image model receives from a structured brief. */
export function digestFromBrief(brief: ResearchBrief | null | undefined): string {
  if (!brief) return "";
  const parts: string[] = [];
  for (const section of RESEARCH_BRIEF_SECTIONS) {
    const v = (brief[section.key] ?? "").trim();
    if (!v) continue;
    parts.push(`${SECTION_LABEL_BY_KEY[section.key]}:\n${v}`);
  }
  return parts.join("\n\n").trim();
}

/** Read all five sections from a job (always returns strings, never undefined). */
export function readResearchBrief(job: JobPayload | null | undefined): Record<ResearchBriefField, string> {
  const brief = job?.research_brief ?? null;
  const out = {} as Record<ResearchBriefField, string>;
  for (const section of RESEARCH_BRIEF_SECTIONS) {
    out[section.key] = (brief?.[section.key] ?? "").trim();
  }
  return out;
}

/** True when any section has content; used to decide between rendering cards or fallback prose. */
export function hasStructuredBrief(brief: ResearchBrief | null | undefined): boolean {
  if (!brief) return false;
  return RESEARCH_BRIEF_SECTIONS.some((s) => (brief[s.key] ?? "").trim().length > 0);
}

/** Single narrative block — kept for legacy fallbacks (e.g. older jobs without structured brief). */
export function buildResearchSummaryMessage(job: JobPayload): string {
  const structured = digestFromBrief(job.research_brief);
  if (structured) return structured;
  const digest = job.research_digest?.trim();
  if (digest) return digest;
  return "Research is ready. Open optional details in the main panel if you want sources and raw prompts, or generate reference images.";
}
