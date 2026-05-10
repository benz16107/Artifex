"""LLM-backed manufacturing / BOM / cost planning for a completed prototype run."""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from urllib import error, request

from app.config import (
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENAI_MODEL,
    SPEC_LLM_MAX_RETRIES,
    SPEC_LLM_TIMEOUT_SECONDS,
)

logger = logging.getLogger("object-first-mvp")


def _chat_completions_url() -> str:
    base = (OPENAI_BASE_URL or "https://api.openai.com").rstrip("/")
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def _post_json_object(messages: list[dict[str, str]]) -> dict[str, Any]:
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY is not set.")

    use_json = "openai.com" in (OPENAI_BASE_URL or "").lower()
    payload: dict[str, Any] = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "temperature": 0.3,
    }
    if use_json:
        payload["response_format"] = {"type": "json_object"}

    body = json.dumps(payload).encode("utf-8")
    url = _chat_completions_url()
    last_err: str | None = None
    for attempt in range(max(1, SPEC_LLM_MAX_RETRIES + 1)):
        try:
            req = request.Request(
                url,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                },
                method="POST",
            )
            with request.urlopen(req, timeout=SPEC_LLM_TIMEOUT_SECONDS) as response:
                parsed = json.loads(response.read().decode("utf-8"))
            content = parsed["choices"][0]["message"]["content"]
            if isinstance(content, list):
                content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
            text = (content or "").strip()
            if not text:
                raise ValueError("Model returned empty content.")
            text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
            text = re.sub(r"\s*```$", "", text)
            return json.loads(text)
        except error.HTTPError as exc:
            try:
                detail = exc.read().decode("utf-8", errors="replace")
            except Exception:
                detail = str(exc)
            last_err = f"HTTP {getattr(exc, 'code', '?')}: {detail[:500]}"
            if exc.code == 400 and use_json and "response_format" in detail.lower():
                use_json = False
                payload.pop("response_format", None)
                body = json.dumps(payload).encode("utf-8")
                continue
            if exc.code in (408, 429, 500, 502, 503, 504) and attempt < SPEC_LLM_MAX_RETRIES:
                continue
            break
        except error.URLError as exc:
            last_err = f"URL error: {exc.reason!r}"
            if attempt < SPEC_LLM_MAX_RETRIES:
                continue
            break
        except json.JSONDecodeError as exc:
            last_err = f"Invalid JSON from model: {exc}"
            break
    raise ValueError(last_err or "Manufacturing brief request failed.")


