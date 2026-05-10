"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { AppNav } from "@/components/AppNav";
import { CompanySettingsPanel } from "@/components/CompanySettingsPanel";
import { FlowStepper, type FlowStepId } from "@/components/FlowStepper";
import type { AddAssetsHandle } from "@/components/AddAssetsBlock";
import { HomeLanding } from "@/components/HomeLanding";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DeletePrototypeIcon } from "@/components/PortfolioSection";
import { ModelViewAngleExport } from "@/components/ModelViewAngleExport";
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
  ResearchBrief,
  addConceptStyle,
  cancelJob,
  deleteJob,
  confirmConcept,
  confirmImageGeneration,
  saveImageGenerationPreview,
  generateEnterprise,
  getJob,
  listJobs,
  outputUrl,
  regenerate3dBuild,
  regenerateConceptArt,
  selectConceptStyle,
} from "@/lib/api";
import { cloudinaryOptimized, cloudinaryThumb } from "@/lib/cloudinaryDelivery";
import {
  buildResearchSummaryMessage,
  digestFromBrief,
  hasStructuredBrief,
  readResearchBrief,
} from "@/lib/researchSummary";
import { ResearchSummaryEditor } from "@/components/ResearchSummaryEditor";
import {
  clearActiveJobInSession,
  readWorkspaceSession,
  writeWorkspaceSession,
  type MainTabId,
} from "@/lib/workspaceSession";

