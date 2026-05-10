"use client";

import type { JobPayload } from "@/lib/api";
import { outputUrl } from "@/lib/api";
import { friendlyGenerationPhase, friendlyJobStatus, isTerminalJobStatus } from "@/lib/flow";
import { jobPortfolioThumbUrl } from "@/lib/jobPortfolioThumb";
import { buildResearchSummaryMessage } from "@/lib/researchSummary";

type PortfolioSectionProps = {
  jobs: JobPayload[];
  onOpenJob: (job: JobPayload) => void;
  onDeleteJob: (job: JobPayload) => void;
  /** In-progress runs pinned on Home while you compose or start another prototype (newest first). */
  backgroundJobs?: JobPayload[];
  onResumePipeline?: (job: JobPayload) => void;
  /** When the pipeline is minimized at research preview, confirm lives here instead of above the composer. */
  imagePreviewJob?: JobPayload | null;
  researchSummaryDraft?: string;
  onChangeResearchSummaryDraft?: (value: string) => void;
  onConfirmImagePreview?: () => void;
  onSaveResearchSummaryPreview?: () => void;
  imagePreviewBusy?: boolean;
  researchPreviewSaveBusy?: boolean;
  researchSummaryDirty?: boolean;
};

function meshBuildPhase(job: JobPayload): boolean {
  const gp = (job.generation_phase ?? "").toLowerCase();
  return gp.includes("image_to_3d") || gp.includes("to_3d");
}

function meshBusy(job: JobPayload): boolean {
  return (job.status === "queued" || job.status === "running") && meshBuildPhase(job);
}

function hasInteractivePreview(job: JobPayload): boolean {
  return Boolean(outputUrl(job.files?.glb));
}

