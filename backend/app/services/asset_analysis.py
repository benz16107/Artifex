"""Convert user-uploaded reference assets (images, PDFs, text) into design context.

The output text "sections" are merged into the existing `documents` list that
feeds the context documents list merged into concept reference image prompts, so anything
extracted here automatically influences the resulting concept art.
"""

from __future__ import annotations

import base64
import json
import logging
import mimetypes
from dataclasses import dataclass
from typing import Any
from urllib import error, request

from app.config import (
    ARTIFEX_BACKBOARD_ASSET_ANALYSIS,
    ARTIFEX_USE_BACKBOARD,
    ASSET_ANALYSIS_LLM_MAX_RETRIES,
    ASSET_ANALYSIS_LLM_TIMEOUT_SECONDS,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENAI_MODEL,
)
from app.services import backboard

logger = logging.getLogger("object-first-mvp")


def _backboard_assets_enabled() -> bool:
    return bool(ARTIFEX_USE_BACKBOARD and ARTIFEX_BACKBOARD_ASSET_ANALYSIS and backboard.is_configured())


MAX_TOTAL_BYTES = 100 * 1024 * 1024  # 100 MB combined per request (no per-file cap)
MAX_FILES = 6
MAX_TEXT_CHARS = 8000
MAX_SECTION_CHARS = 4000

_IMAGE_MIME_PREFIX = "image/"
_PDF_MIME = "application/pdf"
_TEXT_LIKE_MIMES = {
    "application/json",
    "application/xml",
    "application/x-yaml",
    "application/yaml",
    "application/csv",
    "application/x-www-form-urlencoded",
    "application/javascript",
    "application/typescript",
    "application/sql",
    "application/x-sh",
    "application/x-toml",
    "application/toml",
    "application/markdown",
    "application/rtf",
}
_TEXT_MIME_PREFIXES = ("text/",)
_TEXT_LIKE_EXTS = {
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".tsv",
    ".json",
    ".yaml",
    ".yml",
    ".xml",
    ".log",
    ".html",
    ".htm",
    ".rtf",
    ".sql",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".env",
}


_SKETCH_SYSTEM_ADDENDUM = (
    " When the asset is explicitly a user's product sketch, treat it as rough intent: prioritize overall product "
    "idea, silhouette, proportions, and any written labels or arrows over literal line-art fidelity. Do not treat "
    "casual strokes as final surface detail; describe the product the user is trying to convey for downstream renders."
)


_SYSTEM_PROMPT = (
    "You are an industrial design research assistant. The user provides a reference asset "
    "(photo, sketch, diagram, document excerpt, brief, mood board, technical drawing, etc.) "
    "for a physical product they want to prototype. Extract concrete, design-relevant context "
    "that should drive concept art for that product. Cover any of these that apply: form factor "
    "and silhouette, materials and finishes, colors and palette, proportions and scale cues, "
    "labels/branding/typography cues, mood/style references, mechanical or technical features, "
    "constraints and explicit requirements. Be faithful to the source: describe what is visible "
    "or stated; never invent specifications. "
    "If the asset is or contains a brand guidelines document, visual identity / style manual, "
    "logo usage sheet, or similar: treat stated rules as binding for downstream rendering. "
    "Quote exact color values (hex, RGB, CMYK, Pantone) and named typefaces when given; note "
    "logo variants, clearspace, minimum sizes, backgrounds, and dos/don'ts. For any requirement "
    "the source states as mandatory or primary, prefix that bullet with \"MUST: \" so image "
    "generation can enforce it. Output 4-10 short bullet points as plain text "
    "(use '- ' prefixes), no headings, no preamble, no markdown formatting beyond the bullets, "
    "and at most ~120 words total."
)

_SYSTEM_SKETCH = _SYSTEM_PROMPT + _SKETCH_SYSTEM_ADDENDUM


class AssetAnalysisError(Exception):
    """User-facing asset analysis errors."""

    def __init__(self, message: str, *, http_status: int = 400) -> None:
        super().__init__(message)
        self.http_status = http_status


@dataclass(frozen=True)
class UploadedAsset:
    filename: str
    content_type: str
    data: bytes
    """How image gen should treat this asset: polished reference vs rough product sketch."""
    role: str = "reference"  # "reference" | "sketch"


def _resolve_mime(asset: UploadedAsset) -> str:
    ct = (asset.content_type or "").strip().lower()
    if ct and ct != "application/octet-stream":
        return ct
    guess, _ = mimetypes.guess_type(asset.filename or "")
    if guess:
        return guess.lower()
    return "application/octet-stream"


def _is_image(mime: str) -> bool:
    return mime.startswith(_IMAGE_MIME_PREFIX)


def _is_pdf(mime: str, filename: str) -> bool:
    if mime == _PDF_MIME:
        return True
    return (filename or "").lower().endswith(".pdf")


