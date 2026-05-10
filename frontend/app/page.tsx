"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppNav } from "@/components/AppNav";
import { CompanySettingsPanel } from "@/components/CompanySettingsPanel";
import { FlowStepper, type FlowStepId } from "@/components/FlowStepper";
import type { AddAssetsHandle } from "@/components/AddAssetsBlock";
import { HomeLanding } from "@/components/HomeLanding";
import { ModelViewer } from "@/components/ModelViewer";
import { PipelineConceptRefs } from "@/components/PipelineConceptRefs";
import type { ReferenceFilesHandle } from "@/components/ReferenceFilesBlock";
import {
  friendlyGenerationPhase,
  friendlyJobStatus,
  getFlowStep,
  isTerminalJobStatus,
} from "@/lib/flow";
import {
  JobPayload,
  cancelJob,
  confirmConcept,
  generateEnterprise,
  getJob,
  outputUrl,
  regenerate3dBuild,
  regenerateConceptArt,
} from "@/lib/api";
import {
  clearActiveJobInSession,
  readWorkspaceSession,
  writeWorkspaceSession,
  type MainTabId,
} from "@/lib/workspaceSession";

const POLL_MS = 1200;

const FLOW_STEP_ORDER: FlowStepId[] = ["references", "mesh", "export"];

const MESHY_FORMAT_OPTIONS: { id: string; label: string; hint?: string }[] = [
  { id: "glb", label: "GLB", hint: "Live preview" },
  { id: "obj", label: "OBJ", hint: "+ MTL when available" },
  { id: "fbx", label: "FBX" },
  { id: "stl", label: "STL", hint: "meshy_scan.stl" },
  { id: "usdz", label: "USDZ" },
  { id: "3mf", label: "3MF" },
];

/** Merge a poll snapshot into React state without resurrecting stale non-terminal responses after cancel/terminal. */
function mergeJobPoll(prev: JobPayload | null, latest: JobPayload, jobId: string): JobPayload {
  if (!prev || prev.job_id !== jobId) {
    return latest;
  }
  if (isTerminalJobStatus(prev.status) && !isTerminalJobStatus(latest.status)) {
    const prevTs = prev.updated_at;
    const latestTs = latest.updated_at;
    if (latestTs && prevTs && latestTs > prevTs) {
      return latest;
    }
    if (!prevTs && latest.status === "running") {
      return latest;
    }
    return prev;
  }
  return {
    ...latest,
    cancel_requested: Boolean(prev.cancel_requested || latest.cancel_requested),
  };
}

