"""Stub product spec for persistence only.

Concept reference images are driven solely by the user's prompt, optional company,
and context document sections (see ``reference_images.generate_reference_images``).
This module no longer infers geometry or categories from prompts.
"""

from __future__ import annotations

from app.schemas.spec import BrandContext, ConceptContext, Dimensions, ProductSpec, Shape


def _product_label_from_prompt(prompt: str, *, max_len: int = 100) -> str:
    line = (prompt or "").strip().split("\n", 1)[0].strip()
    if not line:
        return "Concept"
    if len(line) > max_len:
        return line[: max_len - 1].rstrip() + "…"
    return line


def parse_prompt_to_spec(prompt: str, context: dict | None = None) -> ProductSpec:
    """
    Build a minimal ``ProductSpec`` for ``spec.json`` and job payloads only.

    Values are placeholders so the rest of the pipeline (storage, Meshy continuation)
    keeps a valid schema; they are not injected into image prompts.
    """
    company = None
    documents: list[str] = []
    if context:
        company = context.get("company")
        documents = context.get("documents") or []

    label = _product_label_from_prompt(prompt)
    warnings = ["stub_spec_placeholder_no_structured_parse"]
    if documents:
        warnings.append(f"context_documents_attached:{len(documents)}")

    return ProductSpec(
        object_type="tin",
        product_name=label,
        dimensions=Dimensions(length_mm=100, width_mm=80, height_mm=40),
        shape=Shape(corner_radius_mm=4, lid_type="lift_off"),
        features=[],
        brand=BrandContext(company=company, brand_keywords=[], tone=None),
        concept=ConceptContext(
            idea_summary=(prompt or "")[:800] or None,
            stakeholder_pitch=None,
            constraints=[],
        ),
        warnings=warnings,
    )
