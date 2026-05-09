from __future__ import annotations

import json
import re
from urllib import error, request

from app.config import (
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENAI_MODEL,
    SPEC_LLM_MAX_RETRIES,
    SPEC_LLM_TIMEOUT_SECONDS,
    SPEC_PARSER_MODE,
)
from app.schemas.spec import BrandContext, ConceptContext, Dimensions, Engraving, ProductSpec, Shape


def parse_prompt_to_spec(prompt: str, context: dict | None = None) -> ProductSpec:
    if SPEC_PARSER_MODE in ("auto", "llm"):
        spec, llm_error = _parse_with_llm(prompt, context=context)
        if spec is not None:
            return spec
        if SPEC_PARSER_MODE == "llm":
            raise ValueError(
                "LLM parser mode is enabled but LLM spec extraction failed."
                + (f" Last error: {llm_error}" if llm_error else "")
            )

    spec = _parse_with_rules(prompt, context=context)
    if SPEC_PARSER_MODE == "rule":
        spec.warnings.append("spec_parser_used_rule")
    else:
        spec.warnings.append("spec_parser_used_rule_fallback")
        if llm_error:
            # Keep this short and avoid leaking sensitive data. It's only for debugging provider issues.
            sanitized = llm_error.splitlines()[0][:180]
            spec.warnings.append(f"spec_parser_llm_failed: {sanitized}")
    return spec


def _parse_with_rules(prompt: str, context: dict | None = None) -> ProductSpec:
    text = prompt.lower()
    warnings: list[str] = []
    features: list[str] = []
    engraving: Engraving | None = None
    company = None
    documents: list[str] = []
    if context:
        company = context.get("company")
        documents = context.get("documents") or []

    if "tin" in text or "gum" in text or "mint" in text:
        object_type = "tin"
        dims = Dimensions(length_mm=95, width_mm=55, height_mm=18)
        shape = Shape(corner_radius_mm=8, lid_type="hinged")
        product_name = "Generated Tin"
    elif "bottle" in text or "drink" in text or "cap" in text:
        object_type = "bottle"
        dims = Dimensions(length_mm=72, width_mm=72, height_mm=220)
        shape = Shape(base="cylindrical_bottle", corner_radius_mm=2, lid_type="lift_off")
        product_name = "Generated Bottle"
    elif "tray" in text or "compartment" in text or "lunchbox" in text:
        object_type = "tray"
        dims = Dimensions(length_mm=220, width_mm=160, height_mm=45)
        shape = Shape(corner_radius_mm=8, lid_type="lift_off")
        product_name = "Generated Tray"
        if "three" in text or "3" in text:
            features.append("three_compartments")
    elif "box" in text or "packaging" in text or "container" in text:
        object_type = "box"
        dims = Dimensions(length_mm=120, width_mm=80, height_mm=40)
        shape = Shape(corner_radius_mm=4, lid_type="lift_off")
        product_name = "Generated Box"
    elif "spoon" in text:
        object_type = "spoon"
        # Dimensions for spoon are interpreted as:
        # length_mm = overall length, width_mm = bowl width, height_mm = thickness.
        dims = Dimensions(length_mm=170, width_mm=40, height_mm=4)
        shape = Shape(base="spoon", corner_radius_mm=2, lid_type="lift_off")
        product_name = "Generated Spoon"
        # Very lightweight heuristic for “engraved name Jack”.
        name_match = re.search(r"(?:engraved|engrave|inscribed)\s+(?:name\s+)?([a-z0-9 _-]{1,40})", text, re.IGNORECASE)
        if name_match:
            raw = name_match.group(1).strip()
            if raw:
                engraving = Engraving(text=raw[:40])
    else:
        object_type = "tin"
        dims = Dimensions(length_mm=90, width_mm=60, height_mm=20)
        shape = Shape(corner_radius_mm=6, lid_type="hinged")
        product_name = "Generated Object"
        warnings.append("prompt_was_ambiguous_defaulted_to_tin")

    if "round" in text:
        shape.corner_radius_mm = max(shape.corner_radius_mm, 10)
    if "small" in text:
        dims.length_mm = max(10, dims.length_mm - 10)
        dims.width_mm = max(10, dims.width_mm - 10)
    if "large" in text or "big" in text:
        dims.length_mm = min(6000, dims.length_mm + 20)
        dims.width_mm = min(6000, dims.width_mm + 20)

    spec = ProductSpec(
        object_type=object_type,
        product_name=product_name,
        dimensions=dims,
        shape=shape,
        features=features,
        engraving=engraving,
        brand=BrandContext(company=company, brand_keywords=[], tone=None),
        concept=ConceptContext(idea_summary=prompt[:800], stakeholder_pitch=None, constraints=[]),
    )
    spec.warnings.extend(warnings)
    if documents:
        spec.warnings.append(f"context_documents_attached:{len(documents)}")
    return spec