_SYSTEM = (
    "You advise on taking ideas to production. The user has a structured product spec and company context "
    "from an earlier pipeline (often including a 3D mesh for review in a desktop web GLB viewer). "
    "First classify the offering, then fill every field in a way that matches that classification.\n\n"
    "Classification — set plan_focus to exactly one of: physical_product, virtual_service, hybrid.\n"
    "- physical_product: the core value is a shippable good (CPG, hardware, packaging-as-product, etc.).\n"
    "- virtual_service: the core value is software, a subscription, a marketplace, content, consulting, or "
    "another primarily digital deliverable; any 3D asset is collateral (hero prop, device mockup, brand token) "
    "for marketing and stakeholder preview in the browser, not factory tooling.\n"
    "- hybrid: meaningful physical and digital components (e.g. connected device + app, kit + portal).\n\n"
    "Bias toward physical_product whenever the user is clearly describing a tangible SKU, packaging, device, "
    "fixture, or other manufactured good—even if they use everyday words like 'platform' (retail/display), "
    "'subscription' (replenishment or box), 'marketplace' (where it is sold), 'dashboard' (copy), or 'API' "
    "(integrations). Use virtual_service only when the primary thing they want to build and monetize is "
    "clearly digital: software, SaaS, a web/mobile application, a digital marketplace as the product, etc. "
    "If you are unsure, choose physical_product.\n\n"
    "When plan_focus is physical_product: propose manufacturing, BOM-style breakdown, rough cost bands, "
    "and practical steps to contact factories. supplier_playbook entries are supplier-facing venues.\n\n"
    "When plan_focus is virtual_service or hybrid: still use the SAME keys (same JSON shape), but reinterpret:\n"
    "- process_summary: tie cost and delivery to how the team should build software, ship releases, run GTM, "
    "and reach production-ready operations (security, observability, support). For virtual_service, state clearly "
    "that the 3D preview on a desktop browser is the right place to review the hero asset alongside the written spec.\n"
    "- recommended_processes: milestone-style steps (discovery, MVP, beta, launch, scale) with realistic week bands.\n"
    "- bill_of_materials: rows are capabilities or systems (e.g. auth, billing, data model, admin, integrations, "
    "compliance, content pipeline) — not physical parts unless hybrid.\n"
    "- cost_snapshot: tooling_usd_band ≈ one-time platform/engineering/design/legal setup; unit_cost_usd_band ≈ "
    "marginal cloud, third-party APIs, payment fees, or support per account/transaction as appropriate; "
    "moq_comment ≈ pilot cohort size, design-partner count, or initial release scope.\n"
    "- supplier_playbook: for virtual_service use channels and partners (ads, communities, integrations marketplaces, "
    "resellers, hiring); for hybrid blend digital channels with contract manufacturers where relevant.\n"
    "- visual_cues: for virtual_service include reviewing the GLB in a desktop browser and engineering handoff items "
    "(API contracts, analytics events, runbooks); for physical_product keep factory-prep photography and measurements.\n\n"
    "Respect the company's positioning, constraints, and internal documents. Never present fantasy precision: use "
    "ranges, qualifiers, and a disclaimer that figures are indicative until quoted or scoped by vendors/contractors.\n"
    "Return a single JSON object with exactly these keys:\n"
    "plan_focus (string, one of: physical_product, virtual_service, hybrid),\n"
    "headline (string, under 120 chars),\n"
    "process_summary (string, 2-5 sentences),\n"
    "recommended_processes (array of objects with keys name, rationale, typical_lead_time_weeks),\n"
    "bill_of_materials (array of objects with keys component, function, material_or_process, sourcing_notes),\n"
    "cost_snapshot (object with keys tooling_usd_band, unit_cost_usd_band, moq_comment, disclaimer),\n"
    "risks (array of short strings),\n"
    "supplier_playbook (array of objects with keys venue, geography, how_to_reach, checklist),\n"
    "visual_cues (array of 2-4 short strings).\n"
    "All string values must be plain text (no markdown)."
)


def _stub_plan_focus_from_prompt(prompt: str) -> str:
    """Conservative keyword hint when the LLM stub path runs without OpenAI.

    Prefer physical_product unless the prompt explicitly reads like a software/app/SaaS offering.
    Broad business words alone (platform, subscription, marketplace, dashboard, …) are not enough.
    """
    p = (prompt or "").lower()
    strong_digital_phrases = (
        "saas",
        "software as a service",
        "software-only",
        "software only",
        "b2b software",
        "web application",
        "web app",
        "webapp",
        "mobile application",
        "mobile app",
        "iphone app",
        "android app",
        "ios app",
        "desktop application",
        "desktop app",
        "progressive web app",
    )
    strong_digital = any(s in p for s in strong_digital_phrases) or bool(
        re.search(r"\bsoftware\b", p)
    )
    physical = any(
        w in p
        for w in (
            "packaging",
            "bottle",
            " tin",
            "tin ",
            " jar",
            "box ",
            "carton",
            "clamshell",
            "device",
            "hardware",
            "tool",
            "furniture",
            "wearable",
            "printed",
            "manufactur",
            "factory",
            "mold",
            "injection",
            "mesh",
            "glb",
            "stl",
            "prototype",
            "sku",
            "cpg",
        )
    )
    if strong_digital and physical:
        return "hybrid"
    if strong_digital:
        return "virtual_service"
    return "physical_product"