def _is_text_like(mime: str, filename: str) -> bool:
    if any(mime.startswith(p) for p in _TEXT_MIME_PREFIXES):
        return True
    if mime in _TEXT_LIKE_MIMES:
        return True
    name = (filename or "").lower()
    return any(name.endswith(ext) for ext in _TEXT_LIKE_EXTS)


def _decode_text(data: bytes) -> str | None:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return None


def _trim_text(text: str, *, limit: int = MAX_TEXT_CHARS) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "\n…(truncated)"


def _trim_section(text: str) -> str:
    text = text.strip()
    if len(text) <= MAX_SECTION_CHARS:
        return text
    return text[:MAX_SECTION_CHARS].rstrip() + "\n…(truncated)"


def _filename_suggests_brand_guide(filename: str) -> bool:
    """Heuristic: filename hints the upload is a brand / identity guide."""
    n = (filename or "").lower().replace("_", " ").replace("-", " ")
    needles = (
        "brand guide",
        "branding",
        "brand book",
        "style guide",
        "styleguide",
        "visual identity",
        "identity guide",
        "logo guide",
        "logo usage",
        "vi manual",
        "brand manual",
        "guidelines",
    )
    return any(s in n for s in needles)


def _data_url(asset: UploadedAsset, mime: str) -> str:
    b64 = base64.standard_b64encode(asset.data).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _chat_completions_url() -> str:
    base = (OPENAI_BASE_URL or "https://api.openai.com").rstrip("/")
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def _post_chat_completion(payload: dict) -> str:
    """POST to OpenAI-compatible chat completions; return assistant text or raise."""
    if not OPENAI_API_KEY:
        raise AssetAnalysisError(
            "OPENAI_API_KEY is not set on the server, so reference files cannot be analyzed.",
            http_status=503,
        )
    url = _chat_completions_url()
    body = json.dumps(payload).encode("utf-8")
    last_error: str | None = None
    for attempt in range(max(1, ASSET_ANALYSIS_LLM_MAX_RETRIES + 1)):
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
            with request.urlopen(req, timeout=ASSET_ANALYSIS_LLM_TIMEOUT_SECONDS) as response:
                parsed = json.loads(response.read().decode("utf-8"))
            content = parsed["choices"][0]["message"]["content"]
            if isinstance(content, list):
                # Some providers stream content blocks: stitch text parts.
                content = "".join(
                    part.get("text", "") for part in content if isinstance(part, dict)
                )
            text = (content or "").strip()
            if not text:
                raise AssetAnalysisError("Model returned an empty analysis.")
            return text
        except error.HTTPError as exc:
            try:
                detail = exc.read().decode("utf-8", errors="replace")
            except Exception:
                detail = str(exc)
            last_error = f"HTTP {getattr(exc, 'code', '?')}: {detail[:400]}"
            if exc.code in (408, 429, 500, 502, 503, 504) and attempt < ASSET_ANALYSIS_LLM_MAX_RETRIES:
                continue
            break
        except error.URLError as exc:
            last_error = f"URL error: {exc.reason!r}"
            if attempt < ASSET_ANALYSIS_LLM_MAX_RETRIES:
                continue
            break
        except (KeyError, json.JSONDecodeError, ValueError) as exc:
            last_error = str(exc)
            break
    raise AssetAnalysisError(
        f"Could not analyze the file via the LLM ({last_error}).",
        http_status=502,
    )


def _safe_upload_basename(asset: UploadedAsset) -> str:
    raw = (asset.filename or "upload").replace("\\", "/").split("/")[-1]
    stem = raw.rsplit(".", 1)[0] if "." in raw else raw
    cleaned = "".join(c for c in stem if c.isalnum() or c in ("-", "_"))[:80]
    return cleaned or "upload"


def _post_backboard_asset(
    system: str,
    user_text: str,
    files: list[tuple[str, str, bytes]] | None,
) -> str:
    last_error: str | None = None
    for attempt in range(max(1, ASSET_ANALYSIS_LLM_MAX_RETRIES + 1)):
        try:
            raw = backboard.send_message(
                content=user_text,
                system_prompt=system,
                web_search="off",
                json_output=False,
                multipart_files=files,
            )
            return backboard.assistant_text(raw)
        except backboard.BackboardError as exc:
            last_error = str(exc)
            if attempt < ASSET_ANALYSIS_LLM_MAX_RETRIES:
                continue
            break
    raise AssetAnalysisError(
        f"Could not analyze the file via Backboard ({last_error}).",
        http_status=502,
    )