_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)


def _extract_json_object(text: str) -> dict:
    """
    Best-effort JSON object extraction for OpenAI-compatible providers that may wrap JSON
    in code fences or include extra text.
    """
    candidate = text.strip()

    fence = _JSON_FENCE_RE.search(candidate)
    if fence:
        candidate = fence.group(1).strip()

    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    # Fallback: take the largest {...} span
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start != -1 and end != -1 and end > start:
        parsed = json.loads(candidate[start : end + 1])
        if isinstance(parsed, dict):
            return parsed

    raise ValueError("Model did not return a JSON object.")


def _parse_with_llm(prompt: str, context: dict | None = None) -> tuple[ProductSpec | None, str | None]:
    if not OPENAI_API_KEY:
        return None, "OPENAI_API_KEY is not set"

    company = None
    documents: list[str] = []
    if context:
        company = context.get("company")
        documents = context.get("documents") or []

    doc_blob = ""
    if documents:
        # Keep bounded; this is MVP context injection, not full RAG.
        joined = "\n\n---\n\n".join(documents)
        doc_blob = joined[:8000]

    canonical_prompt = (
        "Return JSON only. Build a spec for a simple physical object prototype that stakeholders can review. "
        "Allowed object_type values: tin, box, bottle, tray, spoon. "
        "Schema: {object_type, product_name, dimensions{length_mm,width_mm,height_mm}, "
        "shape{base,corner_radius_mm,lid_type}, features, engraving, brand, concept, domain_kit, components}. "
        "domain_kit must be one of: cpg_packaging, food_beverage, retail_display, subscription_unboxing, "
        "consumer_electronics, medical_device, wellness_personal_care, industrial_tooling, home_appliance, automotive_accessory. "
        "brand schema: {company, brand_keywords, tone}. "
        "concept schema: {idea_summary, stakeholder_pitch, constraints}. "
        "components is an optional array of physical add-ons. Supported component types: "
        "nameplate {type:'nameplate', text, thickness_mm, font_size_mm, location:'lid_top'|'front_face'} and "
        "wrap_label {type:'wrap_label', height_mm, thickness_mm, location:'body_sides'|'bottle_body'}, "
        "window_cutout {type:'window_cutout', size_x_mm, size_y_mm, corner_radius_mm, location:'lid_top'|'front_face'}, "
        "insert_tray {type:'insert_tray', thickness_mm, clearance_mm, compartments}, "
        "hanger_hole {type:'hanger_hole', width_mm, height_mm, corner_radius_mm, location:'front_face'}, "
        "hole_pattern {type:'hole_pattern', diameter_mm, rows, cols, spacing_mm, location:'front_face'}, "
        "tamper_band {type:'tamper_band', height_mm, thickness_mm, location:'bottle_neck'}, "
        "button_boss {type:'button_boss', diameter_mm, height_mm, count, spacing_mm, location:'front_face'}, "
        "screen_window {type:'screen_window', size_x_mm, size_y_mm, corner_radius_mm, bezel_mm, location:'front_face'}, "
        "carry_handle {type:'carry_handle', width_mm, depth_mm, thickness_mm, location:'top'}. "
        "For spoon: dimensions are {length_mm: overall length, width_mm: bowl width, height_mm: thickness}. "
        "Engraving (optional) schema: {text, depth_mm, font_size_mm, location}. "
        "Engraving location must be handle_top_center. "
        "lid_type must be hinged or lift_off. "
        "All dimensions are millimeters: length/width at least 10, height at least 1; each axis at most 6000."
    )
    base = (OPENAI_BASE_URL or "https://api.openai.com").rstrip("/")
    # Support either ".../v1" or just the host.
    if base.endswith("/v1"):
        url = f"{base}/chat/completions"
    else:
        url = f"{base}/v1/chat/completions"

    last_error: str | None = None
    for _ in range(SPEC_LLM_MAX_RETRIES + 1):
        try:
            # Some OpenAI-compatible providers don't support `response_format`;
            # try with it first, then retry once without it.
            payload = {
                "model": OPENAI_MODEL,
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": canonical_prompt},
                    {
                        "role": "user",
                        "content": (
                            (f"Company: {company}\n\n" if company else "")
                            + (f"Supporting docs (excerpts):\n{doc_blob}\n\n" if doc_blob else "")
                            + f"Idea: {prompt}"
                        ),
                    },
                ],
            }
            for attempt in range(2):
                if attempt == 1:
                    payload.pop("response_format", None)

                req = request.Request(
                    url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {OPENAI_API_KEY}",
                    },
                    method="POST",
                )

                with request.urlopen(req, timeout=SPEC_LLM_TIMEOUT_SECONDS) as response:
                    body = json.loads(response.read().decode("utf-8"))
                content = body["choices"][0]["message"]["content"]
                parsed = _extract_json_object(content)
                normalized = _normalize_llm_payload(parsed)
                spec = ProductSpec.model_validate(normalized)
                spec.warnings.append("spec_parser_used_llm")
                return spec, None
        except error.HTTPError as exc:
            try:
                detail = exc.read().decode("utf-8", errors="replace")
            except Exception:
                detail = str(exc)
            last_error = f"HTTP {getattr(exc, 'code', '?')}: {detail}"
            continue
        except error.URLError as exc:
            last_error = f"URL error: {exc}"
            continue
        except (KeyError, json.JSONDecodeError, ValueError) as exc:
            last_error = str(exc)
            continue
    return None, last_error


