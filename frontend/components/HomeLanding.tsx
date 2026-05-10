"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { AddAssetsBlock, type AddAssetKind, type AddAssetsHandle } from "@/components/AddAssetsBlock";
import { PortfolioSection } from "@/components/PortfolioSection";
import type { JobPayload } from "@/lib/api";
import { isTerminalJobStatus } from "@/lib/flow";

function ToolPillChevron() {
  return (
    <span className="homeLanding__toolPillChevron" aria-hidden>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

type HomeLandingProps = {
  prompt: string;
  documentsText: string;
  fastReferenceImages: boolean;
  isSubmitting: boolean;
  ideaAssetsReady: boolean;
  errorText?: string | null;
  history: JobPayload[];
  onChangePrompt: (value: string) => void;
  onChangeDocumentsText: (value: string) => void;
  onChangeFastReferenceImages: (value: boolean) => void;
  onMergeDocumentSections: (sections: string[]) => void;
  onRevokeDocumentSections: (sections: string[]) => void;
  onIdeaAssetsReadyChange: (ready: boolean) => void;
  onSubmit: () => void;
  onOpenPortfolioJob: (job: JobPayload) => void;
  addAssetsRef?: RefObject<AddAssetsHandle | null>;
  /** Active pipeline job while the user is on the home composer (run continues in the background). */
  backgroundJob?: JobPayload | null;
  onResumePipeline?: () => void;
};

export function HomeLanding({
  prompt,
  documentsText,
  fastReferenceImages,
  isSubmitting,
  ideaAssetsReady,
  errorText,
  history,
  onChangePrompt,
  onChangeDocumentsText,
  onChangeFastReferenceImages,
  onMergeDocumentSections,
  onRevokeDocumentSections,
  onIdeaAssetsReadyChange,
  onSubmit,
  onOpenPortfolioJob,
  addAssetsRef,
  backgroundJob,
  onResumePipeline,
}: HomeLandingProps) {
  const pipelineBlocksNewGenerate = Boolean(backgroundJob && !isTerminalJobStatus(backgroundJob.status));
  const generateLocked = isSubmitting || !ideaAssetsReady || pipelineBlocksNewGenerate;
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addWrapRef = useRef<HTMLDivElement | null>(null);
  const preferencesConfigured = Boolean(documentsText.trim());

  useEffect(() => {
    if (!addMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = addWrapRef.current;
      if (el && !el.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [addMenuOpen]);

  function pickAddKind(kind: AddAssetKind) {
    setAddMenuOpen(false);
    addAssetsRef?.current?.openFilePicker(kind);
  }

  return (
    <div className="homeLanding">
      {errorText ? (
        <div className="alert alert--error homeLanding__alert" role="alert">
          {errorText}
        </div>
      ) : null}
      <header className="homeLanding__hero">
        <h1 className="homeLanding__title">What are you building?</h1>
        <p className="homeLanding__tagline">
          Describe your product idea. We generate concept art, then a 3D mesh you can preview and export—same flow as
          before, starting from here.
        </p>
      </header>

      <div className="homeLanding__composeStack">
        <div className="homeLanding__composer">
          <label className="homeLanding__composerLabel" htmlFor="home-idea-input">
            Your idea
          </label>
          <textarea
            id="home-idea-input"
            className="textarea homeLanding__ideaInput"
            placeholder="Describe shape, materials, colors, logos, and scale…"
            value={prompt}
            onChange={(e) => onChangePrompt(e.target.value)}
            rows={4}
          />
        </div>

        <div className="homeLanding__toolPills">
          <div className="homeLanding__addWrap" ref={addWrapRef}>
            <button
              type="button"
              className={`homeLanding__toolPill homeLanding__addBtn${addMenuOpen ? " homeLanding__toolPill--open" : ""}`}
              aria-expanded={addMenuOpen}
              aria-haspopup="menu"
              id="home-add-trigger"
              disabled={isSubmitting}
              onClick={() => setAddMenuOpen((o) => !o)}
            >
              <span className="homeLanding__toolPillIcon" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </span>
              <span>Add</span>
              <ToolPillChevron />
            </button>
            {addMenuOpen ? (
              <ul className="homeLanding__addMenu" role="menu" aria-labelledby="home-add-trigger">
                <li role="none">
                  <button type="button" className="homeLanding__addMenuItem" role="menuitem" onClick={() => pickAddKind("image_file")}>
                    Image / file
                  </button>
                </li>
                <li role="none">
                  <button type="button" className="homeLanding__addMenuItem" role="menuitem" onClick={() => pickAddKind("sketch")}>
                    Sketch
                  </button>
                </li>
              </ul>
            ) : null}
          </div>
          <button
            type="button"
            className={`homeLanding__toolPill${preferencesOpen ? " homeLanding__toolPill--open" : ""}${preferencesConfigured && !preferencesOpen ? " homeLanding__toolPill--hasContext" : ""}`}
            aria-expanded={preferencesOpen}
            aria-controls="home-preferences-panel"
            id="home-preferences-trigger"
            onClick={() => setPreferencesOpen((o) => !o)}
          >
            <span className="homeLanding__toolPillIcon" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <circle cx="10" cy="4" r="1.75" fill="var(--surface)" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="6" cy="8" r="1.75" fill="var(--surface)" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="9" cy="12" r="1.75" fill="var(--surface)" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </span>
            <span>Preferences</span>
            <ToolPillChevron />
          </button>
          <div className="homeLanding__speedSeg" role="group" aria-label="Reference image generation">
            <button
              type="button"
              className={`homeLanding__speedSeg__btn${!fastReferenceImages ? " homeLanding__speedSeg__btn--active" : ""}`}
              aria-pressed={!fastReferenceImages}
              onClick={() => onChangeFastReferenceImages(false)}
            >
              Detailed
            </button>
            <button
              type="button"
              className={`homeLanding__speedSeg__btn${fastReferenceImages ? " homeLanding__speedSeg__btn--active" : ""}`}
              aria-pressed={fastReferenceImages}
              onClick={() => onChangeFastReferenceImages(true)}
            >
              Fast
            </button>
          </div>
        </div>

        <AddAssetsBlock
          ref={addAssetsRef}
          disabled={isSubmitting}
          onMergeDocumentSections={onMergeDocumentSections}
          onRevokeDocumentSections={onRevokeDocumentSections}
          onGenerateReadinessChange={onIdeaAssetsReadyChange}
        />

        {preferencesOpen ? (
          <section className="homeLanding__tools" id="home-preferences-panel" aria-label="Preferences">
            <p className="homeLanding__toolsIntro">
              Optional text for this run. Image, document, and sketch uploads are managed with Add above; speed is
              Detailed / Fast beside Preferences.
            </p>
            <div className="field field--flushBottom">
              <label className="field__label" htmlFor="home-model-context">
                Context for this model <span className="field__optional">optional</span>
              </label>
              <textarea
                id="home-model-context"
                className="textarea"
                placeholder="Constraints, claims, or notes that apply only to this generation. Separate sections with a blank line."
                value={documentsText}
                onChange={(e) => onChangeDocumentsText(e.target.value)}
                rows={4}
              />
              <p className="field__hint">Up to 12 sections; blank lines split sections.</p>
            </div>
          </section>
        ) : null}

        <div className="homeLanding__composerActions">
          <button
            type="button"
            className={[
              "button",
              "homeLanding__submit",
              !generateLocked ? "button--primary" : "button--ghost",
              isSubmitting ? "homeLanding__submit--busy" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={onSubmit}
            disabled={generateLocked}
            title={
              pipelineBlocksNewGenerate
                ? "Finish or open the pipeline run in progress before starting another prototype."
                : !ideaAssetsReady
                  ? "Wait until every added file is analyzed, or remove uploads that are still queued or failed."
                  : undefined
            }
          >
            {isSubmitting ? "Starting…" : pipelineBlocksNewGenerate ? "Pipeline running" : "Generate concept art"}
          </button>
        </div>
      </div>

      <PortfolioSection
        jobs={history}
        onOpenJob={onOpenPortfolioJob}
        backgroundJob={backgroundJob ?? null}
        onResumePipeline={onResumePipeline}
      />
    </div>
  );
}