export function DeletePrototypeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M3.5 3.5V11.5C3.5 12.0523 3.94772 12.5 4.5 12.5H9.5C10.0523 12.5 10.5 12.0523 10.5 11.5V3.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path d="M2 3.5H12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.5 3.5V2.5C5.5 2.22386 5.72386 2 6 2H8C8.27614 2 8.5 2.22386 8.5 2.5V3.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 6V10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M8.5 6V10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function PortfolioLiveMedia({ job }: { job: JobPayload }) {
  const glbUrl = outputUrl(job.files?.glb);
  if (glbUrl) {
    return (
      <div className="portfolioCard__viewerSlot" aria-label="Interactive 3D prototype preview">
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

  const src = jobPortfolioThumbUrl(job);
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

type PortfolioCardProps = {
  job: JobPayload;
  onOpen: (job: JobPayload) => void;
  onDelete: (job: JobPayload) => void;
  statusLabel: string;
  live?: boolean;
};

function PortfolioCard({ job, onOpen, onDelete, statusLabel, live = false }: PortfolioCardProps) {
  const interactivePreview = hasInteractivePreview(job);

  return (
    <div
      className={[
        "portfolioCard",
        live ? "portfolioCard--live" : "",
        live && !isTerminalJobStatus(job.status) ? "portfolioCard--liveActive" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {interactivePreview ? (
        <div className="portfolioCard__media">
          <PortfolioLiveMedia job={job} />
        </div>
      ) : (
        <button
          type="button"
          className="portfolioCard__mediaButton"
          onClick={() => onOpen(job)}
          aria-label={`Open prototype: ${job.prompt}`}
        >
          <div className="portfolioCard__media">
            <PortfolioLiveMedia job={job} />
          </div>
        </button>
      )}
      <button type="button" className="portfolioCard__open" onClick={() => onOpen(job)}>
        <div className="portfolioCard__body">
          <span className="portfolioCard__status">{statusLabel}</span>
          <span className="portfolioCard__prompt">{job.prompt}</span>
        </div>
      </button>
      <button
        type="button"
        className="portfolioCard__delete"
        aria-label="Delete prototype"
        title="Delete prototype"
        onClick={() => onDelete(job)}
      >
        <DeletePrototypeIcon />
      </button>
    </div>
  );
}

export function PortfolioSection({
  jobs,
  onOpenJob,
  onDeleteJob,
  backgroundJobs = [],
  onResumePipeline,
  imagePreviewJob = null,
  researchSummaryDraft = "",
  onChangeResearchSummaryDraft,
  onConfirmImagePreview,
  onSaveResearchSummaryPreview,
  imagePreviewBusy = false,
  researchPreviewSaveBusy = false,
  researchSummaryDirty = false,
}: PortfolioSectionProps) {
  const bgIds = new Set(backgroundJobs.map((j) => j.job_id));
  const others = jobs.filter((j) => !bgIds.has(j.job_id));
  const empty = others.length === 0 && backgroundJobs.length === 0;

  return (
    <section className="portfolioSection" aria-labelledby="portfolio-heading">
      <div className="portfolioSection__head">
        <h2 id="portfolio-heading" className="portfolioSection__title">
          Your 3D models
        </h2>
        <p className="portfolioSection__sub">
          Open any run to review concepts, preview meshes, and download exports. Runs you left from the pipeline stay
          pinned here with live previews until you open them again—you can keep several going at once.
        </p>
      </div>

      {imagePreviewJob && onConfirmImagePreview ? (
        <section
          className="homeLanding__researchPreview portfolioSection__researchPreview"
          aria-label="Research ready"
        >
          <p className="homeLanding__researchPreviewEyebrow">Your prototype run</p>
          <p className="homeLanding__researchPreviewPrompt">{imagePreviewJob.prompt}</p>
          <div
            className="researchSummaryBanner homeLanding__researchBanner"
            role="region"
            aria-label="Research summary"
          >
            <p className="researchSummaryBanner__label">Research summary</p>
            {onChangeResearchSummaryDraft ? (
              <>
            <textarea
              className="researchSummaryBanner__textarea"
              id="research-summary-portfolio"
              value={researchSummaryDraft}
              onChange={(e) => onChangeResearchSummaryDraft(e.target.value)}
              rows={10}
              maxLength={8000}
              spellCheck
              disabled={imagePreviewBusy || researchPreviewSaveBusy}
              aria-describedby="research-summary-portfolio-hint"
            />
                <p className="researchSummaryBanner__hint" id="research-summary-portfolio-hint">
                  Save to rebuild the full image prompts in the pipeline. Generate reference images when you are ready
                  to run.
                </p>
                {onSaveResearchSummaryPreview ? (
                  <div className="researchSummaryBanner__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={onSaveResearchSummaryPreview}
                      disabled={
                        imagePreviewBusy || researchPreviewSaveBusy || !researchSummaryDirty
                      }
                    >
                      {researchPreviewSaveBusy ? "Saving…" : "Save"}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="researchSummaryBanner__body">{buildResearchSummaryMessage(imagePreviewJob)}</div>
            )}
          </div>
          {imagePreviewJob.research_warnings && imagePreviewJob.research_warnings.length > 0 ? (
            <p className="homeLanding__researchPreviewNotes" role="status">
              {imagePreviewJob.research_warnings.join(" · ")}
            </p>
          ) : null}
          <div className="homeLanding__researchPreviewActions">
            <button
              type="button"
              className="button button--primary"
              onClick={onConfirmImagePreview}
              disabled={imagePreviewBusy || researchPreviewSaveBusy}
            >
              {imagePreviewBusy ? "Starting…" : "Generate reference images"}
            </button>
            <p className="homeLanding__researchPreviewHint">
              Open the live pipeline tile below for sources and full prompts.
            </p>
          </div>
        </section>
      ) : null}

      {empty ? (
        <div className="portfolioSection__empty">
          <p>Finished runs will appear here as tiles. Describe an idea above to start your first prototype.</p>
        </div>
      ) : (
        <ul className="portfolioGrid">
          {backgroundJobs.length > 0 && onResumePipeline
            ? backgroundJobs.map((backgroundJob) => (
                <li key={`__live__${backgroundJob.job_id}`}>
                  <PortfolioCard
                    job={backgroundJob}
                    onOpen={onResumePipeline}
                    onDelete={onDeleteJob}
                    statusLabel={
                      isTerminalJobStatus(backgroundJob.status)
                        ? friendlyJobStatus(backgroundJob.status)
                        : `${friendlyJobStatus(backgroundJob.status)}${
                            backgroundJob.generation_phase
                              ? ` · ${friendlyGenerationPhase(backgroundJob.generation_phase)}`
                              : ""
                          }`
                    }
                    live
                  />
                </li>
              ))
            : null}
          {others.map((job) => {
            const status = job.status;
            return (
              <li key={job.job_id}>
                <PortfolioCard
                  job={job}
                  onOpen={onOpenJob}
                  onDelete={onDeleteJob}
                  statusLabel={status}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
