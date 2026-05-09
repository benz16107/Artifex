"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { FlowStepper } from "@/components/FlowStepper";
import { ModelViewer } from "@/components/ModelViewer";
import { PromptForm } from "@/components/PromptForm";
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
  getSamplePrompts,
  outputUrl,
} from "@/lib/api";

const POLL_MS = 1200;

const MESHY_FORMAT_OPTIONS: { id: string; label: string; hint?: string }[] = [
  { id: "glb", label: "GLB", hint: "Live preview" },
  { id: "obj", label: "OBJ", hint: "+ MTL when available" },
  { id: "fbx", label: "FBX" },
  { id: "stl", label: "STL", hint: "meshy_scan.stl" },
  { id: "usdz", label: "USDZ" },
  { id: "3mf", label: "3MF" },
];

function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [company, setCompany] = useState("");
  const [documentsText, setDocumentsText] = useState("");
  const [samples, setSamples] = useState<string[]>([]);
  const [job, setJob] = useState<JobPayload | null>(null);
  const [history, setHistory] = useState<JobPayload[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [meshyFormats, setMeshyFormats] = useState<string[]>(["glb"]);

  const flowStep = getFlowStep(job);
  const jobActive = Boolean(job) && !isTerminalJobStatus(job!.status);
  const showCompose = !jobActive;
  const failed = job?.status === "failed";

  useEffect(() => {
    getSamplePrompts().then(setSamples).catch(() => setSamples([]));
  }, []);

  useEffect(() => {
    if (!job || isTerminalJobStatus(job.status)) {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const latest = await getJob(job.job_id);
        setJob(latest);
        if (latest.status === "awaiting_concept_confirmation") {
          setLoading(false);
        }
        if (isTerminalJobStatus(latest.status)) {
          setLoading(false);
          setHistory((previous) => [latest, ...previous.filter((j) => j.job_id !== latest.job_id)].slice(0, 12));
        }
      } catch (error) {
        setLoading(false);
        setErrorText((error as Error).message);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [job]);

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
    setErrorText(null);
    setLoading(true);
    try {
      const docs = documentsText
        .split("\n\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 12);
      const queued = await generateEnterprise({ prompt, company: company.trim() || undefined, documents: docs });
      setMeshyFormats(["glb"]);
      setJob({
        job_id: queued.job_id,
        prompt,
        status: queued.status,
        files: {},
        warnings: [],
        stage_durations_ms: {},
      });
    } catch (error) {
      setLoading(false);
      setErrorText((error as Error).message);
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
    } catch (error) {
      setLoading(false);
      setErrorText((error as Error).message);
    }
  }

  async function openHistoryEntry(entry: JobPayload) {
    setErrorText(null);
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
    setErrorText(null);
    setLoading(false);
  }

  const gp = (job?.generation_phase ?? "").toLowerCase();
  const meshPhase = gp.includes("image_to_3d") || gp.includes("to_3d");
  const awaitingReview =
    job?.status === "awaiting_concept_confirmation" &&
    Boolean(job.concept_references && Object.keys(job.concept_references).length > 0);
  const refsBusy =
    Boolean(job) &&
    (job!.status === "queued" || job!.status === "running") &&
    !awaitingReview &&
    !meshPhase;
  const meshBusy = Boolean(job) && (job!.status === "queued" || job!.status === "running") && meshPhase;

  return (
    <div className="app">
      <header className="appHeader">
        <div className="appHeader__brand">
          <span className="appHeader__mark" aria-hidden />
          <div>
            <h1 className="appHeader__title">Artifex</h1>
            <p className="appHeader__tag">Object-first 3D prototypes</p>
          </div>
        </div>
        {job && isTerminalJobStatus(job.status) ? (
          <button type="button" className="button button--ghost" onClick={startFresh}>
            New prototype
          </button>
        ) : null}
      </header>

      <FlowStepper active={flowStep} failed={failed} />

      <div className="split">
        <aside className="split__rail">
          {showCompose ? (
            <section className="panel">
              <PromptForm
                value={prompt}
                company={company}
                documentsText={documentsText}
                loading={loading}
                samples={samples}
                disabled={false}
                onChange={setPrompt}
                onChangeCompany={setCompany}
                onChangeDocumentsText={setDocumentsText}
                onMergeDocumentSections={mergeDocumentSections}
                onSubmit={onGenerate}
              />
            </section>
          ) : (
            <section className="panel panel--job">
              <div className="jobCard">
                <p className="jobCard__eyebrow">Current run</p>
                <p className="jobCard__id">{job ? shortId(job.job_id) : ""}</p>
                <p className="jobCard__status">{job ? friendlyJobStatus(job.status) : ""}</p>
                {job && (job.status === "queued" || job.status === "running") && job.generation_phase ? (
                  <p className="jobCard__phase">{friendlyGenerationPhase(job.generation_phase)}</p>
                ) : null}
                <p className="jobCard__prompt">{job?.prompt}</p>
                <button type="button" className="button button--dangerOutline" onClick={onCancelJob}>
                  Cancel run
                </button>
              </div>
            </section>
          )}

          {awaitingReview ? (
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
              <div className="panel__actions">
                <button type="button" className="button button--primary" onClick={onConfirmConcept} disabled={loading}>
                  {loading ? "Starting 3D…" : "Approve & build 3D"}
                </button>
              </div>
              <p className="panel__fineprint">
                If the concepts are off, cancel the run, tweak your prompt or brand context, and generate again.
              </p>
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
                      <span className="historyList__id">{shortId(entry.job_id)}</span>
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
          {awaitingReview ? (
            <div className="conceptStage">
              <header className="conceptStage__header">
                <h2 className="conceptStage__title">Review concept art</h2>
                <p className="conceptStage__sub">These frames drive the 3D reconstruction. Approve when they match your intent.</p>
              </header>
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
          ) : refsBusy ? (
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
          ) : meshBusy ? (
            <ModelViewer waitingForMesh />
          ) : (
            <ModelViewer
              glbPath={job?.files.glb}
              previewPath={job?.files.preview}
              emptyTitle={flowStep === "describe" ? "Your workspace" : "3D preview"}
              emptySubtitle={
                flowStep === "describe"
                  ? "Submit a product idea to generate concepts. After you approve them, the 3D model appears here."
                  : "The interactive GLB loads in this panel when the mesh step completes."
              }
            />
          )}
        </main>
      </div>
    </div>
  );
}
