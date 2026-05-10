import type { JobPayload, JobStatus } from "@/lib/api";
import type { FlowStepId } from "@/components/FlowStepper";

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function getFlowStep(job: JobPayload | null): FlowStepId {
  if (!job) return "references";
  if (job.status === "completed") return "export";
  if (job.status === "failed" || job.status === "cancelled") {
    if (job.files?.glb) return "export";
    const gp = (job.generation_phase ?? "").toLowerCase();
    if (gp.includes("image_to_3d") || gp.includes("to_3d")) return "mesh";
    return "references";
  }
  if (job.status === "awaiting_concept_confirmation") return "references";
  if (job.status === "awaiting_image_generation_preview") return "references";
  if (job.status === "queued" || job.status === "running") {
    const gp = (job.generation_phase ?? "").toLowerCase();
    if (gp.includes("image_to_3d") || gp.includes("to_3d")) return "mesh";
    return "references";
  }
  return "references";
}

export function friendlyJobStatus(status: JobStatus): string {
  if (status === "awaiting_image_generation_preview") {
    return "Review research & image prompts";
  }
  if (status === "awaiting_concept_confirmation") {
    return "Ready for your review";
  }
  if (status === "queued") return "Queued";
  if (status === "running") return "In progress";
  if (status === "completed") return "Complete";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return status;
}

export function friendlyGenerationPhase(phase: string): string {
  switch (phase) {
    case "brand_research":
      return "Researching brand & category (web + your documents)";
    case "concept_reference_images":
      return "Generating reference images (often 1–6 min)";
    case "concept_image_to_3d":
      return "Building 3D mesh with Meshy (several minutes)";
    default:
      return phase.replace(/^concept_/, "").replace(/_/g, " ");
  }
}
