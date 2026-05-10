"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { inferPlanFocusFromPrompt, type JobPayload, type ManufacturingPlan } from "@/lib/api";
import { sendSupplierContact } from "@/lib/api";

type SupplierContactStageProps = {
  job: JobPayload;
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

function channelsHeadingForPlan(plan: ManufacturingPlan | null, prompt: string): string {
  const planFocus = plan ? normalizePlanFocus(plan) : inferPlanFocusFromPrompt(prompt);
  if (planFocus === "virtual_service") return "Channels and partners";
  if (planFocus === "hybrid") return "Channels, partners, and suppliers";
  return "Where to reach suppliers";
}

function extractFirstEmailFromTexts(...parts: (string | undefined)[]): string {
  const re = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  for (const p of parts) {
    if (!p) continue;
    const m = p.match(re);
    if (m?.[0]) return m[0].toLowerCase();
  }
  return "";
}

function messageFromPlaybookRow(
  row: NonNullable<ManufacturingPlan["supplier_playbook"]>[number],
  productName: string | undefined,
  company: string | undefined,
): string {
  const companyLine = company?.trim();
  const product = productName?.trim() || "our product";
  const lines = [
    "Hello,",
    "",
    `I'm reaching out regarding ${product}, following a sourcing path from our production plan.`,
    "",
    `Recommended channel / venue: ${row.venue ?? "—"}`,
    `Geography: ${row.geography ?? "—"}`,
    "",
    "How to reach (from our brief):",
    row.how_to_reach ?? "—",
    "",
    "Checklist we have in mind:",
    row.checklist ?? "—",
    "",
    ...(companyLine ? [`Company / brand context: ${companyLine}.`] : []),
    "",
    "[Add volumes, timeline, certifications, and any drawings or STEP files you can share.]",
    "",
    "Best regards,",
    "[Your name]",
  ];
  return lines.join("\n");
}

export function SupplierContactStage({ job }: SupplierContactStageProps) {
  const plan = normalizePlan(job.manufacturing_plan);
  const channelsHeading = channelsHeadingForPlan(plan, job.prompt ?? "");

  const [supplierEmail, setSupplierEmail] = useState("");
  const [supplierSubject, setSupplierSubject] = useState("");
  const [supplierMessage, setSupplierMessage] = useState("");
  const [supplierBusy, setSupplierBusy] = useState(false);
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [supplierSuccess, setSupplierSuccess] = useState<string | null>(null);
  const [supplierPick, setSupplierPick] = useState<string>("custom");

  const defaultSupplierSubject = useMemo(() => {
    const name = job.spec?.product_name?.trim();
    if (name) return `Manufacturing inquiry: ${name}`;
    return "Manufacturing inquiry (Artifex)";
  }, [job.spec?.product_name]);

  const defaultSupplierMessage = useMemo(() => {
    const company = job.company?.trim();
    const lines = [
      "Hello,",
      "",
      "I'm reaching out about a product we're developing. A short summary of the concept and spec is in our workspace.",
      ...(company ? [`Company / brand context: ${company}.`] : []),
      "",
      "[Add volumes, timeline, certifications, and any drawings or STEP files you can share.]",
      "",
      "Best regards,",
      "[Your name]",
    ];
    return lines.join("\n");
  }, [job.company]);

  const supplierPlaybook = plan?.supplier_playbook ?? [];
  const hasPlaybookPicks = supplierPlaybook.length > 0;

  const supplierPlaybookSig = useMemo(
    () => JSON.stringify(normalizePlan(job.manufacturing_plan)?.supplier_playbook ?? []),
    [job.manufacturing_plan],
  );

  const productNameForSupplier = job.spec?.product_name?.trim();

  const applySupplierPick = useCallback(
    (pick: string, playbook: NonNullable<ManufacturingPlan["supplier_playbook"]>) => {
      if (pick !== "custom" && playbook.length > 0) {
        const idx = Number.parseInt(pick, 10);
        if (!Number.isNaN(idx) && idx >= 0 && idx < playbook.length) {
          const row = playbook[idx];
          const base = productNameForSupplier
            ? `Manufacturing inquiry: ${productNameForSupplier}`
            : "Manufacturing inquiry (Artifex)";
          const venue = (row.venue ?? "").trim();
          const extra = venue ? ` — ${venue}` : "";
          const combined = `${base}${extra}`;
          const subject = combined.length > 200 ? `${combined.slice(0, 197)}…` : combined;
          setSupplierSubject(subject);
          setSupplierMessage(messageFromPlaybookRow(row, productNameForSupplier, job.company ?? undefined));
          const hint = extractFirstEmailFromTexts(row.how_to_reach, row.venue, row.geography, row.checklist);
          setSupplierEmail(hint);
          return;
        }
      }
      setSupplierSubject(defaultSupplierSubject);
      setSupplierMessage(defaultSupplierMessage);
      setSupplierEmail("");
    },
    [defaultSupplierMessage, defaultSupplierSubject, job.company, productNameForSupplier],
  );

  useEffect(() => {
    setSupplierError(null);
    setSupplierSuccess(null);
  }, [job.job_id]);

  useEffect(() => {
    const playbook = normalizePlan(job.manufacturing_plan)?.supplier_playbook ?? [];
    if (playbook.length > 0) {
      setSupplierPick("0");
      applySupplierPick("0", playbook);
    } else {
      setSupplierPick("custom");
      applySupplierPick("custom", playbook);
    }
  }, [job.job_id, supplierPlaybookSig, applySupplierPick]);

  const sendSupplier = useCallback(async () => {
    setSupplierError(null);
    setSupplierSuccess(null);
    setSupplierBusy(true);
    try {
      const result = await sendSupplierContact(job.job_id, {
        toEmail: supplierEmail,
        subject: supplierSubject,
        message: supplierMessage,
      });
      const tid = result.tracking_id?.trim();
      setSupplierSuccess(
        tid ? `${result.detail ?? "Sent."} Tracking ID: ${tid}` : (result.detail ?? "Message sent."),
      );
    } catch (e) {
      setSupplierError((e as Error).message);
    } finally {
      setSupplierBusy(false);
    }
  }, [job.job_id, supplierEmail, supplierMessage, supplierSubject]);

  return (
    <div className="supplierOutreachStage">
      <header className="productionFollowSection productionFollowSection--hero" aria-labelledby="supplierOutreachTitle">
        <p className="productionFollowSection__eyebrow">Step 5 · Supplier outreach</p>
        <h2 id="supplierOutreachTitle" className="productionFollowSection__title">
          Contact a supplier
        </h2>
        <p className="productionFollowSection__lead">
          Send email through{" "}
          <a href="https://www.pingram.io/" target="_blank" rel="noopener noreferrer">
            Pingram
          </a>
          . The API key stays on the server; you choose who receives the message.
        </p>
      </header>

      {!plan ? (
        <p className="productionFollowSection__hint">
          Build a <strong>production overview</strong> in step 4 to unlock recommended channels from your brief—we
          will pre-fill subject and body from that row. You can still send a manual email once you have an address.
        </p>
      ) : !hasPlaybookPicks ? (
        <p className="productionFollowSection__hint">
          This overview did not include channel cards—open <strong>Production</strong> and use{" "}
          <strong>Regenerate overview</strong> if you expected supplier suggestions, or send a fully custom message
          below.
        </p>
      ) : (
        <fieldset className="productionSupplierPick">
          <legend className="productionSupplierPick__legend">Recommended supplier or channel</legend>
          <p className="productionSupplierPick__hint">
            Choose one of the venues from your <strong>{channelsHeading}</strong> section in the production plan. We
            merge its checklist into your draft. If an email appears in the brief, we suggest it—you can edit before
            send.
          </p>
          <div className="productionSupplierPick__grid" role="radiogroup" aria-label="Recommended supplier or channel">
            {supplierPlaybook.map((row, i) => {
              const id = `supplier-pick-${i}`;
              const checked = supplierPick === String(i);
              return (
                <div
                  key={i}
                  className={`productionSupplierPick__option${checked ? " productionSupplierPick__option--selected" : ""}`}
                >
                  <input
                    type="radio"
                    className="productionSupplierPick__input"
                    id={id}
                    name="supplier-pick"
                    value={String(i)}
                    checked={checked}
                    disabled={supplierBusy}
                    onChange={() => {
                      const next = String(i);
                      setSupplierPick(next);
                      applySupplierPick(next, supplierPlaybook);
                    }}
                  />
                  <label htmlFor={id} className="productionSupplierPick__label">
                    <span className="productionSupplierPick__venue">{row.venue ?? `Option ${i + 1}`}</span>
                    <span className="productionSupplierPick__geo">{row.geography}</span>
                  </label>
                </div>
              );
            })}
            <div
              className={`productionSupplierPick__option productionSupplierPick__option--custom${
                supplierPick === "custom" ? " productionSupplierPick__option--selected" : ""
              }`}
            >
              <input
                type="radio"
                className="productionSupplierPick__input"
                id="supplier-pick-custom"
                name="supplier-pick"
                value="custom"
                checked={supplierPick === "custom"}
                disabled={supplierBusy}
                onChange={() => {
                  setSupplierPick("custom");
                  applySupplierPick("custom", supplierPlaybook);
                }}
              />
              <label htmlFor="supplier-pick-custom" className="productionSupplierPick__label">
                <span className="productionSupplierPick__venue">Custom contact</span>
                <span className="productionSupplierPick__geo">Do not use a playbook row; write your own context.</span>
              </label>
            </div>
          </div>
        </fieldset>
      )}

      <div className="productionCard productionCard--wide productionContact productionContact--nested">
        <h3 className="productionCard__h productionContact__h">Email draft</h3>
        <div className="productionContact__fields">
          <label className="field">
            <span className="field__label">
              Supplier email <span className="field__req">*</span>
            </span>
            <input
              type="email"
              className="input"
              autoComplete="email"
              value={supplierEmail}
              onChange={(e) => setSupplierEmail(e.target.value)}
              placeholder="contact@factory.example"
              disabled={supplierBusy}
            />
          </label>
          <label className="field">
            <span className="field__label">
              Subject <span className="field__req">*</span>
            </span>
            <input
              type="text"
              className="input"
              value={supplierSubject}
              onChange={(e) => setSupplierSubject(e.target.value)}
              disabled={supplierBusy}
            />
          </label>
          <label className="field">
            <span className="field__label">
              Message <span className="field__req">*</span>
            </span>
            <textarea
              className="textarea"
              rows={10}
              value={supplierMessage}
              onChange={(e) => setSupplierMessage(e.target.value)}
              disabled={supplierBusy}
            />
          </label>
        </div>
        <div className="productionContact__actions">
          <button
            type="button"
            className="button button--ghost"
            disabled={supplierBusy || !supplierEmail.trim() || !supplierSubject.trim() || !supplierMessage.trim()}
            onClick={() => void sendSupplier()}
          >
            {supplierBusy ? "Sending…" : "Send email via Pingram"}
          </button>
        </div>
        {supplierError ? (
          <p className="productionStage__error productionContact__status" role="alert">
            {supplierError}
          </p>
        ) : null}
        {supplierSuccess ? (
          <p className="productionContact__success" role="status">
            {supplierSuccess}
          </p>
        ) : null}
      </div>
    </div>
  );
}
