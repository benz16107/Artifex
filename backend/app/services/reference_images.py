from __future__ import annotations

import base64
import errno
import json
import logging
import time
from collections.abc import Callable
from pathlib import Path
from urllib import error, request

from app.config import (
    CONCEPT_IMAGE_HTTP_RETRIES,
    CONCEPT_IMAGE_HTTP_TIMEOUT_SECONDS,
    IMAGE_OPENAI_API_KEY,
    IMAGE_OPENAI_BASE_URL,
    IMAGE_OPENAI_EDIT_MODEL,
    IMAGE_OPENAI_MODEL,
    OPENAI_BASE_URL,
)
logger = logging.getLogger("object-first-mvp")


class ReferenceImageAPIError(Exception):
    """OpenAI image HTTP/network failures (distinct from invalid user spec)."""


def _dalle_model_requests_response_format(model: str) -> bool:
    """DALL-E 2/3 support response_format; GPT image models (gpt-image-*) reject it."""
    m = (model or "").strip().lower()
    return m.startswith("dall-e-2") or m.startswith("dall-e-3")


def _model_supports_reference_image_edits(model: str) -> bool:
    """Models that accept `images` + prompt on POST /v1/images/edits (see OpenAI image API)."""
    m = (model or "").strip().lower()
    if not m or m.startswith("dall-e"):
        return False
    return m.startswith("gpt-image") or m.startswith("chatgpt-image")


def _edit_model_accepts_high_input_fidelity(model: str) -> bool:
    """gpt-image-1-mini rejects input_fidelity=high (invalid_input_fidelity_model)."""
    m = (model or "").strip().lower()
    if not m or "mini" in m:
        return False
    return m.startswith("gpt-image") or m.startswith("chatgpt-image")


def _three_quarter_edit_model(primary_model: str) -> str | None:
    """Model used for image-conditioned three-quarter; None falls back to a second text generation."""
    primary = (primary_model or "").strip()
    if _model_supports_reference_image_edits(primary):
        return primary
    alt = (IMAGE_OPENAI_EDIT_MODEL or "").strip()
    if alt and _model_supports_reference_image_edits(alt):
        return alt
    return None


def _png_data_url(image_bytes: bytes) -> str:
    b64 = base64.standard_b64encode(image_bytes).decode("ascii")
    return f"data:image/png;base64,{b64}"


_THREE_QUARTER_CAMERA_DIRECTIVE = (
    "The input image is the canonical straight-on front view of one physical product and is the "
    "primary visual reference for geometry, proportions, silhouette, materials, colors, labels, "
    "logos, and surface finish. Produce a new studio photograph of the exact same object from a "
    "three-quarter angle (front-right), with a modest downward tilt, centered, neutral soft-gray "
    "or white backdrop. Do not redesign, replace, or approximate a similar item—only rotate the "
    "camera. No people, hands, or new text overlays. "
    "However, the user's written product description and brand/context blocks above are authoritative: "
    "if any details they describe (e.g. side/top/back features, vents, ports, hinges, seams, "
    "graphics, materials, or color regions) are not visible or are ambiguous in the front "
    "reference image, faithfully render them in the three-quarter view in a way that is fully "
    "consistent with the front image's shape, scale, and finish. Treat the front image as the "
    "ground truth for what is shown, and the written description and context as the ground truth "
    "for what exists on the object as a whole."
)


def _three_quarter_edit_prompt(shared_context: str) -> str:
    return f"{shared_context} {_THREE_QUARTER_CAMERA_DIRECTIVE}"


def _image_bytes_from_response_item(
    item: dict,
    *,
    http_timeout: int,
    max_retries: int,
) -> bytes:
    b64 = item.get("b64_json")
    if b64:
        return base64.b64decode(b64)
    img_url = item.get("url")
    if not img_url:
        raise ReferenceImageAPIError(
            "Image API returned no b64_json or url in data[0]. "
            "Check IMAGE_OPENAI_MODEL and API response shape."
        )
    attempts = max(1, 1 + max(0, max_retries))
    backoff_s = 2.0
    for attempt in range(attempts):
        try:
            img_req = request.Request(img_url, method="GET")
            with request.urlopen(img_req, timeout=http_timeout) as response:
                return response.read()
        except error.URLError as exc:
            if attempt < attempts - 1 and _retryable_url_error(exc):
                logger.warning(
                    "reference_image_url_fetch_retry attempt=%s/%s reason=%r",
                    attempt + 1,
                    attempts,
                    exc.reason,
                )
                time.sleep(backoff_s)
                backoff_s = min(backoff_s * 2.0, 60.0)
                continue
            raise