def _normalize_llm_payload(payload: dict) -> dict:
    object_type = str(payload.get("object_type", "tin")).lower().strip()
    if object_type not in {"tin", "box", "bottle", "tray", "spoon"}:
        aliases = {
            "container": "box",
            "package": "box",
            "packaging": "box",
            "gum_tin": "tin",
            "mint_tin": "tin",
            "water_bottle": "bottle",
            "drink_bottle": "bottle",
            "storage_tray": "tray",
            "food_tray": "tray",
            "cutlery": "spoon",
            "utensil": "spoon",
        }
        object_type = aliases.get(object_type, "tin")

    shape = payload.get("shape", {})
    lid_type = str(shape.get("lid_type", "hinged")).lower().strip()
    if lid_type not in {"hinged", "lift_off"}:
        lid_type = "hinged"

    dimensions = payload.get("dimensions", {})
    length = float(dimensions.get("length_mm", 95))
    width = float(dimensions.get("width_mm", 55))
    height = float(dimensions.get("height_mm", 20))

    features = payload.get("features", [])
    if isinstance(features, str):
        features = [s.strip() for s in features.split(",") if s.strip()]
    if not isinstance(features, list):
        features = []

    engraving = payload.get("engraving")
    if not isinstance(engraving, dict):
        engraving = None

    brand = payload.get("brand")
    if not isinstance(brand, dict):
        brand = {}
    concept = payload.get("concept")
    domain_kit = str(payload.get("domain_kit", "cpg_packaging")).strip()
    if domain_kit not in {
        "cpg_packaging",
        "food_beverage",
        "retail_display",
        "subscription_unboxing",
        "consumer_electronics",
        "medical_device",
        "wellness_personal_care",
        "industrial_tooling",
        "home_appliance",
        "automotive_accessory",
    }:
        domain_kit = "cpg_packaging"
    if not isinstance(concept, dict):
        concept = {}

    components = payload.get("components", [])
    if not isinstance(components, list):
        components = []

    normalized_components: list[dict] = []
    for comp in components[:8]:
        if not isinstance(comp, dict):
            continue
        ctype = str(comp.get("type", "")).strip()
        if ctype == "nameplate":
            normalized_components.append(
                {
                    "type": "nameplate",
                    "text": (str(comp.get("text")).strip()[:40] if comp.get("text") is not None else None),
                    "thickness_mm": float(comp.get("thickness_mm", 0.6)),
                    "font_size_mm": float(comp.get("font_size_mm", 8.0)),
                    "location": "lid_top" if str(comp.get("location", "lid_top")) not in {"front_face"} else "front_face",
                }
            )
        if ctype == "wrap_label":
            loc = str(comp.get("location", "body_sides"))
            normalized_components.append(
                {
                    "type": "wrap_label",
                    "height_mm": float(comp.get("height_mm", 22.0)),
                    "thickness_mm": float(comp.get("thickness_mm", 0.4)),
                    "location": "bottle_body" if loc == "bottle_body" else "body_sides",
                }
            )
        if ctype == "window_cutout":
            normalized_components.append(
                {
                    "type": "window_cutout",
                    "size_x_mm": float(comp.get("size_x_mm", 42.0)),
                    "size_y_mm": float(comp.get("size_y_mm", 28.0)),
                    "corner_radius_mm": float(comp.get("corner_radius_mm", 3.0)),
                    "location": "front_face" if str(comp.get("location", "lid_top")) == "front_face" else "lid_top",
                }
            )
        if ctype == "insert_tray":
            normalized_components.append(
                {
                    "type": "insert_tray",
                    "thickness_mm": float(comp.get("thickness_mm", 1.2)),
                    "clearance_mm": float(comp.get("clearance_mm", 0.8)),
                    "compartments": int(comp.get("compartments", 1)),
                }
            )
        if ctype == "hanger_hole":
            normalized_components.append(
                {
                    "type": "hanger_hole",
                    "width_mm": float(comp.get("width_mm", 32.0)),
                    "height_mm": float(comp.get("height_mm", 8.0)),
                    "corner_radius_mm": float(comp.get("corner_radius_mm", 3.0)),
                    "location": "front_face",
                }
            )
        if ctype == "hole_pattern":
            normalized_components.append(
                {
                    "type": "hole_pattern",
                    "diameter_mm": float(comp.get("diameter_mm", 3.0)),
                    "rows": int(comp.get("rows", 2)),
                    "cols": int(comp.get("cols", 4)),
                    "spacing_mm": float(comp.get("spacing_mm", 8.0)),
                    "location": "front_face",
                }
            )
        if ctype == "tamper_band":
            normalized_components.append(
                {
                    "type": "tamper_band",
                    "height_mm": float(comp.get("height_mm", 10.0)),
                    "thickness_mm": float(comp.get("thickness_mm", 1.0)),
                    "location": "bottle_neck",
                }
            )
        if ctype == "button_boss":
            normalized_components.append(
                {
                    "type": "button_boss",
                    "diameter_mm": float(comp.get("diameter_mm", 10.0)),
                    "height_mm": float(comp.get("height_mm", 2.0)),
                    "count": int(comp.get("count", 1)),
                    "spacing_mm": float(comp.get("spacing_mm", 14.0)),
                    "location": "front_face",
                }
            )
        if ctype == "screen_window":
            normalized_components.append(
                {
                    "type": "screen_window",
                    "size_x_mm": float(comp.get("size_x_mm", 52.0)),
                    "size_y_mm": float(comp.get("size_y_mm", 32.0)),
                    "corner_radius_mm": float(comp.get("corner_radius_mm", 4.0)),
                    "bezel_mm": float(comp.get("bezel_mm", 3.0)),
                    "location": "front_face",
                }
            )
        if ctype == "carry_handle":
            normalized_components.append(
                {
                    "type": "carry_handle",
                    "width_mm": float(comp.get("width_mm", 90.0)),
                    "depth_mm": float(comp.get("depth_mm", 18.0)),
                    "thickness_mm": float(comp.get("thickness_mm", 6.0)),
                    "location": "top",
                }
            )

    normalized = {
        "object_type": object_type,
        "product_name": payload.get("product_name", "Generated Object"),
        "dimensions": {
            "length_mm": length,
            "width_mm": width,
            "height_mm": height,
        },
        "shape": {
            "base": (
                "spoon"
                if object_type == "spoon"
                else ("cylindrical_bottle" if object_type == "bottle" else "rounded_rectangular_box")
            ),
            "corner_radius_mm": float(shape.get("corner_radius_mm", 6)),
            "lid_type": lid_type,
        },
        "features": features,
        "brand": {
            "company": (str(brand.get("company")).strip()[:120] if brand.get("company") is not None else None),
            "brand_keywords": brand.get("brand_keywords", []) if isinstance(brand.get("brand_keywords", []), list) else [],
            "tone": (str(brand.get("tone")).strip()[:120] if brand.get("tone") is not None else None),
        },
        "concept": {
            "idea_summary": (str(concept.get("idea_summary")).strip()[:800] if concept.get("idea_summary") is not None else None),
            "stakeholder_pitch": (
                str(concept.get("stakeholder_pitch")).strip()[:800] if concept.get("stakeholder_pitch") is not None else None
            ),
            "constraints": concept.get("constraints", []) if isinstance(concept.get("constraints", []), list) else [],
        },
        "domain_kit": domain_kit,
        "components": normalized_components,
    }

    if engraving is not None:
        normalized["engraving"] = {
            "text": str(engraving.get("text", "")).strip()[:40],
            "depth_mm": float(engraving.get("depth_mm", 0.6)),
            "font_size_mm": float(engraving.get("font_size_mm", 6.0)),
            "location": "handle_top_center",
        }
    return normalized