def _brief_from_documents(
    job: dict[str, Any],
    company_context: str,
    *,
    stub_cause: str = "missing_key",
    llm_error_detail: str | None = None,
) -> dict[str, Any]:
    spec = job.get("spec") or {}
    name = str(spec.get("product_name") or "Product").strip() or "Product"
    company = (job.get("company") or "").strip() or "your company"
    prompt = (job.get("prompt") or "").strip()[:800]
    plan_focus = _stub_plan_focus_from_prompt(prompt)
    mats = spec.get("materials") or {}
    dims = spec.get("dimensions") or {}
    headline = (
        f"Indicative software and GTM path for {name}"
        if plan_focus == "virtual_service"
        else f"Indicative production path for {name}"
    )
    if plan_focus == "hybrid":
        headline = f"Indicative hybrid build path for {name}"

    idea_snip = f"{prompt[:400]}{'…' if len(prompt) > 400 else ''}"
    if stub_cause == "llm_error":
        detail = (llm_error_detail or "").strip() or "See API server logs for the full error."
        stub_summary = (
            f"The API server could not complete the manufacturing brief for {company}. "
            f"Idea snapshot: {idea_snip} "
            f"Technical detail: {detail} "
            "Fix OPENAI_BASE_URL, OPENAI_MODEL, timeouts, or network access to the provider, then use Regenerate overview."
        )
    else:
        stub_summary = (
            f"Without a live LLM, this is a placeholder overview for {company}. "
            f"The idea centers on: {idea_snip} "
            "Set OPENAI_API_KEY on the API server process (repo-root .env for local dev, or env_file in Docker) and restart the server."
        )
    if plan_focus == "virtual_service":
        stub_summary += (
            " For digital offerings, use the in-browser GLB on a desktop to review the hero 3D asset alongside "
            "this plan; figures below are software/GTM oriented placeholders."
        )
    elif plan_focus == "hybrid":
        stub_summary += (
            " Hybrid ideas need parallel software release planning and physical DFM; this stub is generic until "
            "the live model runs."
        )

    if plan_focus == "virtual_service":
        rec_proc = [
            {
                "name": "Product and architecture discovery",
                "rationale": "Define users, workflows, integrations, compliance triggers, and MVP scope.",
                "typical_lead_time_weeks": "2–4",
            },
            {
                "name": "MVP build and private beta",
                "rationale": "Ship core flows behind feature flags; instrument product analytics.",
                "typical_lead_time_weeks": "6–14",
            },
        ]
        bom = [
            {
                "component": "Identity and access",
                "function": "Accounts, roles, sessions",
                "material_or_process": "Auth provider or self-hosted OIDC",
                "sourcing_notes": "Decide SSO, SCIM, and audit requirements early.",
            },
            {
                "component": "Core product surface",
                "function": "Primary user journeys",
                "material_or_process": "Web app and/or API",
                "sourcing_notes": "Contract API shapes before partner integrations.",
            },
        ]
        cost_snap = {
            "tooling_usd_band": "Initial build: design systems, eng hire or agency SOW — scope-dependent",
            "unit_cost_usd_band": "Infra + paid APIs + support — often tens to low hundreds USD per active account/month at small scale",
            "moq_comment": "Pilot with a small design-partner cohort before open signup.",
            "disclaimer": "Illustrative only; replace with quotes from contractors and cloud calculators.",
        }
        risks = [
            "Underspecified compliance (privacy, payments, industry rules) can block launch.",
            "Hero 3D is marketing collateral; production readiness is defined by code, ops, and support.",
        ]
        supplier_pb = [
            {
                "venue": "Product communities and founder networks",
                "geography": "Match your ICP geography for language and support hours",
                "how_to_reach": "Ship a narrow beta; collect structured feedback and retention signals",
                "checklist": "Positioning one-pager, pricing hypothesis, onboarding metrics",
            },
            {
                "venue": "Integration and distribution partners",
                "geography": "Where your users already work (e.g. CRM, calendars, app stores)",
                "how_to_reach": "Partner programs, marketplace listings, co-marketing",
                "checklist": "SDK docs, sandbox, support SLAs, rev-share model",
            },
        ]
        visual = [
            "Review the exported GLB in the desktop web viewer for silhouette and brand read.",
            "Write a short engineering handoff: core entities, SLIs/SLOs, and on-call expectations.",
        ]
    else:
        rec_proc = [
            {
                "name": "Design-for-manufacture review",
                "rationale": "Lock tolerances, draft angles, and material grades before tooling quotes.",
                "typical_lead_time_weeks": "1–3",
            },
            {
                "name": "Prototype → pilot run",
                "rationale": "Validate assembly and packaging with a small MOQ before scaling.",
                "typical_lead_time_weeks": "4–10",
            },
        ]
        bom = [
            {
                "component": "Primary body",
                "function": "Main structure / packaging",
                "material_or_process": str(mats.get("body") or "TBD — confirm with material datasheet"),
                "sourcing_notes": "Request UL/FDA or category certs if applicable.",
            },
            {
                "component": "Closure / secondary",
                "function": "Lid, cap, or interface",
                "material_or_process": str(mats.get("lid") or "TBD"),
                "sourcing_notes": "Match stack height to spec before artwork finalization.",
            },
        ]
        cost_snap = {
            "tooling_usd_band": "Set after DFM — often low thousands to mid five figures for packaging molds",
            "unit_cost_usd_band": "Highly volume-dependent — request tiered quotes at 1k / 5k / 25k",
            "moq_comment": "Start with the lowest MOQ that still hits your target unit cost.",
            "disclaimer": "Illustrative only; not a quote. Add freight, duties, QC, and rework buffers.",
        }
        risks = [
            "Spec fields left as TBD will swing quotes dramatically.",
            "Export lead times for decorated packaging can dominate the critical path.",
        ]
        supplier_pb = [
            {
                "venue": "Category-specific trade shows & pavilion directories",
                "geography": "Match your target retail or compliance region",
                "how_to_reach": "Book short meetings; bring 1-page PDF with dimensions and MOQ ask",
                "checklist": "NDA, reference samples, color standard (Pantone), and defect classification",
            },
            {
                "venue": "Verified B2B manufacturing marketplaces",
                "geography": "Shortlist factories already shipping to your destination market",
                "how_to_reach": "Structured RFQ with STEP/STL + finish callouts + photos",
                "checklist": "Audit trail, golden sample agreement, and payment milestones",
            },
        ]
        visual = [
            f"Capture overall L×W×H vs spec ({dims.get('length_mm', '?')}×{dims.get('width_mm', '?')}×{dims.get('height_mm', '?')} mm).",
            "Flat lay of every separable part for a BOM-style supplier email.",
        ]
        if plan_focus == "hybrid":
            risks = risks + [
                "Parallel hardware and software roadmaps can desync; align milestone demos.",
            ]
            visual.append(
                "If you ship firmware or an app with the object, version them together for recalls and support."
            )

    return {
        "plan_focus": plan_focus,
        "headline": headline,
        "process_summary": stub_summary,
        "recommended_processes": rec_proc,
        "bill_of_materials": bom,
        "cost_snapshot": cost_snap,
        "risks": risks,
        "supplier_playbook": supplier_pb,
        "visual_cues": visual,
        "company_context_used": bool(company_context.strip()),
    }