def _analyze_image(asset: UploadedAsset, mime: str, *, sketch: bool) -> str:
    if sketch:
        intro = (
            f"Product sketch (rough concept): {asset.filename or 'image'} ({mime}). "
            "The user uploaded this as a hand-drawn or informal sketch of what the product should generally look "
            "like—not as a polished photo reference. Extract design intent per the system instructions."
        )
        system = _SYSTEM_SKETCH
    else:
        intro = (
            f"Reference file: {asset.filename or 'image'} ({mime}). "
            "Extract concept-art-relevant context per the system instructions."
        )
        system = _SYSTEM_PROMPT
    if _backboard_assets_enabled():
        ext = (mimetypes.guess_extension(mime) or ".png").lower()
        fname = _safe_upload_basename(asset) + ext
        return _post_backboard_asset(system, intro, [("files", fname, asset.data)])
    user_content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": intro,
        },
        {
            "type": "image_url",
            "image_url": {"url": _data_url(asset, mime)},
        },
    ]
    payload = {
        "model": OPENAI_MODEL,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
    }
    return _post_chat_completion(payload)


def _analyze_pdf(asset: UploadedAsset) -> str:
    intro = (
        f"Reference document: {asset.filename or 'document.pdf'}. "
        "Extract concept-art-relevant context per the system instructions."
    )
    if _backboard_assets_enabled():
        fname = _safe_upload_basename(asset) + ".pdf"
        return _post_backboard_asset(_SYSTEM_PROMPT, intro, [("files", fname, asset.data)])
    user_content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": intro,
        },
        {
            "type": "file",
            "file": {
                "filename": asset.filename or "document.pdf",
                "file_data": _data_url(asset, _PDF_MIME),
            },
        },
    ]
    payload = {
        "model": OPENAI_MODEL,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
    }
    return _post_chat_completion(payload)


def _analyze_text(asset: UploadedAsset, raw: str) -> str:
    body = _trim_text(raw)
    user_content = (
        f"Reference document: {asset.filename or 'document.txt'}.\n\n"
        f"Document text follows between <doc> tags:\n<doc>\n{body}\n</doc>"
    )
    if _backboard_assets_enabled():
        return _post_backboard_asset(_SYSTEM_PROMPT, user_content, None)
    payload = {
        "model": OPENAI_MODEL,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
    }
    return _post_chat_completion(payload)


def _effective_sketch(asset: UploadedAsset, mime: str) -> bool:
    return (asset.role or "reference") == "sketch" and _is_image(mime)


def analyze_uploaded_asset(asset: UploadedAsset) -> str:
    """Return a single text section describing design-relevant context for the asset."""
    if not asset.data:
        raise AssetAnalysisError(f"{asset.filename or 'file'} is empty.")
    mime = _resolve_mime(asset)
    label = f"{asset.filename or 'file'} ({mime})"
    sketch = _effective_sketch(asset, mime)

    try:
        if _is_image(mime):
            body = _analyze_image(asset, mime, sketch=sketch)
        elif _is_pdf(mime, asset.filename):
            body = _analyze_pdf(asset)
        elif _is_text_like(mime, asset.filename):
            text = _decode_text(asset.data)
            if text is None or not text.strip():
                raise AssetAnalysisError(
                    f"Could not decode text from {asset.filename or 'file'}; please upload UTF-8 text."
                )
            body = _analyze_text(asset, text)
        else:
            text = _decode_text(asset.data)
            if text is None or not text.strip():
                raise AssetAnalysisError(
                    f"Unsupported file type {mime} for {asset.filename or 'file'}. "
                    "Upload an image, PDF, or text-based document."
                )
            body = _analyze_text(asset, text)
    except AssetAnalysisError:
        raise
    except Exception as exc:  # pragma: no cover - safety net
        logger.exception("asset_analysis_failure filename=%s", asset.filename)
        raise AssetAnalysisError(f"Failed to analyze {asset.filename or 'file'}: {exc}") from exc

    body_stripped = body.strip()
    if _filename_suggests_brand_guide(asset.filename or ""):
        body_stripped = (
            "SOURCE TREATMENT: Filename suggests a brand or visual identity guide — extract only "
            "what the document states; downstream renders must follow these rules exactly for "
            "colors, typography style, logos, and tone.\n\n" + body_stripped
        )

    header = "Product sketch (rough concept)" if sketch else "Reference file"
    return _trim_section(f"{header} — {label}\n{body_stripped}")


def analyze_uploaded_assets(assets: list[UploadedAsset]) -> tuple[list[str], list[str]]:
    """Analyze multiple assets, returning (sections, warnings).

    Per-asset failures are collected as warnings so a single bad file does not
    block the rest of the batch.
    """
    if len(assets) > MAX_FILES:
        raise AssetAnalysisError(
            f"Too many files: {len(assets)} (max {MAX_FILES} per request).", http_status=413
        )
    total = sum(len(a.data) for a in assets)
    if total > MAX_TOTAL_BYTES:
        raise AssetAnalysisError(
            f"Combined upload size {total // (1024 * 1024)} MB exceeds the "
            f"{MAX_TOTAL_BYTES // (1024 * 1024)} MB request limit.",
            http_status=413,
        )

    sections: list[str] = []
    warnings: list[str] = []
    for asset in assets:
        try:
            sections.append(analyze_uploaded_asset(asset))
        except AssetAnalysisError as exc:
            warnings.append(str(exc))
    return sections, warnings
