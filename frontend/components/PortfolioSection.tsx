"use client";

import type { JobPayload } from "@/lib/api";
import { outputUrl } from "@/lib/api";
import { friendlyGenerationPhase, friendlyJobStatus, isTerminalJobStatus } from "@/lib/flow";

type PortfolioSectionProps = {
  jobs: JobPayload[];
  onOpenJob: (job: JobPayload) => void;
  /** Pinned first tile when the user left the pipeline running from Home (Go home). */
  backgroundJob?: JobPayload | null;
  onResumePipeline?: () => void;
};

function thumbUrl(job: JobPayload): string | null {
  const preview = outputUrl(job.files?.preview);
  if (preview) return preview;
  const front = outputUrl(job.concept_references?.front);
  if (front) return front;
  return outputUrl(job.concept_references?.three_quarter) ?? null;
}

function meshBuildPhase(job: JobPayload): boolean {
  const gp = (job.generation_phase ?? "").toLowerCase();
  return gp.includes("image_to_3d") || gp.includes("to_3d");
}

function meshBusy(job: JobPayload): boolean {
  return (job.status === "queued" || job.status === "running") && meshBuildPhase(job);
}

function PortfolioLiveMedia({ job }: { job: JobPayload }) {
  const glbUrl = outputUrl(job.files?.glb);
  if (glbUrl) {
    return (
      <div className="portfolioCard__viewerSlot">
        {/* @ts-expect-error model-viewer is a custom element */}
        <model-viewer
          src={glbUrl}
          camera-controls
          auto-rotate
          shadow-intensity="1"
          exposure="1"
          environment-image="neutral"
          className="portfolioCard__modelViewer"
        />
      </div>
    );
  }

  if (meshBusy(job)) {
    return (
      <div className="portfolioCard__busySlot" aria-hidden>
        <div className="portfolioCard__busyRing" />
        <span className="portfolioCard__busyLabel">Building 3D…</span>
      </div>
    );
  }

  const src = thumbUrl(job);
  if (src) {
    return (
      <div className="portfolioCard__mediaInner">
        <img className="portfolioCard__img" src={src} alt="" loading="lazy" />
        {!isTerminalJobStatus(job.status) ? (
          <span className="portfolioCard__liveBadge">In progress</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="portfolioCard__busySlot portfolioCard__busySlot--placeholder">
      <span className="portfolioCard__placeholderLabel">Live run</span>
      {!isTerminalJobStatus(job.status) ? <span className="portfolioCard__liveBadge">In progress</span> : null}
    </div>
  );
}

export function PortfolioSection({ jobs, onOpenJob, backgroundJob, onResumePipeline }: PortfolioSectionProps) {
  const others = backgroundJob ? jobs.filter((j) => j.job_id !== backgroundJob.job_id) : jobs;
  const empty = others.length === 0 && !backgroundJob;

  return (
    <section className="portfolioSection" aria-labelledby="portfolio-heading">
      <div className="portfolioSection__head">
        <h2 id="portfolio-heading" className="portfolioSection__title">
          Your 3D models
        </h2>
        <p className="portfolioSection__sub">
          Open any run to review concepts, preview meshes, and download exports. A run you left from the pipeline stays
          pinned here with a live preview until you open it again.
        </p>
      </div>

      {empty ? (
        <div className="portfolioSection__empty">
          <p>Finished runs will appear here as tiles. Describe an idea above to start your first prototype.</p>
        </div>
      ) : (
        <ul className="portfolioGrid">
          {backgroundJob && onResumePipeline ? (
            <li key={`__live__${backgroundJob.job_id}`}>
              <button
                type="button"
                className={`portfolioCard portfolioCard--live${!isTerminalJobStatus(backgroundJob.status) ? " portfolioCard--liveActive" : ""}`}
                onClick={() => onResumePipeline()}
              >
                <div className="portfolioCard__media">
                  <PortfolioLiveMedia job={backgroundJob} />
                </div>
                <div className="portfolioCard__body">
                  <span className="portfolioCard__status">
                    {isTerminalJobStatus(backgroundJob.status)
                      ? friendlyJobStatus(backgroundJob.status)
                      : `${friendlyJobStatus(backgroundJob.status)}${
                          backgroundJob.generation_phase
                            ? ` · ${friendlyGenerationPhase(backgroundJob.generation_phase)}`
                            : ""
                        }`}
                  </span>
                  <span className="portfolioCard__prompt">{backgroundJob.prompt}</span>
                </div>
              </button>
            </li>
          ) : null}
          {others.map((job) => {
            const src = thumbUrl(job);
            const status = job.status;
            return (
              <li key={job.job_id}>
                <button type="button" className="portfolioCard" onClick={() => onOpenJob(job)}>
                  <div className="portfolioCard__media">
                    {src ? (
                      <img className="portfolioCard__img" src={src} alt="" loading="lazy" />
                    ) : (
                      <div className="portfolioCard__placeholder" aria-hidden>
                        <span className="portfolioCard__placeholderLabel">Model</span>
                      </div>
                    )}
                  </div>
                  <div className="portfolioCard__body">
                    <span className="portfolioCard__status">{status}</span>
                    <span className="portfolioCard__prompt">{job.prompt}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