const POLL_MS = 1200;
/** Keep enough history to surface a user's full recent gallery; bumped to align with the server-side recovery cap. */
const MAX_HISTORY = 60;

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
  /** Non-focused in-flight runs (polled alongside `job`). */
  const [sidecarJobs, setSidecarJobs] = useState<JobPayload[]>([]);
  const [history, setHistory] = useState<JobPayload[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [meshyFormats, setMeshyFormats] = useState<string[]>(["glb"]);
  const [fastReferenceImages, setFastReferenceImages] = useState(false);
  /** False until initial localStorage restore finishes (avoids clobbering session before getJob returns). */
  const [workspacePersistEnabled, setWorkspacePersistEnabled] = useState(false);
  const [generateSubmitting, setGenerateSubmitting] = useState(false);
  const [ideaAssetsReady, setIdeaAssetsReady] = useState(true);
  const [deleteDialogJob, setDeleteDialogJob] = useState<JobPayload | null>(null);
  const [deleteDialogBusy, setDeleteDialogBusy] = useState(false);
  const [cancelRunBusy, setCancelRunBusy] = useState(false);
  /** Optional directions sent only with "Add concept style" (not regenerate / main prompt). */
  const [extraConceptStyleDetails, setExtraConceptStyleDetails] = useState("");
  const extraConceptStyleDetailsRef = useRef("");
  const [addConceptStyleDialogOpen, setAddConceptStyleDialogOpen] = useState(false);
  const addConceptStyleDetailsFieldId = useId();
  const addAssetsRef = useRef<AddAssetsHandle | null>(null);
  const brandingFilesRef = useRef<ReferenceFilesHandle | null>(null);
  const generateInFlightRef = useRef(false);
  const cancelRunInFlightRef = useRef(false);
  const jobRef = useRef<JobPayload | null>(null);
  jobRef.current = job;
  const sidecarJobsRef = useRef<JobPayload[]>([]);
  sidecarJobsRef.current = sidecarJobs;
  const [researchBriefDraft, setResearchBriefDraft] = useState<ResearchBrief>({});
  const [researchPreviewSaveBusy, setResearchPreviewSaveBusy] = useState(false);
  const researchSummaryInitJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    setExtraConceptStyleDetails("");
    extraConceptStyleDetailsRef.current = "";
    setAddConceptStyleDialogOpen(false);
  }, [job?.job_id]);

  useLayoutEffect(() => {
    if (!job || job.status !== "awaiting_image_generation_preview") {
      researchSummaryInitJobIdRef.current = null;
      return;
    }
    if (researchSummaryInitJobIdRef.current !== job.job_id) {
      if (hasStructuredBrief(job.research_brief)) {
        setResearchBriefDraft(readResearchBrief(job));
      } else {
        const fallback = (job.research_digest ?? buildResearchSummaryMessage(job)).trim();
        setResearchBriefDraft({
          brand_snapshot: fallback,
          visual_packaging_cues: "",
          category_competitive_notes: "",
          financial_snapshot: "",
          corporate_strategy: "",
        });
      }
      researchSummaryInitJobIdRef.current = job.job_id;
    }
  }, [job, job?.job_id, job?.status]);

  const displayedFlowStep = useMemo(() => retroStep ?? getFlowStep(job), [retroStep, job]);
  const anyPipelineBusy =
    Boolean(job && !isTerminalJobStatus(job.status)) ||
    sidecarJobs.some((j) => !isTerminalJobStatus(j.status));
  const homeBackgroundJobs = useMemo(() => {
    const tiles: JobPayload[] = [];
    if (job && pipelineMinimized) tiles.push(job);
    for (const s of sidecarJobs) {
      if (!tiles.some((t) => t.job_id === s.job_id)) tiles.push(s);
    }
    return tiles;
  }, [job, pipelineMinimized, sidecarJobs]);
  /** Same merge as Home “Your 3D models”: live tiles first, then finished history; include the focused run if missing. */
  const sidebarRecentPrototypes = useMemo(() => {
    const bgIds = new Set(homeBackgroundJobs.map((j) => j.job_id));
    const base = [...homeBackgroundJobs, ...history.filter((j) => !bgIds.has(j.job_id))];
    if (job && !base.some((j) => j.job_id === job.job_id)) {
      return [job, ...base];
    }
    return base;
  }, [homeBackgroundJobs, history, job]);
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
      const sideIds = (saved.sidecarJobIds ?? []).filter(
        (jid): jid is string => typeof jid === "string" && jid !== saved.activeJobId,
      );
      if (sideIds.length > 0) {
        const sideEntries = await Promise.all(
          sideIds.map((jobId) => withTimeout(getJob(jobId)).catch(() => null)),
        );
        if (!cancelled) {
          setSidecarJobs(sideEntries.filter((entry): entry is JobPayload => Boolean(entry)));
        }
      }
      let restoredHistory: JobPayload[] = [];
      if (saved.historyJobIds.length > 0) {
        const entries = await Promise.all(
          saved.historyJobIds.map((jobId) => withTimeout(getJob(jobId)).catch(() => null)),
        );
        restoredHistory = entries.filter((entry): entry is JobPayload => Boolean(entry));
        if (!cancelled) {
          setHistory(restoredHistory);
        }
      }
      try {
        const fromServer = await withTimeout(listJobs({ limit: 60 }));
        if (!cancelled && fromServer.length > 0) {
          const seen = new Set(restoredHistory.map((j) => j.job_id));
          if (saved.activeJobId) seen.add(saved.activeJobId);
          for (const sid of saved.sidecarJobIds ?? []) seen.add(sid);
          const additions = fromServer.filter((j) => !seen.has(j.job_id));
          if (additions.length > 0) {
            setHistory((prev) => {
              const have = new Set(prev.map((j) => j.job_id));
              const merged = [...prev];
              for (const j of additions) {
                if (have.has(j.job_id)) continue;
                merged.push(j);
                have.add(j.job_id);
              }
              return merged;
            });
          }
        }
      } catch {
        /* server-side recovery is best-effort; localStorage already populated what it could */
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
    cancelRunInFlightRef.current = false;
  }, []);

  useEffect(() => {
    if (!workspacePersistEnabled) return;
    writeWorkspaceSession({
      activeJobId: job?.job_id ?? null,
      sidecarJobIds: sidecarJobs.map((entry) => entry.job_id),
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
    sidecarJobs,
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

  const watchedJobIdsKey = useMemo(() => {
    const ids = new Set<string>();
    if (job && !isTerminalJobStatus(job.status)) ids.add(job.job_id);
    for (const j of sidecarJobs) {
      if (!isTerminalJobStatus(j.status)) ids.add(j.job_id);
    }
    return [...ids].sort().join(",");
  }, [job?.job_id, job?.status, sidecarJobs]);

  useEffect(() => {
    if (!watchedJobIdsKey) {
      return;
    }
    let invalidated = false;

    const tick = async () => {
      const ids: string[] = [];
      const focused = jobRef.current;
      if (focused && !isTerminalJobStatus(focused.status)) ids.push(focused.job_id);
      for (const j of sidecarJobsRef.current) {
        if (!isTerminalJobStatus(j.status) && !ids.includes(j.job_id)) ids.push(j.job_id);
      }
      for (const id of ids) {
        try {
          const latest = await getJob(id);
          if (invalidated) {
            return;
          }
          const focusedId = jobRef.current?.job_id ?? null;
          if (id === focusedId) {
            setJob((prev) => {
              if (!prev || prev.job_id !== id) {
                return prev;
              }
              const next = mergeJobPoll(prev, latest, id);
              if (next !== prev) {
                if (next.status === "awaiting_concept_confirmation") {
                  queueMicrotask(() => setLoading(false));
                }
                if (next.status === "awaiting_image_generation_preview") {
                  queueMicrotask(() => {
                    setLoading(false);
                    setGenerateSubmitting(false);
                  });
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
                    setHistory((previous) =>
                      [next, ...previous.filter((j) => j.job_id !== next.job_id)].slice(0, MAX_HISTORY),
                    );
                  });
                }
              }
              return next;
            });
          } else {
            setSidecarJobs((prev) => {
              const prevEntry = prev.find((j) => j.job_id === id);
              if (!prevEntry) {
                return prev;
              }
              const next = mergeJobPoll(prevEntry, latest, id);
              if (isTerminalJobStatus(next.status)) {
                queueMicrotask(() => {
                  setHistory((previous) =>
                    [next, ...previous.filter((j) => j.job_id !== next.job_id)].slice(0, MAX_HISTORY),
                  );
                });
                return prev.filter((j) => j.job_id !== id);
              }
              return prev.map((j) => (j.job_id === id ? next : j));
            });
          }
        } catch (error) {
          if (!invalidated && id === jobRef.current?.job_id) {
            setLoading(false);
            setGenerateSubmitting(false);
            setErrorText((error as Error).message);
          }
        }
      }
    };

    const timer = setInterval(tick, POLL_MS);
    void tick();
    return () => {
      invalidated = true;
      clearInterval(timer);
    };
  }, [watchedJobIdsKey]);

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
      const outgoing = jobRef.current;
      if (outgoing && !isTerminalJobStatus(outgoing.status)) {
        setSidecarJobs((prev) => {
          const deduped = prev.filter((j) => j.job_id !== outgoing.job_id);
          return [outgoing, ...deduped];
        });
      }
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
    const current = jobRef.current;
    if (!current || cancelRunInFlightRef.current) return;
    cancelRunInFlightRef.current = true;
    setCancelRunBusy(true);
    setErrorText(null);
    const id = current.job_id;
    try {
      const cancelResult = await cancelJob(id);
      let merged: JobPayload = {
        ...current,
        status: cancelResult.status,
        cancel_requested: cancelResult.cancel_requested,
      };
      try {
        merged = await getJob(id);
      } catch {
        /* keep merged from cancel response + prior snapshot */
      }
      setJob((previous) => {
        if (!previous || previous.job_id !== id) {
          return previous;
        }
        return {
          ...merged,
          cancel_requested: Boolean(previous.cancel_requested || merged.cancel_requested),
        };
      });
      setLoading(false);
      setGenerateSubmitting(false);
      if (isTerminalJobStatus(merged.status)) {
        setHistory((previous) => [merged, ...previous.filter((j) => j.job_id !== merged.job_id)].slice(0, MAX_HISTORY));
      }
    } catch (error) {
      setErrorText((error as Error).message);
    } finally {
      cancelRunInFlightRef.current = false;
      setCancelRunBusy(false);
    }
  }

  const closeDeletePrototypeDialog = useCallback(() => {
    if (deleteDialogBusy) return;
    setDeleteDialogJob(null);
  }, [deleteDialogBusy]);

  const openDeletePrototypeDialog = useCallback((target: JobPayload) => {
    setDeleteDialogBusy(false);
    setDeleteDialogJob(target);
  }, []);

  const confirmDeletePrototype = useCallback(async () => {
    const target = deleteDialogJob;
    if (!target) return;
    const id = target.job_id;
    setDeleteDialogBusy(true);
    setErrorText(null);
    try {
      await deleteJob(id);
      setHistory((prev) => prev.filter((j) => j.job_id !== id));
      setSidecarJobs((prev) => prev.filter((j) => j.job_id !== id));
      setJob((prev) => {
        if (prev?.job_id === id) {
          queueMicrotask(() => {
            setPipelineMinimized(false);
            setRetroStep(null);
            setLoading(false);
            setGenerateSubmitting(false);
            clearActiveJobInSession();
          });
          return null;
        }
        return prev;
      });
      setDeleteDialogJob(null);
    } catch (error) {
      setErrorText((error as Error).message);
    } finally {
      setDeleteDialogBusy(false);
    }
  }, [deleteDialogJob]);

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

  async function onSaveResearchSummaryPreview() {
    if (!job || job.status !== "awaiting_image_generation_preview") return;
    setErrorText(null);
    setResearchPreviewSaveBusy(true);
    try {
      const latest = await saveImageGenerationPreview(job.job_id, {
        researchBrief: researchBriefDraft,
      });
      setJob(latest);
      setResearchBriefDraft(readResearchBrief(latest));
    } catch (error) {
      setErrorText((error as Error).message);
    } finally {
      setResearchPreviewSaveBusy(false);
    }
  }

  async function onConfirmImageGeneration() {
    if (!job || job.status !== "awaiting_image_generation_preview") return;
    setErrorText(null);
    setLoading(true);
    try {
      await confirmImageGeneration(job.job_id, { researchBrief: researchBriefDraft });
      const latest = await getJob(job.job_id);
      setJob(latest);
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

  async function onAddConceptStyle() {
    if (!job || job.status !== "awaiting_concept_confirmation") return;
    setErrorText(null);
    setLoading(true);
    try {
      const detail = extraConceptStyleDetailsRef.current.trim();
      await addConceptStyle(job.job_id, detail ? { detailPrompt: detail } : undefined);
      const latest = await getJob(job.job_id);
      setJob(latest);
      setAddConceptStyleDialogOpen(false);
    } catch (error) {
      setLoading(false);
      setErrorText((error as Error).message);
    }
  }

  const onSelectConceptStyle = useCallback(
    async (styleIndex: number) => {
      if (!job || job.status !== "awaiting_concept_confirmation") return;
      if ((job.selected_concept_style_index ?? 0) === styleIndex) return;
      setErrorText(null);
      setLoading(true);
      try {
        const updated = await selectConceptStyle(job.job_id, styleIndex);
        setJob(updated);
        setLoading(false);
      } catch (error) {
        setLoading(false);
        setErrorText((error as Error).message);
      }
    },
    [job],
  );

  async function onRegenerate3d() {
    if (!job || (job.status !== "completed" && job.status !== "failed")) return;
    setErrorText(null);
    setLoading(true);
    const regenFormats =
      job.meshy_target_formats && job.meshy_target_formats.length > 0
        ? job.meshy_target_formats
        : ["glb"];
    try {
      await regenerate3dBuild(job.job_id, { targetFormats: regenFormats });
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
    const prevFocused = jobRef.current;
    try {
      const latest = await getJob(entry.job_id);
      if (prevFocused && prevFocused.job_id !== latest.job_id && !isTerminalJobStatus(prevFocused.status)) {
        setSidecarJobs((sc) => {
          const withoutTarget = sc.filter((j) => j.job_id !== latest.job_id);
          const hasPrev = withoutTarget.some((j) => j.job_id === prevFocused.job_id);
          return hasPrev ? withoutTarget : [prevFocused, ...withoutTarget];
        });
      }
      setSidecarJobs((sc) => sc.filter((j) => j.job_id !== latest.job_id));
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
    setExtraConceptStyleDetails("");
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

  const handleResumePipeline = useCallback(async (target?: JobPayload) => {
    setErrorText(null);
    const openId = target?.job_id ?? jobRef.current?.job_id;
    if (!openId) return;
    const prevFocused = jobRef.current;
    setMainTab("home");
    try {
      const latest = await getJob(openId);
      if (prevFocused && prevFocused.job_id !== latest.job_id && !isTerminalJobStatus(prevFocused.status)) {
        setSidecarJobs((sc) => {
          const withoutTarget = sc.filter((j) => j.job_id !== latest.job_id);
          const hasPrev = withoutTarget.some((j) => j.job_id === prevFocused.job_id);
          return hasPrev ? withoutTarget : [prevFocused, ...withoutTarget];
        });
      }
      setSidecarJobs((sc) => sc.filter((j) => j.job_id !== latest.job_id));
      setJob(latest);
      setPipelineMinimized(false);
      setLoading(false);
    } catch (error) {
      setErrorText((error as Error).message);
    }
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
  const awaitingImageGenPreview = job?.status === "awaiting_image_generation_preview";
  const researchSummaryDirty = useMemo(() => {
    if (!job || job.status !== "awaiting_image_generation_preview") return false;
    const persisted = readResearchBrief(job);
    for (const key of Object.keys(persisted) as Array<keyof typeof persisted>) {
      if ((researchBriefDraft[key] ?? "").trim() !== persisted[key]) return true;
    }
    return false;
  }, [job, researchBriefDraft]);
  const researchPhase = Boolean(job) && job!.status === "running" && job!.generation_phase === "brand_research";
  const awaitingImageGenPreviewEffective = !retroStep && awaitingImageGenPreview;
  const researchPhaseEffective = !retroStep && researchPhase;
  const awaitingReview =
    job?.status === "awaiting_concept_confirmation" &&
    Boolean(job.concept_references && Object.keys(job.concept_references).length > 0);
  const conceptReferenceImagesPhase =
    Boolean(job) &&
    job!.status === "running" &&
    job!.generation_phase === "concept_reference_images";
  const conceptStylesWhileGenerating =
    conceptReferenceImagesPhase && (job?.concept_styles?.length ?? 0) > 0;
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
    !researchPhase &&
    !refsPartialFront &&
    !conceptStylesWhileGenerating;
  const meshBusy = Boolean(job) && (job!.status === "queued" || job!.status === "running") && meshPhase;
  const refsPartialFrontEffective = !retroStep && refsPartialFront;
  const refsBusyEffective = !retroStep && refsBusy;
  const meshBusyEffective = !retroStep && meshBusy;
  /** Retro "references" must always show the concept stage (same as live review), not the GLB viewer. */
  const showConceptReviewUI =
    awaitingReview || retroStep === "references" || (!retroStep && conceptStylesWhileGenerating);

  const sortedConceptStyles = useMemo(
    () => [...(job?.concept_styles ?? [])].sort((a, b) => a.index - b.index),
    [job?.concept_styles],
  );
  const selectedConceptIndex = job?.selected_concept_style_index ?? 0;
  const multiConceptStyle = sortedConceptStyles.length > 1;
  const conceptWorkshopBusy = Boolean(!retroStep && conceptStylesWhileGenerating);
  const conceptReviewReadOnly = Boolean(
    retroStep === "references" &&
      job &&
      job.status !== "awaiting_concept_confirmation",
  );
  const canRegenerate3d = Boolean(
    job && (job.status === "completed" || job.status === "failed"),
  );
  const canRegenerate3dInteractive = canRegenerate3d && !retroStep;

  /** Finished runs: show chrome above Company settings or above the Home pipeline so users can leave or delete. */
  const showTerminalJobShellHeader =
    Boolean(job && isTerminalJobStatus(job.status)) &&
    (mainTab === "company" || (mainTab === "home" && !pipelineMinimized));

  return (
    <div className="app app--shell">
      <div className="appShell">
        <AppNav
          active={mainTab}
          onSelect={handleMainTabSelect}
          pipelineBusy={anyPipelineBusy}
          recentPrototypes={sidebarRecentPrototypes}
          selectedJobId={job?.job_id ?? null}
          onOpenRecentPrototype={openHistoryEntry}
        />
        <div className="appShell__main">
          {showTerminalJobShellHeader && job ? (
            <header className="appShellHeader">
              <span className="appShellHeader__newGroup">
                <button type="button" className="button button--ghost" onClick={handleGoHome}>
                  Go home
                </button>
                <button type="button" className="button button--ghost" onClick={startFresh}>
                  New prototype
                </button>
                <button
                  type="button"
                  className="appShellHeader__deletePrototype"
                  aria-label="Delete prototype"
                  title="Delete prototype"
                  onClick={() => openDeletePrototypeDialog(job)}
                >
                  <DeletePrototypeIcon />
                </button>
              </span>
            </header>
          ) : null}

          {mainTab === "company" ? (
            <CompanySettingsPanel
              company={company}
              companyContextText={companyContextText}
              pipelineBusy={anyPipelineBusy}
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
                            : conceptStylesWhileGenerating
                              ? "Generating an additional concept style…"
                              : friendlyGenerationPhase(job.generation_phase)}
                        </p>
                      ) : null}
                      {awaitingImageGenPreview && !retroStep ? (
                        <p className="jobCard__phase">Read the research summary, then generate reference images.</p>
                      ) : null}
                      <p className="jobCard__prompt">{job.prompt}</p>
                      {job && !isTerminalJobStatus(job.status) ? (
                        <div className="jobCard__actions">
                          <button
                            type="button"
                            className="button button--dangerOutline"
                            onClick={() => void onCancelJob()}
                            disabled={cancelRunBusy}
                          >
                            {cancelRunBusy ? "Cancelling…" : "Cancel run"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  {refsBusyEffective && job ? (
                    <section className="panel" aria-label="Research summary for this run">
                      <div className="researchSummaryBanner" role="region" aria-label="Research summary">
                        <p className="researchSummaryBanner__label">Research summary</p>
                        <div className="researchSummaryBanner__body">
                          {digestFromBrief(researchBriefDraft).trim() || buildResearchSummaryMessage(job)}
                        </div>
                        <p className="researchSummaryBanner__hint">
                          Shown while reference images generate. Edits here do not apply mid-run.
                        </p>
                      </div>
                    </section>
                  ) : null}

          {awaitingReview && !retroStep ? (
            <section className="panel panel--confirm">
              <h3 className="panel__h">Export formats</h3>
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
            </section>
          ) : null}

          {!retroStep && downloads.length > 0 ? (
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

          {!retroStep && job?.files?.glb ? (
            <section className="panel panel--downloads">
              <h3 className="panel__h">Image views</h3>
              <ModelViewAngleExport glbPath={job.files.glb} jobId={job.job_id} />
            </section>
          ) : null}

          {canRegenerate3dInteractive ? (
            <section className="panel panel--confirm">
              <h3 className="panel__h">Re-run 3D build</h3>
              <p className="panel__muted">
                Runs Meshy again on the saved front reference using the same export formats as your last build (GLB if
                none were recorded). Use this when the mesh is noisy or you want a fresh pass without redoing concepts.
              </p>
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
                    ? "Frames from this completed run. Use the steps above to switch stages, or choose Home in the sidebar to return to the gallery while keeping this run."
                    : conceptWorkshopBusy
                      ? "Generating another look. Your saved styles stay below; when this finishes you can pick which one should drive the 3D build."
                      : multiConceptStyle
                        ? "Pick one style for 3D reconstruction (radio). Approve when the selected frames match your intent."
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
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => setAddConceptStyleDialogOpen(true)}
                    disabled={loading}
                  >
                    {loading ? "Working…" : "Add concept style"}
                  </button>
                </div>
              ) : null}
              {sortedConceptStyles.length > 0 ? (
                <div className="conceptStylePicker" role="list" aria-label="Concept styles">
                  {sortedConceptStyles.map((row) => {
                    const frontUrl = cloudinaryThumb(outputUrl(row.front), 320) ?? outputUrl(row.front);
                    const tqUrl = cloudinaryThumb(outputUrl(row.three_quarter), 320) ?? outputUrl(row.three_quarter);
                    const isSelected = selectedConceptIndex === row.index;
                    const genIx = job?.concept_generation_style_index;
                    const isGeneratingRow = genIx === row.index;
                    const pendingTq = Boolean(frontUrl) && !tqUrl;
                    return (
                      <div
                        key={row.index}
                        className={`conceptStyleCard${isSelected ? " conceptStyleCard--selected" : ""}`}
                        role="listitem"
                      >
                        <div className="conceptStyleCard__head">
                          {multiConceptStyle ? (
                            <label className="conceptStyleCard__pick">
                              <input
                                type="radio"
                                name="concept-style"
                                checked={isSelected}
                                onChange={() => void onSelectConceptStyle(row.index)}
                                disabled={loading || job!.status !== "awaiting_concept_confirmation"}
                              />
                              <span className="conceptStyleCard__pickText">Style {row.index + 1}</span>
                            </label>
                          ) : (
                            <span className="conceptStyleCard__pickText">Concept style</span>
                          )}
                        </div>
                        <div className="conceptStyleCard__grid">
                          {frontUrl ? (
                            <figure className="conceptFig conceptFig--compact">
                              <figcaption className="conceptFig__cap">Front</figcaption>
                              <div className="conceptFig__frame">
                                <img src={frontUrl} alt={`Style ${row.index + 1} front`} className="conceptFig__img" />
                              </div>
                            </figure>
                          ) : null}
                          {tqUrl ? (
                            <figure className="conceptFig conceptFig--compact">
                              <figcaption className="conceptFig__cap">Three-quarter</figcaption>
                              <div className="conceptFig__frame">
                                <img
                                  src={tqUrl}
                                  alt={`Style ${row.index + 1} three-quarter`}
                                  className="conceptFig__img"
                                />
                              </div>
                            </figure>
                          ) : pendingTq ? (
                            <figure className="conceptFig conceptFig--compact">
                              <figcaption className="conceptFig__cap">Three-quarter</figcaption>
                              <div className="conceptFig__frame conceptFig__frame--pending">
                                <div className="conceptFig__pending">
                                  <div className="stageBusy__pulse" aria-hidden />
                                  <p className="conceptFig__pendingText">
                                    {isGeneratingRow ? "Rendering three-quarter…" : "Waiting…"}
                                  </p>
                                </div>
                              </div>
                            </figure>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="conceptGrid">
                  {(["front", "three_quarter"] as const).map((key) => {
                    const path = job!.concept_references?.[key];
                    const raw = outputUrl(path);
                    const url = cloudinaryOptimized(raw, 1000) ?? raw;
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
              )}
            </div>
          ) : awaitingImageGenPreviewEffective ? (
            <div className="conceptStage conceptStage--research">
              <header className="conceptStage__header">
                <p className="conceptStage__eyebrow">Step 1 · Research</p>
                <h2 className="conceptStage__title">Research summary for this product</h2>
                <p className="conceptStage__sub">
                  This is what the image model sees before drawing. Review each card, edit anything that&rsquo;s off,
                  then generate reference images.
                </p>
                {job!.company ? (
                  <p className="conceptStage__company">
                    <span className="conceptStage__companyLabel">Company</span>
                    <span className="conceptStage__companyValue">{job!.company}</span>
                  </p>
                ) : null}
              </header>
              <ResearchSummaryEditor
                brief={researchBriefDraft}
                onChange={setResearchBriefDraft}
                disabled={loading || researchPreviewSaveBusy}
              />
              {job!.research_warnings && job!.research_warnings.length > 0 ? (
                <p className="conceptStage__warnings" role="status">
                  {job!.research_warnings.join(" · ")}
                </p>
              ) : null}
              <div className="conceptStage__actions conceptStage__actions--research">
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void onConfirmImageGeneration()}
                  disabled={loading || researchPreviewSaveBusy}
                >
                  {loading ? "Starting…" : "Generate reference images"}
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void onSaveResearchSummaryPreview()}
                  disabled={loading || researchPreviewSaveBusy || !researchSummaryDirty}
                >
                  {researchPreviewSaveBusy
                    ? "Saving…"
                    : researchSummaryDirty
                      ? "Save edits"
                      : "Saved"}
                </button>
                <p className="conceptStage__actionsNote">
                  Saving rebuilds the underlying image prompts. Sources and raw prompts are below.
                </p>
              </div>
              {job!.research_sources && job!.research_sources.length > 0 ? (
                <details className="researchOptionalBlock">
                  <summary className="researchOptionalBlock__summary">Sources ({job!.research_sources.length})</summary>
                  <ul className="panel__muted researchOptionalBlock__list">
                    {job!.research_sources.map((s) => (
                      <li key={`${s.url}-${s.title}`}>
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noreferrer">
                            {s.title || s.url}
                          </a>
                        ) : (
                          s.title
                        )}
                        {s.snippet ? <span> — {s.snippet}</span> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {job!.image_generation_preview ? (
                <details className="researchOptionalBlock">
                  <summary className="researchOptionalBlock__summary">Full image prompts (advanced)</summary>
                  <section className="researchOptionalBlock__section">
                    <h3 className="panel__h">Front reference</h3>
                    <pre className="researchOptionalBlock__pre">{job!.image_generation_preview.front_prompt}</pre>
                  </section>
                  <section className="researchOptionalBlock__section">
                    <h3 className="panel__h">Three-quarter</h3>
                    <p className="panel__fineprint">
                      {job!.image_generation_preview.three_quarter_mode}
                      {job!.image_generation_preview.three_quarter_edit_model
                        ? ` · ${job!.image_generation_preview.three_quarter_edit_model}`
                        : ""}
                    </p>
                    <pre className="researchOptionalBlock__pre">{job!.image_generation_preview.three_quarter_prompt}</pre>
                  </section>
                </details>
              ) : null}
            </div>
          ) : researchPhaseEffective ? (
            <div className="stagePanel stagePanel--busy">
              <div className="stageBusy">
                <div className="stageBusy__pulse" aria-hidden />
                <h2 className="stageBusy__title">Researching your brand</h2>
                <p className="stageBusy__text">{friendlyGenerationPhase("brand_research")}</p>
                <p className="stageBusy__hint">You can leave this tab open. We update automatically.</p>
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
                  const raw = outputUrl(path);
                  const url = cloudinaryOptimized(raw, 1000) ?? raw;
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
              onDeletePortfolioJob={openDeletePrototypeDialog}
              addAssetsRef={addAssetsRef}
              backgroundJobs={homeBackgroundJobs}
              onResumePipeline={homeBackgroundJobs.length > 0 ? handleResumePipeline : undefined}
              imagePreviewJob={
                mainTab === "home" && pipelineMinimized && job?.status === "awaiting_image_generation_preview"
                  ? job
                  : null
              }
              researchBriefDraft={researchBriefDraft}
              onChangeResearchBriefDraft={setResearchBriefDraft}
              onConfirmImagePreview={() => void onConfirmImageGeneration()}
              onSaveResearchSummaryPreview={() => void onSaveResearchSummaryPreview()}
              imagePreviewBusy={Boolean(loading && job?.status === "awaiting_image_generation_preview")}
              researchPreviewSaveBusy={researchPreviewSaveBusy}
              researchSummaryDirty={researchSummaryDirty}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteDialogJob !== null}
        title="Delete this prototype?"
        danger
        isWorking={deleteDialogBusy}
        workingConfirmLabel="Deleting…"
        cancelLabel="Cancel"
        confirmLabel="Delete"
        onCancel={closeDeletePrototypeDialog}
        onConfirm={confirmDeletePrototype}
      >
        <p className="confirmDialogLead">
          All files and previews for this run will be removed permanently. This cannot be undone.
        </p>
        {deleteDialogJob?.prompt?.trim() ? (
          <p className="confirmDialogIdea" title={deleteDialogJob.prompt}>
            <span className="confirmDialogIdea__label">Idea</span>
            {deleteDialogJob.prompt.length > 220
              ? `${deleteDialogJob.prompt.slice(0, 220)}…`
              : deleteDialogJob.prompt}
          </p>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={addConceptStyleDialogOpen}
        title="Add concept style"
        cancelLabel="Cancel"
        confirmLabel="Add concept style"
        isWorking={loading}
        workingConfirmLabel="Working…"
        onCancel={() => {
          if (!loading) setAddConceptStyleDialogOpen(false);
        }}
        onConfirm={() => void onAddConceptStyle()}
      >
        <p className="confirmDialogLead">
          Optional details for this run only—refine lighting, materials, proportions, or graphics without changing your
          main product prompt. Leave blank to add a look with no extra direction.
        </p>
        <div className="confirmDialogIdea">
          <label htmlFor={addConceptStyleDetailsFieldId} className="confirmDialogIdea__label">
            Optional style notes
          </label>
          <textarea
            id={addConceptStyleDetailsFieldId}
            className="textarea textarea--prompt"
            rows={3}
            value={extraConceptStyleDetails}
            onChange={(e) => {
              const v = e.target.value;
              extraConceptStyleDetailsRef.current = v;
              setExtraConceptStyleDetails(v);
            }}
            disabled={loading}
            maxLength={2000}
            placeholder="e.g. Warmer studio light, more matte finish, emphasize the side vents…"
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