def build_manufacturing_plan(
    job: dict[str, Any],
    *,
    company_context: str = "",
) -> dict[str, Any]:
    """Return a JSON-serializable manufacturing plan dict (also suitable to persist on the job)."""
    spec_blob = json.dumps(job.get("spec") or {}, indent=2, default=str)[:12000]
    digest = (job.get("research_digest") or "").strip()[:4000]
    brief = job.get("research_brief") or {}
    brief_txt = ""
    if isinstance(brief, dict):
        parts = [f"{k}: {v}" for k, v in brief.items() if str(v).strip()]
        brief_txt = "\n".join(parts)[:6000]
    docs = job.get("documents") or []
    doc_excerpt = "\n---\n".join(str(d).strip() for d in docs if str(d).strip())[:8000]
    extra = (company_context or "").strip()[:12000]

    user_block = (
        f"Company name: {job.get('company') or '(not set)'}\n\n"
        f"Product idea (user prompt):\n{(job.get('prompt') or '').strip()[:2000]}\n\n"
        f"Optional company workspace context (may duplicate documents):\n{extra or '(none)'}\n\n"
        f"Research digest:\n{digest or '(none)'}\n\n"
        f"Structured research brief:\n{brief_txt or '(none)'}\n\n"
        f"Internal document excerpts:\n{doc_excerpt or '(none)'}\n\n"
        f"Structured product spec (JSON):\n{spec_blob}\n"
    )

    if not OPENAI_API_KEY:
        plan = _brief_from_documents(job, extra, stub_cause="missing_key")
        plan["stub"] = True
        plan["stub_reason"] = "missing_openai_key"
        return plan

    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user_block},
    ]
    try:
        parsed = _post_json_object(messages)
        if not isinstance(parsed, dict):
            raise ValueError("Model returned non-object JSON.")
        parsed["stub"] = False
        focus = str(parsed.get("plan_focus") or "").strip().lower()
        if focus not in ("physical_product", "virtual_service", "hybrid"):
            parsed["plan_focus"] = _stub_plan_focus_from_prompt(str(job.get("prompt") or ""))
        return parsed
    except Exception as exc:
        logger.warning("manufacturing_brief_failed err=%s", exc)
        plan = _brief_from_documents(
            job,
            extra,
            stub_cause="llm_error",
            llm_error_detail=str(exc)[:240],
        )
        plan["stub"] = True
        plan["stub_reason"] = "llm_error"
        plan["stub_detail"] = str(exc)[:240]
        return plan
