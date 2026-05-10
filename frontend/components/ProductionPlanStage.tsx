"use client";

import { useCallback, useState } from "react";

import { inferPlanFocusFromPrompt, type JobPayload, type ManufacturingPlan } from "@/lib/api";
import { requestManufacturingBrief } from "@/lib/api";
import { ModelViewer } from "@/components/ModelViewer";

type ProductionPlanStageProps = {
  job: JobPayload;
  /** Workspace company context (merged into the brief request; may overlap job.documents). */
  companyContextText: string;
  onJobUpdated: (job: JobPayload) => void;
};

function normalizePlan(raw: ManufacturingPlan | null | undefined): ManufacturingPlan | null {
  if (!raw || typeof raw !== "object") return null;
  return raw;
}

function normalizePlanFocus(plan: ManufacturingPlan | null): "physical_product" | "virtual_service" | "hybrid" {
  const f = plan?.plan_focus;
  if (f === "virtual_service" || f === "hybrid" || f === "physical_product") return f;
  return "physical_product";
}

export function ProductionPlanStage({ job, companyContextText, onJobUpdated }: ProductionPlanStageProps) {
  const plan = normalizePlan(job.manufacturing_plan);
  const planFocus = plan ? normalizePlanFocus(plan) : inferPlanFocusFromPrompt(job.prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runBrief = useCallback(
    async (refresh: boolean) => {
      setError(null);
      setBusy(true);
      try {
        const merged = [companyContextText.trim(), job.documents?.join("\n\n") ?? ""].filter(Boolean).join("\n\n");
        const next = await requestManufacturingBrief(job.job_id, {
          companyContext: merged || undefined,
          refresh,
        });
        onJobUpdated(next);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [companyContextText, job.documents, job.job_id, onJobUpdated],
  );

  const companyLabel = job.company?.trim() || "Your workspace";

  const title =
    planFocus === "virtual_service"
      ? "Build, go-to-market, and production readiness"
      : planFocus === "hybrid"
        ? "Software, GTM, and manufacturing outlook"
        : "Manufacturing, parts, and cost outlook";

  const lead =
    planFocus === "virtual_service" ? (
      <>
        Grounded in <strong>{companyLabel}</strong>, your research brief, internal documents, and this run’s spec.
        The same cost bands are reframed for engineering, hosting, and launch: use the desktop web 3D preview for the
        hero asset, and treat this overview as planning guidance—not a quote.
      </>
    ) : planFocus === "hybrid" ? (
      <>
        Grounded in <strong>{companyLabel}</strong>, your research brief, internal documents, and the structured
        spec. Covers parallel software delivery, GTM, and physical supply where relevant—not a binding quote.
      </>
    ) : (
      <>
        Grounded in <strong>{companyLabel}</strong>, your research brief, internal documents, and the structured
        product spec from this run. Use this as a conversation starter with factories—not a binding quote.
      </>
    );

  const bomHeading =
    planFocus === "virtual_service"
      ? "Capability stack (conceptual)"
      : planFocus === "hybrid"
        ? "Bill of materials and systems (conceptual)"
        : "Bill of materials (conceptual)";
  const costDtTooling =
    planFocus === "virtual_service"
      ? "One-time setup (indicative band)"
      : planFocus === "hybrid"
        ? "Setup (tooling + platform, indicative band)"
        : "Tooling (indicative band)";
  const costDtUnit =
    planFocus === "virtual_service"
      ? "Marginal / operating cost band"
      : planFocus === "hybrid"
        ? "Unit / marginal cost band"
        : "Unit cost band";
  const costDtMoq =
    planFocus === "virtual_service"
      ? "Pilot / launch scope"
      : planFocus === "hybrid"
        ? "MOQ, pilots, and scaling"
        : "MOQ & scaling";
  const channelsHeading =
    planFocus === "virtual_service"
      ? "Channels and partners"
      : planFocus === "hybrid"
        ? "Channels, partners, and suppliers"
        : "Where to reach suppliers";
  const cuesHeading =
    planFocus === "virtual_service"
      ? "Before you ship"
      : planFocus === "hybrid"
        ? "Launch and supplier checklist"
        : "Before you email a factory";

  return (
    <div className="productionStage">
      <header className="productionStage__hero">
        <div className="productionStage__heroGlow" aria-hidden />
        <p className="productionStage__eyebrow">Step 4 · Production readiness</p>
        <h2 className="productionStage__title">{title}</h2>
        <p className="productionStage__lead">{lead}</p>
        <div className="productionStage__heroActions">
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void runBrief(Boolean(plan))}
          >
            {busy ? "Working…" : plan ? "Regenerate overview" : "Build production overview"}
          </button>
        </div>
        {plan?.stub ? (
          <div className="productionStage__stubNote" role="status">
            <p className="productionStage__stubNoteLead">
              {plan.stub_reason === "missing_openai_key"
                ? "Showing a template: the API process did not have OPENAI_API_KEY when this was saved, or you are seeing a cached copy from then."
                : "Showing a template: the live model call failed on the API server (this is not a missing-key message)."}
            </p>
            {plan.stub_reason === "llm_error" && plan.stub_detail ? (
              <p className="productionStage__stubNoteDetail">{plan.stub_detail}</p>
            ) : null}
            {plan.stub_reason === "missing_openai_key" ? (
              <p className="productionStage__stubNoteHint">
                Set the key in the repo-root <code className="productionStage__code">.env</code>, restart the Django
                API, then press <strong>Regenerate overview</strong> (or press Build again—we now auto-retry when the
                cache was only a missing-key stub and a key is present).
              </p>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p className="productionStage__error" role="alert">
            {error}
          </p>
        ) : null}
      </header>

      {job.files?.glb ? (
        <section className="productionStage__modelPreview" aria-label="3D model preview">
          <ModelViewer
            glbPath={job.files.glb}
            previewPath={job.files.preview}
            emptyTitle="3D preview"
            emptySubtitle="Your interactive model appears here once the mesh build finishes."
          />
        </section>
      ) : null}

      {!plan ? (
        <section className="productionStage__empty">
          <div className="productionStage__emptyIcon" aria-hidden>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path
                d="M8 36V20l6-8h20l6 8v16H8Z"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinejoin="round"
              />
              <path d="M16 36V26h16v10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              <circle cx="24" cy="16" r="2" fill="currentColor" />
            </svg>
          </div>
          <h3 className="productionStage__emptyTitle">Ready when you are</h3>
          <p className="productionStage__emptyText">
            {planFocus === "virtual_service"
              ? "We combine your company context, documents, digest, and the JSON spec to outline engineering milestones, a capability-style breakdown, rough cost bands for build and run, and GTM channels. Regenerate after changing the prompt if the focus shifts."
              : planFocus === "hybrid"
                ? "We combine context and spec to cover software milestones, GTM, and physical manufacturing where both matter."
                : "We combine your company context, documents, digest, and the JSON spec to estimate processes, a BOM-style breakdown, rough cost bands, and where to start supplier conversations."}
          </p>
        </section>
      ) : (
        <div className="productionStage__grid">
          <section className="productionCard productionCard--accent">
            <h3 className="productionCard__h">Summary</h3>
            <p className="productionCard__headline">{plan.headline}</p>
            <p className="productionCard__body">{plan.process_summary}</p>
          </section>

          <section className="productionCard">
            <h3 className="productionCard__h">Recommended processes</h3>
            <ul className="productionProcessList">
              {(plan.recommended_processes ?? []).map((row, i) => (
                <li key={i} className="productionProcessList__item">
                  <span className="productionProcessList__badge" aria-hidden>
                    {i + 1}
                  </span>
                  <div>
                    <p className="productionProcessList__name">{row.name}</p>
                    <p className="productionProcessList__why">{row.rationale}</p>
                    <p className="productionProcessList__meta">Typical lead time: {row.typical_lead_time_weeks}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="productionCard productionCard--wide">
            <h3 className="productionCard__h">{bomHeading}</h3>
            <div className="productionTableWrap">
              <table className="productionTable">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Role</th>
                    <th>Material / process</th>
                    <th>Sourcing notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(plan.bill_of_materials ?? []).map((row, i) => (
                    <tr key={i}>
                      <td>{row.component}</td>
                      <td>{row.function}</td>
                      <td>{row.material_or_process}</td>
                      <td>{row.sourcing_notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="productionCard productionCard--cost">
            <h3 className="productionCard__h">Cost snapshot</h3>
            <dl className="productionCostDl">
              <div>
                <dt>{costDtTooling}</dt>
                <dd>{plan.cost_snapshot?.tooling_usd_band}</dd>
              </div>
              <div>
                <dt>{costDtUnit}</dt>
                <dd>{plan.cost_snapshot?.unit_cost_usd_band}</dd>
              </div>
              <div>
                <dt>{costDtMoq}</dt>
                <dd>{plan.cost_snapshot?.moq_comment}</dd>
              </div>
            </dl>
            <p className="productionCard__disclaimer">{plan.cost_snapshot?.disclaimer}</p>
          </section>

          <section className="productionCard">
            <h3 className="productionCard__h">{channelsHeading}</h3>
            <div className="productionSupplierGrid">
              {(plan.supplier_playbook ?? []).map((row, i) => (
                <article key={i} className="productionSupplierCard">
                  <div className="productionSupplierCard__pin" aria-hidden>
                    📍
                  </div>
                  <h4 className="productionSupplierCard__title">{row.venue}</h4>
                  <p className="productionSupplierCard__geo">{row.geography}</p>
                  <p className="productionSupplierCard__reach">{row.how_to_reach}</p>
                  <p className="productionSupplierCard__check">
                    <span className="productionSupplierCard__checkLabel">Checklist</span>
                    {row.checklist}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="productionCard productionCard--visual">
            <h3 className="productionCard__h">{cuesHeading}</h3>
            <ul className="productionCueList">
              {(plan.visual_cues ?? []).map((line, i) => (
                <li key={i} className="productionCueList__item">
                  <span className="productionCueList__lens" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
          </section>

          {(plan.risks?.length ?? 0) > 0 ? (
            <section className="productionCard productionCard--wide productionCard--risks">
              <h3 className="productionCard__h">Risks & unknowns</h3>
              <ul className="productionRiskList">
                {(plan.risks ?? []).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