def _retryable_url_error(exc: error.URLError) -> bool:
    r = exc.reason
    if isinstance(r, TimeoutError):
        return True
    if isinstance(r, (BrokenPipeError, ConnectionResetError)):
        return True
    if isinstance(r, OSError) and getattr(r, "errno", None) in {
        errno.ETIMEDOUT,
        errno.ECONNRESET,
        errno.EPIPE,
        errno.ENETUNREACH,
        errno.EHOSTUNREACH,
        errno.ECONNABORTED,
    }:
        return True
    return False


def _post_openai_images_json(
    *,
    url: str,
    payload: dict,
    http_timeout: int,
    view_name: str,
    max_retries: int,
) -> dict:
    """
    POST JSON to /v1/images/generations or /v1/images/edits with retries.
    """
    body = json.dumps(payload).encode("utf-8")
    attempts = max(1, 1 + max(0, max_retries))
    backoff_s = 2.0
    for attempt in range(attempts):
        try:
            req = request.Request(
                url,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {IMAGE_OPENAI_API_KEY}",
                },
                method="POST",
            )
            with request.urlopen(req, timeout=http_timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            code = getattr(exc, "code", 0) or 0
            if code in (408, 429, 500, 502, 503, 504) and attempt < attempts - 1:
                logger.warning(
                    "reference_image_http_retry view=%s attempt=%s/%s http=%s",
                    view_name,
                    attempt + 1,
                    attempts,
                    code,
                )
                time.sleep(backoff_s)
                backoff_s = min(backoff_s * 2.0, 60.0)
                continue
            try:
                detail = exc.read().decode("utf-8", errors="replace")
            except Exception:
                detail = str(exc)
            if code == 401:
                hint = (
                    " The key was rejected by the image API host "
                    f"({IMAGE_OPENAI_BASE_URL or 'https://api.openai.com'}). "
                    "Use a real OpenAI key in IMAGE_OPENAI_API_KEY; chat keys from DeepSeek/other hosts will not work there."
                )
                if OPENAI_BASE_URL and "openai.com" not in OPENAI_BASE_URL.lower():
                    hint += f" Your LLM uses OPENAI_BASE_URL={OPENAI_BASE_URL} — keep that for chat only."
                raise ReferenceImageAPIError(
                    f"Reference image API failed: HTTP {code}: {detail}{hint}"
                ) from exc
            raise ReferenceImageAPIError(f"Reference image API failed: HTTP {code}: {detail}") from exc
        except error.URLError as exc:
            if attempt < attempts - 1 and _retryable_url_error(exc):
                logger.warning(
                    "reference_image_network_retry view=%s attempt=%s/%s reason=%r",
                    view_name,
                    attempt + 1,
                    attempts,
                    exc.reason,
                )
                time.sleep(backoff_s)
                backoff_s = min(backoff_s * 2.0, 60.0)
                continue
            if _retryable_url_error(exc):
                hint = (
                    f" Transient errors persisted after {attempts} attempt(s) "
                    f"(per-attempt socket timeout {http_timeout}s). "
                    "Check network, VPN, firewall, and corporate proxy; try raising CONCEPT_IMAGE_HTTP_TIMEOUT_SECONDS "
                    f"or CONCEPT_IMAGE_HTTP_RETRIES."
                )
            else:
                hint = (
                    " Check IMAGE_OPENAI_BASE_URL, TLS or proxy settings, and that the host is reachable from this machine."
                )
            raise ReferenceImageAPIError(
                f"Reference image API failed: network error reaching image host: {exc!r}.{hint}"
            ) from exc


def _shared_reference_context(
    *,
    prompt: str,
    company: str | None,
    documents: list[str],
) -> str:
    doc_blob = ""
    if documents:
        doc_blob = ("\n\n---\n\n".join(documents))[:6000]

    parts: list[str] = [
        # Lead with the verbatim user prompt so the model anchors on the actual product type.
        f"PRODUCT TO RENDER (this is the most important instruction): {prompt.strip()}",
        "Render exactly the kind of product the user described. The product type is fixed by the user's words "
        "above; do not change it. Apparel, electronics, furniture, tools, toys, footwear, accessories, vehicles, "
        "sporting goods, packaging, and any other product category are all valid — choose whichever the user "
        "actually described, and never default to a container/box/tin/bottle/jar shape unless the user asked for one.",
        "Style: a clean studio reference photo of a single object, centered, on a neutral soft-gray or white "
        "background, even soft lighting, realistic materials and proportions, clear silhouette. No people, no "
        "hands, no surrounding props, no captions, no watermarks, no UI overlays. Logos, labels, graphics, and "
        "text printed on the product itself are allowed and should be included when the description or brand "
        "context calls for them.",
        "MULTI-VIEW CONSISTENCY (mandatory): You are generating one of two reference shots of the SAME object. "
        "It must look identical in both views — same overall proportions, silhouette, parts, materials, surface "
        "finish, color palette, graphics, and distinctive details. Do not introduce, remove, or change features "
        "between views; only the camera viewpoint may differ.",
    ]
    if company:
        parts.append(f"Company / brand: {company}.")

    if doc_blob:
        parts.append(
            "BRAND AND VISUAL CONTEXT (supporting for product type, but strict for identity): The excerpts below come "
            "from the user's context documents (pasted text or analyzed reference files). They must not change WHAT "
            "the product is — the user's words above fix the product category and form. Apply the excerpts to "
            "colors, finishes, materials, graphics, logos, typography, and stylistic treatment ON that product. "
            "When excerpts include brand guidelines, a visual identity system, a style manual, or bullets prefixed "
            "with \"MUST:\" (mandatory rules), treat those specifications as exact requirements: match stated color "
            "values and palette, respect logo variants/clearspace/background rules when shown or described, use "
            "lettering that matches named typefaces in weight and character, and match the guide's visual tone. "
            "Do not substitute different corporate colors, unrelated display fonts, or invented logo marks when the "
            "guide defines these. If an excerpt mentions or depicts a different object type than the user's product "
            "description, ignore that object type only; still apply any brand rules from that excerpt to the user's "
            "product. "
            f"Excerpts:\n{doc_blob}"
        )

    return " ".join(parts)


def generate_reference_images(
    *,
    prompt: str,
    company: str | None,
    documents: list[str],
    output_dir: Path,
    openai_image_model: str | None = None,
    after_front_saved: Callable[[], None] | None = None,
) -> dict[str, Path]:
    """
    Generates reference images under output_dir and returns view name -> path.

    Prompts use only the user's product description, optional company line, and
    context document excerpts (no structured product spec or inferred geometry).
    Front view uses /v1/images/generations. When possible, the three-quarter view
    is produced with /v1/images/edits from the front PNG (camera-only instruction).
    """
    if not IMAGE_OPENAI_API_KEY:
        raise ValueError(
            "Concept reference images need a valid OpenAI API key. "
            "For an all-OpenAI setup, set OPENAI_API_KEY (and OPENAI_BASE_URL=https://api.openai.com or leave it unset). "
            "If OPENAI_BASE_URL is DeepSeek/Groq/etc., set IMAGE_OPENAI_API_KEY to an OpenAI key from https://platform.openai.com "
            "because /v1/images/generations runs on OpenAI only."
        )

    gen_model = ((openai_image_model or IMAGE_OPENAI_MODEL) or "").strip() or IMAGE_OPENAI_MODEL

    # Front: user text + context. Three-quarter: derived from the front PNG via /images/edits when supported.
    shared = _shared_reference_context(
        prompt=prompt,
        company=company,
        documents=documents,
    )
    front_camera = (
        "View role: canonical straight-on front reference photo of the product. "
        "Camera: front elevation, object centered, eye level, neutral studio background, even soft lighting."
    )
    legacy_three_quarter_camera = (
        "View role: same product as the front reference, rotated in space only — not a different product variant. "
        "Camera: three-quarter view from front-right with a modest downward tilt. "
        "Object centered, neutral studio background, same apparent scale and design as the front view."
    )

    base = (IMAGE_OPENAI_BASE_URL or "https://api.openai.com").rstrip("/")
    gen_url = f"{base}/v1/images/generations"
    edits_url = f"{base}/v1/images/edits"
    http_timeout = max(120, CONCEPT_IMAGE_HTTP_TIMEOUT_SECONDS)
    retries = CONCEPT_IMAGE_HTTP_RETRIES

    results: dict[str, Path] = {}

    logger.info("reference_image_begin view=front model=%s", gen_model)
    front_prompt = f"{shared} {front_camera}"
    gen_payload: dict = {
        "model": gen_model,
        "prompt": front_prompt,
        "size": "1024x1024",
        "n": 1,
    }
    if _dalle_model_requests_response_format(gen_model):
        gen_payload["response_format"] = "b64_json"
    body = _post_openai_images_json(
        url=gen_url,
        payload=gen_payload,
        http_timeout=http_timeout,
        view_name="front",
        max_retries=retries,
    )
    front_bytes = _image_bytes_from_response_item(
        body["data"][0],
        http_timeout=http_timeout,
        max_retries=retries,
    )
    front_path = output_dir / "reference_front.png"
    front_path.write_bytes(front_bytes)
    results["front"] = front_path
    if after_front_saved is not None:
        after_front_saved()

    edit_model = _three_quarter_edit_model(gen_model)
    if edit_model:
        logger.info(
            "reference_image_begin view=three_quarter model=%s mode=image_edits_from_front",
            edit_model,
        )
        edit_payload: dict = {
            "model": edit_model,
            "images": [{"image_url": _png_data_url(front_bytes)}],
            "prompt": _three_quarter_edit_prompt(shared),
            "n": 1,
            "size": "1024x1024",
            "output_format": "png",
            "quality": "high",
            "background": "opaque",
        }
        if _edit_model_accepts_high_input_fidelity(edit_model):
            edit_payload["input_fidelity"] = "high"
        body_tq = _post_openai_images_json(
            url=edits_url,
            payload=edit_payload,
            http_timeout=http_timeout,
            view_name="three_quarter",
            max_retries=retries,
        )
        tq_bytes = _image_bytes_from_response_item(
            body_tq["data"][0],
            http_timeout=http_timeout,
            max_retries=retries,
        )
        tq_path = output_dir / "reference_three_quarter.png"
        tq_path.write_bytes(tq_bytes)
        results["three_quarter"] = tq_path
    else:
        logger.warning(
            "reference_image_three_quarter_fallback primary_model=%s "
            "reason=no_gpt_image_edit_model_for_three_quarter_using_second_text_generation "
            "(set IMAGE_OPENAI_EDIT_MODEL to a GPT image model, e.g. gpt-image-1-mini, to anchor 3/4 on the front PNG)",
            gen_model,
        )
        tq_prompt = f"{shared} {legacy_three_quarter_camera}"
        gen_tq: dict = {
            "model": gen_model,
            "prompt": tq_prompt,
            "size": "1024x1024",
            "n": 1,
        }
        if _dalle_model_requests_response_format(gen_model):
            gen_tq["response_format"] = "b64_json"
        body_tq = _post_openai_images_json(
            url=gen_url,
            payload=gen_tq,
            http_timeout=http_timeout,
            view_name="three_quarter",
            max_retries=retries,
        )
        tq_bytes = _image_bytes_from_response_item(
            body_tq["data"][0],
            http_timeout=http_timeout,
            max_retries=retries,
        )
        tq_path = output_dir / "reference_three_quarter.png"
        tq_path.write_bytes(tq_bytes)
        results["three_quarter"] = tq_path

    return results