export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [company, setCompany] = useState("");
  const [companyContextText, setCompanyContextText] = useState("");
  const [documentsText, setDocumentsText] = useState("");
  const [mainTab, setMainTab] = useState<MainTabId>("home");
  const [pipelineMinimized, setPipelineMinimized] = useState(false);
  const [retroStep, setRetroStep] = useState<FlowStepId | null>(null);
  const [job, setJob] = useState<JobPayload | null>(null);
  const [history, setHistory] = useState<JobPayload[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [meshyFormats, setMeshyFormats] = useState<string[]>(["glb"]);
  const [fastReferenceImages, setFastReferenceImages] = useState(false);
  /** False until initial localStorage restore finishes (avoids clobbering session before getJob returns). */
  const [workspacePersistEnabled, setWorkspacePersistEnabled] = useState(false);
  const [generateSubmitting, setGenerateSubmitting] = useState(false);
  const [ideaAssetsReady, setIdeaAssetsReady] = useState(true);
  const addAssetsRef = useRef<AddAssetsHandle | null>(null);
  const brandingFilesRef = useRef<ReferenceFilesHandle | null>(null);
  const generateInFlightRef = useRef(false);

  const displayedFlowStep = useMemo(() => retroStep ?? getFlowStep(job), [retroStep, job]);
  const jobActive = Boolean(job) && !isTerminalJobStatus(job!.status);
  const failed = job?.status === "failed" && !retroStep;

  /** Global `loading` is also used during mesh/confirm; when the job ends, always drop it so the compose rail cannot stay stuck dimmed after a finished run. */
  useEffect(() => {
    if (job && isTerminalJobStatus(job.status)) {
      setLoading(false);
    }
  }, [job?.job_id, job?.status]);

  useEffect(() => {
    let cancelled = false;
    const RESTORE_MS = 12_000;
    const withTimeout = <T,>(promise: Promise<T>) =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error("restore_timeout")), RESTORE_MS),
        ),
      ]);

    (async () => {
      const saved = readWorkspaceSession();
      if (!saved) {
        if (!cancelled) setWorkspacePersistEnabled(true);
        return;
      }
      if (!cancelled) {
        setPrompt(saved.prompt);
        setCompany(saved.company);
        setCompanyContextText(saved.companyContextText ?? "");
        setDocumentsText(saved.documentsText);
        setMainTab(saved.mainTab === "company" ? "company" : "home");
        setFastReferenceImages(saved.fastReferenceImages);
        if (saved.meshyFormats.length > 0) {
          setMeshyFormats(saved.meshyFormats);
        }
        setPipelineMinimized(saved.pipelineMinimized === true);
      }
      if (saved.activeJobId) {
        try {
          const restored = await withTimeout(getJob(saved.activeJobId));
          if (cancelled) return;
          setJob(restored);
          setPrompt(restored.prompt);
          setMainTab("home");
          if (typeof restored.fast_reference_images === "boolean") {
            setFastReferenceImages(restored.fast_reference_images);
          }
        } catch {
          if (!cancelled) {
            clearActiveJobInSession();
            setJob(null);
          }
        }
      }
      if (saved.historyJobIds.length > 0) {
        const entries = await Promise.all(
          saved.historyJobIds.map((jobId) => withTimeout(getJob(jobId)).catch(() => null)),
        );
        if (!cancelled) {
          setHistory(entries.filter((entry): entry is JobPayload => Boolean(entry)));
        }
      }
      if (!cancelled) setWorkspacePersistEnabled(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Dev HMR / edge cases can leave the in-flight guard set; reset on mount so clicks always work. */
  useEffect(() => {
    generateInFlightRef.current = false;
  }, []);

  useEffect(() => {
    if (!workspacePersistEnabled) return;
    writeWorkspaceSession({
      activeJobId: job?.job_id ?? null,
      historyJobIds: [...new Set(history.map((entry) => entry.job_id))],
      prompt,
      company,
      companyContextText,
      documentsText,
      mainTab,
      fastReferenceImages,
      meshyFormats,
      pipelineMinimized,
    });
  }, [
    workspacePersistEnabled,
    job,
    history,
    prompt,
    company,
    companyContextText,
    documentsText,
    mainTab,
    fastReferenceImages,
    meshyFormats,
    pipelineMinimized,
  ]);

  useEffect(() => {
    if (job?.meshy_target_formats && job.meshy_target_formats.length > 0) {
      setMeshyFormats(job.meshy_target_formats);
    }
  }, [job?.job_id]);

  const activeJobId = job?.job_id ?? null;
  const pollJobs = Boolean(activeJobId && job && !isTerminalJobStatus(job.status));

  useEffect(() => {
    if (!pollJobs || !activeJobId) {
      return;
    }
    const jobId = activeJobId;
    let invalidated = false;

    const tick = async () => {
      try {
        const latest = await getJob(jobId);
        if (invalidated) {
          return;
        }
        setJob((prev) => {
          const next = mergeJobPoll(prev, latest, jobId);
          if (next !== prev) {
            if (next.status === "awaiting_concept_confirmation") {
              queueMicrotask(() => setLoading(false));
            }
            const gpNext = (next.generation_phase ?? "").toLowerCase();
            const meshRunning =
              next.status === "running" &&
              (gpNext.includes("image_to_3d") || gpNext.includes("to_3d"));
            if (meshRunning) {
              queueMicrotask(() => setLoading(false));
            }
            if (isTerminalJobStatus(next.status)) {
              queueMicrotask(() => {
                setLoading(false);
                setGenerateSubmitting(false);
                setHistory((previous) => [next, ...previous.filter((j) => j.job_id !== next.job_id)].slice(0, 12));
              });
            }
          }
          return next;
        });
      } catch (error) {
        if (!invalidated) {
          setLoading(false);
          setGenerateSubmitting(false);
          setErrorText((error as Error).message);
        }
      }
    };

    const timer = setInterval(tick, POLL_MS);
    return () => {
      invalidated = true;
      clearInterval(timer);
    };
  }, [pollJobs, activeJobId]);

  const mergeDocumentSections = useCallback((sections: string[]) => {
    setDocumentsText((prev) => {
      const existing = prev
        .split("\n\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const incoming = sections.map((s) => s.trim()).filter(Boolean);
      return [...existing, ...incoming].slice(0, 12).join("\n\n");
    });
  }, []);

  const revokeDocumentSections = useCallback((sections: string[]) => {
    const remove = new Set(sections.map((s) => s.trim()).filter(Boolean));
    if (remove.size === 0) return;
    setDocumentsText((prev) => {
      const blocks = prev.split("\n\n").map((s) => s.trim()).filter(Boolean);
      const next = blocks.filter((b) => !remove.has(b));
      return next.join("\n\n");
    });
  }, []);

  const mergeCompanyDocumentSections = useCallback((sections: string[]) => {
    setCompanyContextText((prev) => {
      const existing = prev
        .split("\n\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const incoming = sections.map((s) => s.trim()).filter(Boolean);
      return [...existing, ...incoming].slice(0, 12).join("\n\n");
    });
  }, []);

  const downloads = useMemo(() => {
    if (!job?.files) return [];
    return [
      { key: "step", label: "STEP", url: outputUrl(job.files.step) },
      { key: "stl", label: "STL", url: outputUrl(job.files.stl) },
      { key: "glb", label: "GLB", url: outputUrl(job.files.glb) },
      { key: "meshy_stl", label: "Meshy STL", url: outputUrl(job.files.meshy_stl) },
      { key: "meshy_obj", label: "Meshy OBJ", url: outputUrl(job.files.meshy_obj) },
      { key: "meshy_mtl", label: "Meshy MTL", url: outputUrl(job.files.meshy_mtl) },
      { key: "meshy_fbx", label: "Meshy FBX", url: outputUrl(job.files.meshy_fbx) },
      { key: "meshy_usdz", label: "Meshy USDZ", url: outputUrl(job.files.meshy_usdz) },
      { key: "meshy_3mf", label: "Meshy 3MF", url: outputUrl(job.files.meshy_3mf) },
      { key: "preview", label: "PNG", url: outputUrl(job.files.preview) },
      { key: "spec", label: "Spec JSON", url: outputUrl(job.files.spec) },
    ].filter((item) => Boolean(item.url)) as Array<{ key: string; label: string; url: string }>;
  }, [job]);

  async function onGenerate() {
    if (!prompt.trim()) {
      setErrorText("Describe your idea in the text box first.");
      return;
    }
    if (addAssetsRef.current && !addAssetsRef.current.canGenerateConceptArt()) {
      setErrorText(
        "Wait until every added file finishes analyzing, or remove queued / failed uploads before generating.",
      );
      return;
    }
    if (generateInFlightRef.current) {
      setErrorText("Generation is already in progress.");
      return;
    }
    try {
      generateInFlightRef.current = true;
      setGenerateSubmitting(true);
      setErrorText(null);
      setLoading(true);
      setMainTab("home");
      let fromBranding: string[] = [];
      let fromIdeaFiles: string[] = [];
      try {
        fromBranding = (await brandingFilesRef.current?.flushPendingReferenceFilesForGenerate?.()) ?? [];
        fromIdeaFiles = (await addAssetsRef.current?.flushPendingReferenceFilesForGenerate?.()) ?? [];
      } catch (error) {
        setLoading(false);
        setErrorText((error as Error).message);
        return;
      }
      const companySections = companyContextText
        .split("\n\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const modelSections = documentsText
        .split("\n\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const docs = [...companySections, ...fromBranding, ...modelSections, ...fromIdeaFiles].slice(0, 12);
      const queued = await generateEnterprise({
        prompt,
        company: company.trim() || undefined,
        documents: docs,
        fastReferenceImages,
      });
      setMeshyFormats(["glb"]);
      setPipelineMinimized(false);
      setRetroStep(null);
      setJob({
        job_id: queued.job_id,
        prompt,
        status: queued.status,
        files: {},
        warnings: [],
        stage_durations_ms: {},
        fast_reference_images: fastReferenceImages,
      });
    } catch (error) {
      setLoading(false);
      setErrorText((error as Error).message);
    } finally {
      generateInFlightRef.current = false;
      setGenerateSubmitting(false);
    }
  }

  async function onCancelJob() {
    if (!job) return;
    setErrorText(null);
    try {
      const cancelResult = await cancelJob(job.job_id);
      setJob((previous) =>
        previous
          ? {
              ...previous,
              status: cancelResult.status,
              cancel_requested: cancelResult.cancel_requested,
            }
          : previous,
      );
      setLoading(false);
      setGenerateSubmitting(false);
    } catch (error) {
      setErrorText((error as Error).message);
    }
  }

  async function onConfirmConcept() {
    if (!job || job.status !== "awaiting_concept_confirmation") return;
    setErrorText(null);
    setLoading(true);
    try {
      await confirmConcept(job.job_id, { targetFormats: meshyFormats });
      const latest = await getJob(job.job_id);
      setJob(latest);
      setLoading(false);
    } catch (error) {
      setLoading(false);
      setErrorText((error as Error).message);
    }
  }

  async function onRegenerateConceptArt() {
    if (!job || job.status !== "awaiting_concept_confirmation") return;
    setErrorText(null);
    setLoading(true);
    try {
      await regenerateConceptArt(job.job_id);
      const latest = await getJob(job.job_id);
      setJob(latest);
    } catch (error) {
      setLoading(false);
      setErrorText((error as Error).message);
    }
  }

  async function onRegenerate3d() {
    if (!job || (job.status !== "completed" && job.status !== "failed")) return;
    setErrorText(null);
    setLoading(true);
    try {
      await regenerate3dBuild(job.job_id, { targetFormats: meshyFormats });
      const latest = await getJob(job.job_id);
      setJob(latest);
    } catch (error) {
      setLoading(false);
      setErrorText((error as Error).message);
    }
  }

  async function openHistoryEntry(entry: JobPayload) {
    setErrorText(null);
    setMainTab("home");
    setPipelineMinimized(false);
    setRetroStep(null);
    try {
      const latest = await getJob(entry.job_id);
      setJob(latest);
      setLoading(false);
    } catch (error) {
      setErrorText((error as Error).message);
    }
  }

  function startFresh() {
    setJob(null);
    setPrompt("");
    setDocumentsText("");
    setFastReferenceImages(false);
    setMeshyFormats(["glb"]);
    addAssetsRef.current?.reset();
    clearActiveJobInSession();
    setErrorText(null);
    setLoading(false);
    setGenerateSubmitting(false);
    setMainTab("home");
    setPipelineMinimized(false);
    setRetroStep(null);
  }

  const handleGoHome = useCallback(() => {
    setRetroStep(null);
    setPipelineMinimized(true);
    setMainTab("home");
  }, []);

  const handleMainTabSelect = useCallback(
    (tab: MainTabId) => {
      if (tab === "home" && job && !pipelineMinimized) {
        handleGoHome();
        return;
      }
      setMainTab(tab);
    },
    [job, pipelineMinimized, handleGoHome],
  );

  const handleResumePipeline = useCallback(() => {
    setPipelineMinimized(false);
    setMainTab("home");
  }, []);

  const liveFlowStep = useMemo(() => (job ? getFlowStep(job) : "references"), [job]);

  const isFlowStepLocked = useCallback(
    (step: FlowStepId) => {
      if (!job) return true;
      if (isTerminalJobStatus(job.status)) return false;
      return FLOW_STEP_ORDER.indexOf(step) > FLOW_STEP_ORDER.indexOf(liveFlowStep);
    },
    [job, liveFlowStep],
  );

  const handleSelectFlowStep = useCallback(
    (step: FlowStepId) => {
      if (!job || loading) return;
      if (isFlowStepLocked(step)) return;
      if (isTerminalJobStatus(job.status)) {
        setRetroStep(step === "export" ? null : step);
        return;
      }
      const liveIdx = FLOW_STEP_ORDER.indexOf(liveFlowStep);
      const targetIdx = FLOW_STEP_ORDER.indexOf(step);
      if (targetIdx < liveIdx) {
        setRetroStep(step === "export" ? null : step);
      } else if (targetIdx === liveIdx) {
        setRetroStep(null);
      }
    },
    [job, liveFlowStep, loading, isFlowStepLocked],
  );

  const gp = (job?.generation_phase ?? "").toLowerCase();
  const meshPhase = gp.includes("image_to_3d") || gp.includes("to_3d");
  const awaitingReview =
    job?.status === "awaiting_concept_confirmation" &&
    Boolean(job.concept_references && Object.keys(job.concept_references).length > 0);
  const refsPartialFront =
    job?.status === "running" &&
    job?.generation_phase === "concept_reference_images" &&
    Boolean(job?.concept_references?.front) &&
    !job?.concept_references?.three_quarter;
  const refsBusy =
    Boolean(job) &&
    (job!.status === "queued" || job!.status === "running") &&
    !awaitingReview &&
    !meshPhase &&
    !refsPartialFront;
  const meshBusy = Boolean(job) && (job!.status === "queued" || job!.status === "running") && meshPhase;
  const refsPartialFrontEffective = !retroStep && refsPartialFront;
  const refsBusyEffective = !retroStep && refsBusy;
  const meshBusyEffective = !retroStep && meshBusy;
  /** Retro "references" must always show the concept stage (same as live review), not the GLB viewer. */
  const showConceptReviewUI = awaitingReview || retroStep === "references";
  const conceptReviewReadOnly = Boolean(
    retroStep === "references" &&
      job &&
      job.status !== "awaiting_concept_confirmation",
  );
  const canRegenerate3d = Boolean(
    job && (job.status === "completed" || job.status === "failed"),
  );
  const canRegenerate3dInteractive = canRegenerate3d && !retroStep;

  return (
    <div className="app app--shell">
      <div className="appShell">
        <AppNav active={mainTab} onSelect={handleMainTabSelect} pipelineBusy={jobActive} />
        <div className="appShell__main">
          {(mainTab === "home" && job && !pipelineMinimized) ||
          (job &&
            isTerminalJobStatus(job.status) &&
            ((mainTab === "home" && pipelineMinimized) || mainTab === "company")) ? (
            <header className="appShellHeader">
              {mainTab === "home" && job && !pipelineMinimized ? (
                <div className="appShellHeader__actionsCol">
                  <div className="appShellHeader__actions">
                    <button type="button" className="button button--ghost" onClick={handleGoHome}>
                      Go home
                    </button>
                    {isTerminalJobStatus(job.status) ? (
                      <button type="button" className="button button--ghost" onClick={startFresh}>
                        New prototype
                      </button>
                    ) : null}
                  </div>
                  {!isTerminalJobStatus(job.status) ? (
                    <p className="appShellHeader__pipelineHint">
                      On Home, open the pinned tile under Your 3D models to return here.
                    </p>
                  ) : null}
                </div>
              ) : (
                <button type="button" className="button button--ghost" onClick={startFresh}>
                  New prototype
                </button>
              )}
            </header>
          ) : null}

          {mainTab === "company" ? (
            <CompanySettingsPanel
              company={company}
              companyContextText={companyContextText}
              pipelineBusy={jobActive}
              onChangeCompany={setCompany}
              onChangeCompanyContextText={setCompanyContextText}
              onMergeCompanyDocumentSections={mergeCompanyDocumentSections}
              brandingFilesRef={brandingFilesRef}
            />
          ) : mainTab === "home" && job && !pipelineMinimized ? (
            <>
              <FlowStepper
                active={displayedFlowStep}
                failed={failed}
                onSelectStep={handleSelectFlowStep}
                isStepLocked={isFlowStepLocked}
                selectDisabled={loading}
              />
              <div className="split">
                <aside className="split__rail">
                  <section className="panel panel--job">
                    <div className="jobCard">
                      <p className="jobCard__eyebrow">Current run</p>
                      <p className="jobCard__status">{friendlyJobStatus(job.status)}</p>
                      {(job.status === "queued" || job.status === "running") && job.generation_phase ? (
                        <p className="jobCard__phase">
                          {refsPartialFront
                            ? "Front reference ready; finishing three-quarter…"
                            : friendlyGenerationPhase(job.generation_phase)}
                        </p>
                      ) : null}
                      <p className="jobCard__prompt">{job.prompt}</p>
                      {jobActive ? (
                        <button type="button" className="button button--dangerOutline" onClick={onCancelJob}>
                          Cancel run
                        </button>
                      ) : null}
                    </div>
                  </section>

          {awaitingReview && !retroStep ? (
            <section className="panel panel--confirm">
              <h3 className="panel__h">Export formats</h3>
              <p className="panel__muted">Pick what Meshy should output. GLB unlocks the live viewer.</p>
              <div className="formatList" role="group" aria-label="Meshy export formats">
                {MESHY_FORMAT_OPTIONS.map((opt) => (
                  <label key={opt.id} className="formatChip">
                    <input
                      type="checkbox"
                      checked={meshyFormats.includes(opt.id)}
                      onChange={() => {
                        setMeshyFormats((prev) => {
                          const has = prev.includes(opt.id);
                          if (has && prev.length <= 1) return prev;
                          if (has) return prev.filter((x) => x !== opt.id);
                          return [...prev, opt.id];
                        });
                      }}
                    />
                    <span className="formatChip__text">
                      <span className="formatChip__name">{opt.label}</span>
                      {opt.hint ? <span className="formatChip__hint">{opt.hint}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
              <div className="panel__actions panel__actions--row">
                <button type="button" className="button button--primary" onClick={onConfirmConcept} disabled={loading}>
                  {loading ? "Starting 3D…" : "Approve & build 3D"}
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={onRegenerateConceptArt}
                  disabled={loading}
                >
                  {loading ? "Working…" : "Regenerate concept art"}
                </button>
              </div>
              <p className="panel__fineprint">
                Regenerate concept art for a fresh front and three-quarter pass with the same spec. If the idea itself
                is wrong, cancel and adjust your prompt or brand context instead.
              </p>
            </section>
          ) : null}

          {canRegenerate3dInteractive ? (
            <section className="panel panel--confirm">
              <h3 className="panel__h">Re-run 3D build</h3>
              <p className="panel__muted">
                Runs Meshy again on the saved front reference. Pick formats below, then regenerate—useful when the mesh
                is noisy or you want different exports without redoing concepts.
              </p>
              <div className="formatList" role="group" aria-label="Meshy export formats for regenerate">
                {MESHY_FORMAT_OPTIONS.map((opt) => (
                  <label key={opt.id} className="formatChip">
                    <input
                      type="checkbox"
                      checked={meshyFormats.includes(opt.id)}
                      onChange={() => {
                        setMeshyFormats((prev) => {
                          const has = prev.includes(opt.id);
                          if (has && prev.length <= 1) return prev;
                          if (has) return prev.filter((x) => x !== opt.id);
                          return [...prev, opt.id];
                        });
                      }}
                    />
                    <span className="formatChip__text">
                      <span className="formatChip__name">{opt.label}</span>
                      {opt.hint ? <span className="formatChip__hint">{opt.hint}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
              <div className="panel__actions">
                <button type="button" className="button button--ghost" onClick={onRegenerate3d} disabled={loading}>
                  {loading ? "Starting…" : "Regenerate 3D mesh"}
                </button>
              </div>
            </section>
          ) : null}

          {(errorText || job?.error) && (
            <div className="alert alert--error" role="alert">
              {job?.error ? (
                <>
                  <strong>{job.error.code}</strong>
                  <span>{job.error.message}</span>
                </>
              ) : null}
              {errorText ? <span>{errorText}</span> : null}
            </div>
          )}

          {downloads.length > 0 ? (
            <section className="panel panel--downloads">
              <h3 className="panel__h">Downloads</h3>
              <div className="downloadChips">
                {downloads.map((item) => (
                  <a key={item.key} className="downloadChip" href={item.url} download>
                    {item.label}
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          <details className="historyDisclosure">
            <summary>Recent prototypes {history.length > 0 ? `(${history.length})` : ""}</summary>
            {history.length === 0 ? (
              <p className="panel__muted">Finished jobs will be listed here. Click one to reopen.</p>
            ) : (
              <ul className="historyList">
                {history.map((entry) => (
                  <li key={entry.job_id}>
                    <button type="button" className="historyList__btn" onClick={() => openHistoryEntry(entry)}>
                      <span className="historyList__status">{entry.status}</span>
                      <span className="historyList__prompt">{entry.prompt}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </aside>

        <main className="split__stage">
          {showConceptReviewUI ? (
            <div className="conceptStage">
              <header className="conceptStage__header">
                <h2 className="conceptStage__title">
                  {conceptReviewReadOnly ? "Concept art (saved run)" : "Review concept art"}
                </h2>
                <p className="conceptStage__sub">
                  {conceptReviewReadOnly
                    ? "Frames from this completed run. Use the steps above to switch stages, or Go home in the header to return to the gallery while keeping this run."
                    : "These frames drive the 3D reconstruction. Approve when they match your intent."}
                </p>
              </header>
              {awaitingReview && !retroStep ? (
                <div className="conceptStage__actions">
                  <button type="button" className="button button--primary" onClick={onConfirmConcept} disabled={loading}>
                    {loading ? "Starting 3D…" : "Approve & build 3D"}
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={onRegenerateConceptArt}
                    disabled={loading}
                  >
                    {loading ? "Working…" : "Regenerate concept art"}
                  </button>
                  <p className="conceptStage__actionsNote">
                    Mesh export formats (GLB, OBJ, …) are in the left panel. Regenerate runs new reference frames from
                    the same product spec.
                  </p>
                </div>
              ) : null}
              <div className="conceptGrid">
                {(["front", "three_quarter"] as const).map((key) => {
                  const path = job!.concept_references?.[key];
                  const url = outputUrl(path);
                  if (!url) return null;
                  return (
                    <figure key={key} className="conceptFig">
                      <figcaption className="conceptFig__cap">{key === "three_quarter" ? "Three-quarter" : "Front"}</figcaption>
                      <div className="conceptFig__frame">
                        <img src={url} alt={`${key} reference`} className="conceptFig__img" />
                      </div>
                    </figure>
                  );
                })}
              </div>
            </div>
          ) : refsPartialFrontEffective ? (
            <div className="conceptStage">
              <header className="conceptStage__header">
                <h2 className="conceptStage__title">Concept art</h2>
                <p className="conceptStage__sub">
                  The front reference is ready. The three-quarter view is still generating and will appear here when it
                  finishes.
                </p>
              </header>
              <div className="conceptGrid">
                {(["front", "three_quarter"] as const).map((key) => {
                  const path = job!.concept_references?.[key];
                  const url = outputUrl(path);
                  if (url) {
                    return (
                      <figure key={key} className="conceptFig">
                        <figcaption className="conceptFig__cap">
                          {key === "three_quarter" ? "Three-quarter" : "Front"}
                        </figcaption>
                        <div className="conceptFig__frame">
                          <img src={url} alt={`${key} reference`} className="conceptFig__img" />
                        </div>
                      </figure>
                    );
                  }
                  if (key === "three_quarter") {
                    return (
                      <figure key={key} className="conceptFig">
                        <figcaption className="conceptFig__cap">Three-quarter</figcaption>
                        <div className="conceptFig__frame conceptFig__frame--pending">
                          <div className="conceptFig__pending">
                            <div className="stageBusy__pulse" aria-hidden />
                            <p className="conceptFig__pendingText">Rendering three-quarter…</p>
                          </div>
                        </div>
                      </figure>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          ) : refsBusyEffective ? (
            <div className="stagePanel stagePanel--busy">
              <div className="stageBusy">
                <div className="stageBusy__pulse" aria-hidden />
                <h2 className="stageBusy__title">Creating reference images</h2>
                <p className="stageBusy__text">
                  {job?.generation_phase ? friendlyGenerationPhase(job.generation_phase) : "Starting generation…"}
                </p>
                <p className="stageBusy__hint">You can leave this tab open. We update automatically.</p>
              </div>
            </div>
          ) : meshBusyEffective ? (
            <div className="stageWithConceptRefs">
              <PipelineConceptRefs conceptReferences={job?.concept_references} />
              <ModelViewer waitingForMesh />
            </div>
          ) : (
            <div className="stageWithConceptRefs">
              <PipelineConceptRefs conceptReferences={job?.concept_references} />
              <ModelViewer
                glbPath={job?.files.glb}
                previewPath={job?.files.preview}
                emptyTitle="3D preview"
                emptySubtitle="The interactive GLB loads in this panel when the mesh step completes."
                footer={
                  canRegenerate3dInteractive ? (
                    <div className="stageViewerToolbar">
                      <p className="stageViewerToolbar__hint">
                        Pick export formats in the left panel, then re-run Meshy on the saved front reference.
                      </p>
                      <button type="button" className="button button--ghost" onClick={onRegenerate3d} disabled={loading}>
                        {loading ? "Starting…" : "Regenerate 3D mesh"}
                      </button>
                    </div>
                  ) : undefined
                }
              />
            </div>
          )}
        </main>
              </div>
            </>
          ) : (
            <HomeLanding
              prompt={prompt}
              documentsText={documentsText}
              fastReferenceImages={fastReferenceImages}
              isSubmitting={generateSubmitting}
              ideaAssetsReady={ideaAssetsReady}
              errorText={errorText}
              history={history}
              onChangePrompt={setPrompt}
              onChangeDocumentsText={setDocumentsText}
              onChangeFastReferenceImages={setFastReferenceImages}
              onMergeDocumentSections={mergeDocumentSections}
              onRevokeDocumentSections={revokeDocumentSections}
              onIdeaAssetsReadyChange={setIdeaAssetsReady}
              onSubmit={onGenerate}
              onOpenPortfolioJob={openHistoryEntry}
              addAssetsRef={addAssetsRef}
              backgroundJob={job && pipelineMinimized ? job : null}
              onResumePipeline={job ? handleResumePipeline : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}
