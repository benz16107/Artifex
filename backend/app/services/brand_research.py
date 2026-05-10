"""Web-grounded brand research (Tavily and/or Backboard) + LLM synthesis for concept image prompts."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib import error, request

from app.config import (
    ARTIFEX_BACKBOARD_RESEARCH_MERGE_WEB,
    ARTIFEX_BACKBOARD_RESEARCH_SKIP_TAVILY,
    ARTIFEX_BACKBOARD_RESEARCH_SYNTHESIS,
    ARTIFEX_BACKBOARD_RESEARCH_THREAD_DOCS,
    ARTIFEX_USE_BACKBOARD,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENAI_MODEL,
    RESEARCH_LLM_MAX_RETRIES,
    RESEARCH_LLM_TIMEOUT_SECONDS,
    RESEARCH_MAX_QUERIES,
    RESEARCH_TAVILY_MAX_RESULTS,
    TAVILY_API_KEY,
)
from app.services import backboard
from app.services.jobs import CancelledGeneration

logger = logging.getLogger("object-first-mvp")

RESEARCH_JSON_FILENAME = "research.json"

_MAX_THREAD_CONTEXT_FILES = 8
_MAX_THREAD_CONTEXT_BYTES = 400_000


@dataclass
class BrandResearchResult:
    """Structured output persisted on the job and merged into image prompts."""

    digest: str
    sources: list[dict[str, str]]
    brief: dict[str, str]
    warnings: list[str]
    tavily_results: list[dict[str, Any]]
    backboard_thread_id: str | None = None
    backboard_assistant_id: str | None = None


def _trim(s: str, limit: int) -> str:
    s = (s or "").strip()
    if len(s) <= limit:
        return s
    return s[: max(0, limit - 20)].rstrip() + "\n…(truncated)"


def _tavily_search_one(query: str, *, api_key: str) -> list[dict[str, Any]]:
    body = json.dumps(
        {
            "query": query.strip()[:400],
            "search_depth": "basic",
            "max_results": min(10, max(1, RESEARCH_TAVILY_MAX_RESULTS)),
        }
    ).encode("utf-8")
    req = request.Request(
        "https://api.tavily.com/search",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "Artifex/1.0 (brand research)",
        },
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            detail = str(exc)
        logger.warning(
            "tavily_search_http_error code=%s query=%r body=%r",
            getattr(exc, "code", "?"),
            query[:80],
            detail,
        )
        raise
    return list(data.get("results") or [])


def _collect_tavily_hits(
    company: str | None,
    prompt: str,
    *,
    is_cancelled: Callable[[], bool] | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    if not TAVILY_API_KEY:
        logger.warning(
            "brand_research: TAVILY_API_KEY is unset; Tavily web search is skipped. "
            "Set TAVILY_API_KEY in the environment (see .env.example) for live web results."
        )
        warnings.append(
            "Web search is off: set TAVILY_API_KEY in your server environment for live brand and market search "
            "(https://tavily.com — free tier available). Until then, research uses only your idea and uploaded documents."
        )
        return [], warnings

    first_line = (prompt or "").strip().split("\n", 1)[0].strip()[:120]
    queries: list[str] = []
    if company and first_line:
        queries.append(f"{company} brand positioning products {first_line}")
    if company:
        queries.append(f"{company} official brand visual identity packaging")
    if first_line:
        queries.append(f"{first_line} product category market competitors")
    if not queries:
        idea = (prompt or "").strip()[:400] or "consumer product design"
        queries.append(f"{idea} market competitors packaging branding")

    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    tavily_errors = 0
    for q in queries[: max(1, RESEARCH_MAX_QUERIES)]:
        if is_cancelled and is_cancelled():
            break
        if not q.strip():
            continue
        try:
            rows = _tavily_search_one(q, api_key=TAVILY_API_KEY)
        except (error.HTTPError, error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            tavily_errors += 1
            logger.warning("tavily_search_failed query=%r err=%r", q[:80], exc)
            continue
        for row in rows:
            url = (row.get("url") or "").strip()
            if not url or url in seen:
                continue
            seen.add(url)
            merged.append(row)
    if tavily_errors and not merged:
        warnings.append(
            "Web search returned no usable results: every Tavily request failed. "
            "Verify TAVILY_API_KEY, API credits, and outbound HTTPS from the worker process (see server logs)."
        )
    return merged, warnings


def _chat_completions_url() -> str:
    base = (OPENAI_BASE_URL or "https://api.openai.com").rstrip("/")
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def _post_synthesis_json(
    messages: list[dict[str, str]],
    *,
    use_json_object_format: bool,
) -> dict[str, Any]:
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY is not set; cannot synthesize brand research.")

    payload: dict[str, Any] = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "temperature": 0.25,
    }
    if use_json_object_format:
        payload["response_format"] = {"type": "json_object"}

    body = json.dumps(payload).encode("utf-8")
    url = _chat_completions_url()
    last_err: str | None = None
    for attempt in range(max(1, RESEARCH_LLM_MAX_RETRIES + 1)):
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
            with request.urlopen(req, timeout=RESEARCH_LLM_TIMEOUT_SECONDS) as response:
                parsed = json.loads(response.read().decode("utf-8"))
            content = parsed["choices"][0]["message"]["content"]
            if isinstance(content, list):
                content = "".join(
                    part.get("text", "") for part in content if isinstance(part, dict)
                )
            text = (content or "").strip()
            if not text:
                raise ValueError("Research model returned empty content.")
            text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
            text = re.sub(r"\s*```$", "", text)
            return json.loads(text)
        except error.HTTPError as exc:
            try:
                detail = exc.read().decode("utf-8", errors="replace")
            except Exception:
                detail = str(exc)
            last_err = f"HTTP {getattr(exc, 'code', '?')}: {detail[:500]}"
            if exc.code == 400 and use_json_object_format and "response_format" in detail.lower():
                return _post_synthesis_json(messages, use_json_object_format=False)
            if exc.code in (408, 429, 500, 502, 503, 504) and attempt < RESEARCH_LLM_MAX_RETRIES:
                continue
            break
        except error.URLError as exc:
            last_err = f"URL error: {exc.reason!r}"
            if attempt < RESEARCH_LLM_MAX_RETRIES:
                continue
            break
        except json.JSONDecodeError as exc:
            last_err = f"Invalid JSON from model: {exc}"
            break
    raise ValueError(last_err or "Research synthesis failed.")


def _brand_synthesis_system_prompt(*, strict_json_prose: bool) -> str:
    base = (
        "You are a brand and product research assistant for industrial design concept art. "
        "Return a single JSON object with these keys: "
        "brand_snapshot (string, 2-4 sentences on who the company is, who it serves, and how it positions itself), "
        "visual_packaging_cues (string, bullets or short paragraph about colors, finishes, materials, logo usage, "
        "packaging conventions if known), "
        "category_competitive_notes (string, short — competitive context, category norms, what differentiation looks like), "
        "financial_snapshot (string, 2-4 short bullets summarising recent financial signals — revenue trajectory, "
        "profitability, cost discipline, capital allocation — and translating each into a concrete implication for "
        "this product's positioning, material grade, finish quality, packaging investment, or price tier; if no "
        "financial info is available, say 'No reliable financial signals available.'), "
        "corporate_strategy (string, 2-4 short bullets summarising stated strategic priorities, target segments, "
        "growth bets, sustainability or technology themes, and translating each into a concrete implication for "
        "what kind of product this should become — its archetype, feature emphasis, target user, and visual tone; "
        "if no strategy info is available, say 'No stated corporate strategy found.'), "
        "research_digest (string, max 1800 chars, plain English bullets the image model can follow; the digest MUST "
        "fold financial_snapshot and corporate_strategy implications into product/visual decisions — e.g. material "
        "grade, finish, color emphasis, form factor, packaging cue — not just repeat the financial/strategy bullets; "
        "no URLs inside digest; if a fact is only from web snippets say 'reportedly'; "
        "if internal documents conflict with web, prefer internal documents for brand rules), "
        "sources (array of objects with keys source_id int, title string, url string, supporting_quote string under 240 chars). "
        "Every non-obvious factual claim in research_digest should map to a source in `sources` when web snippets exist. "
        "If there are no web snippets, sources may be an empty array."
    )
    if strict_json_prose:
        return base + " Respond with one JSON object only (no markdown, no prose outside JSON)."
    return base


def _post_backboard_brand_json(
    system: str,
    user_block: str,
    *,
    thread_id: str | None,
    use_web_search: bool,
    multipart_files: list[tuple[str, str, bytes]] | None,
    is_cancelled: Callable[[], bool] | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (parsed_json, raw_backboard_response)."""
    web = "Auto" if use_web_search else "off"
    json_ok = bool(not use_web_search)
    last_err: str | None = None
    for attempt in range(max(1, RESEARCH_LLM_MAX_RETRIES + 1)):
        if is_cancelled and is_cancelled():
            raise CancelledGeneration("Brand research cancelled by user.")
        try:
            raw = backboard.send_message(
                content=user_block,
                thread_id=thread_id,
                system_prompt=system,
                web_search=web,
                json_output=json_ok,
                multipart_files=multipart_files,
            )
            text = backboard.assistant_text(raw)
            parsed = backboard.parse_json_content(text)
            return parsed, raw
        except CancelledGeneration:
            raise
        except (backboard.BackboardError, json.JSONDecodeError, ValueError) as exc:
            last_err = str(exc)[:500]
            if attempt < RESEARCH_LLM_MAX_RETRIES:
                continue
            break
    raise ValueError(last_err or "Backboard research synthesis failed.")


def _backboard_upload_thread_context(
    documents: list[str],
    *,
    is_cancelled: Callable[[], bool] | None,
) -> tuple[str | None, str | None, list[str]]:
    """Create a thread, upload UTF-8 context .txt files, wait for indexing. Returns (thread_id, assistant_id, warnings)."""
    warnings: list[str] = []
    nonempty = [d.strip() for d in documents if (d or "").strip()]
    if not nonempty:
        return None, None, warnings
    try:
        boot = backboard.send_message(
            content="(Artifex) Indexing internal context documents; no reply needed.",
            send_to_llm="false",
        )
    except backboard.BackboardError as exc:
        warnings.append(f"backboard_thread_docs_boot_failed:{str(exc)[:160]}")
        return None, None, warnings

    thread_id = str(boot.get("thread_id") or "").strip() or None
    assistant_id = str(boot.get("assistant_id") or "").strip() or None
    if not thread_id:
        warnings.append("backboard_thread_docs_missing_thread_id")
        return None, None, warnings

    for i, blob in enumerate(nonempty[:_MAX_THREAD_CONTEXT_FILES]):
        if is_cancelled and is_cancelled():
            raise CancelledGeneration("Brand research cancelled by user.")
        raw_txt = blob.encode("utf-8", errors="replace")[:_MAX_THREAD_CONTEXT_BYTES]
        fname = f"context_{i}.txt"
        try:
            up = backboard.upload_thread_document(thread_id, fname, raw_txt)
            doc_id = str(up.get("document_id") or "").strip()
            if not doc_id:
                warnings.append(f"backboard_upload_missing_document_id:{fname}")
                continue
            backboard.wait_document_indexed(doc_id, is_cancelled=is_cancelled)
        except (backboard.BackboardError, CancelledGeneration) as exc:
            if isinstance(exc, CancelledGeneration):
                raise
            warnings.append(f"backboard_thread_doc_failed:{fname}:{str(exc)[:120]}")
    warnings.append("backboard_thread_context_documents_indexed")
    return thread_id, assistant_id, warnings


def _fallback_from_documents(company: str | None, prompt: str, documents: list[str]) -> BrandResearchResult:
    blob = "\n\n".join(documents).strip()
    digest = (
        f"(No web search.) Company: {company or 'n/a'}. "
        f"Product idea: {prompt.strip()[:400]}. "
        f"Internal context summary: {_trim(blob, 900)}"
    )
    return BrandResearchResult(
        digest=digest,
        sources=[],
        brief={
            "brand_snapshot": company or "Not specified.",
            "visual_packaging_cues": "See internal context documents only.",
            "category_competitive_notes": "Web research was not available.",
            "financial_snapshot": "No reliable financial signals available.",
            "corporate_strategy": "No stated corporate strategy found.",
        },
        warnings=["synthesis_fallback_no_llm_json"],
        tavily_results=[],
    )


def _brand_result_from_parsed(
    parsed: dict[str, Any],
    *,
    tavily_rows: list[dict[str, Any]],
    warnings: list[str],
    bb_thread: str | None,
    bb_assistant: str | None,
) -> BrandResearchResult:
    digest = _trim(str(parsed.get("research_digest") or "").strip(), 2000)
    if not digest:
        digest = _trim(
            "\n".join(
                str(parsed.get(k) or "")
                for k in (
                    "brand_snapshot",
                    "visual_packaging_cues",
                    "category_competitive_notes",
                    "financial_snapshot",
                    "corporate_strategy",
                )
            ),
            2000,
        )

    raw_sources = parsed.get("sources")
    sources: list[dict[str, str]] = []
    if isinstance(raw_sources, list):
        for item in raw_sources:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            url = str(item.get("url") or "").strip()
            quote = str(item.get("supporting_quote") or item.get("quote") or "").strip()
            if not url and not title:
                continue
            sources.append(
                {
                    "title": title or url,
                    "url": url,
                    "snippet": _trim(quote, 400),
                }
            )

    brief = {
        "brand_snapshot": str(parsed.get("brand_snapshot") or "").strip(),
        "visual_packaging_cues": str(parsed.get("visual_packaging_cues") or "").strip(),
        "category_competitive_notes": str(parsed.get("category_competitive_notes") or "").strip(),
        "financial_snapshot": str(parsed.get("financial_snapshot") or "").strip(),
        "corporate_strategy": str(parsed.get("corporate_strategy") or "").strip(),
    }

    return BrandResearchResult(
        digest=digest,
        sources=sources,
        brief=brief,
        warnings=list(warnings),
        tavily_results=tavily_rows,
        backboard_thread_id=bb_thread,
        backboard_assistant_id=bb_assistant,
    )


def run_brand_research(
    *,
    company: str | None,
    prompt: str,
    documents: list[str],
    is_cancelled: Callable[[], bool] | None = None,
) -> BrandResearchResult:
    """
    Run web context (Tavily and/or Backboard) plus one synthesis call (OpenAI or Backboard).

    See .env.example for ARTIFEX_BACKBOARD_* and BACKBOARD_* options.
    """
    warnings: list[str] = []
    backboard_syn = bool(
        ARTIFEX_USE_BACKBOARD and ARTIFEX_BACKBOARD_RESEARCH_SYNTHESIS and backboard.is_configured()
    )
    if ARTIFEX_USE_BACKBOARD and ARTIFEX_BACKBOARD_RESEARCH_SYNTHESIS and not backboard.is_configured():
        warnings.append(
            "ARTIFEX_BACKBOARD_RESEARCH_SYNTHESIS is enabled but BACKBOARD_API_KEY is missing; using OpenAI for synthesis."
        )

    skip_tavily = bool(ARTIFEX_BACKBOARD_RESEARCH_SKIP_TAVILY and backboard_syn)
    merge_web = bool(ARTIFEX_BACKBOARD_RESEARCH_MERGE_WEB and backboard_syn and not skip_tavily)
    thread_docs = bool(ARTIFEX_BACKBOARD_RESEARCH_THREAD_DOCS and backboard_syn)

    if ARTIFEX_BACKBOARD_RESEARCH_SKIP_TAVILY and not backboard_syn:
        warnings.append(
            "ARTIFEX_BACKBOARD_RESEARCH_SKIP_TAVILY requires ARTIFEX_USE_BACKBOARD=1, BACKBOARD_API_KEY, and "
            "ARTIFEX_BACKBOARD_RESEARCH_SYNTHESIS; Tavily path is used instead."
        )
        skip_tavily = False

    if ARTIFEX_BACKBOARD_RESEARCH_THREAD_DOCS and not backboard_syn:
        warnings.append(
            "ARTIFEX_BACKBOARD_RESEARCH_THREAD_DOCS requires ARTIFEX_USE_BACKBOARD=1, BACKBOARD_API_KEY, and "
            "ARTIFEX_BACKBOARD_RESEARCH_SYNTHESIS."
        )

    if skip_tavily:
        tavily_rows: list[dict[str, Any]] = []
        warnings.append("Using Backboard web_search instead of Tavily (ARTIFEX_BACKBOARD_RESEARCH_SKIP_TAVILY).")
    else:
        tavily_rows, w_t = _collect_tavily_hits(company, prompt, is_cancelled=is_cancelled)
        warnings.extend(w_t)

    if is_cancelled and is_cancelled():
        raise CancelledGeneration("Brand research cancelled by user.")

    doc_join = "\n\n---\n\n".join(documents) if documents else ""
    doc_excerpt = _trim(doc_join, 8000)

    hits_lines: list[str] = []
    for i, row in enumerate(tavily_rows[:25]):
        title = (row.get("title") or "").strip()
        url = (row.get("url") or "").strip()
        content = _trim((row.get("content") or "").strip(), 600)
        hits_lines.append(f"[{i}] title={title!r} url={url!r}\ncontent: {content}")

    bb_thread: str | None = None
    bb_assistant: str | None = None
    use_inline_docs = True
    if thread_docs and documents and any((d or "").strip() for d in documents):
        bb_thread, bb_aid_upload, w_docs = _backboard_upload_thread_context(documents, is_cancelled=is_cancelled)
        warnings.extend(w_docs)
        if bb_thread:
            use_inline_docs = False
            bb_assistant = bb_aid_upload or bb_assistant

    if use_inline_docs:
        internal_block = f"Internal document excerpts (authoritative for confidential brand rules):\n{doc_excerpt or '(none)'}\n\n"
    else:
        internal_block = (
            "Internal context: authoritative excerpts were uploaded as indexed thread documents on this Backboard thread. "
            "Use them as binding for confidential brand rules.\n\n"
        )

    user_block = (
        f"Company (user): {company or 'none'}\n"
        f"Product idea (user):\n{prompt.strip()[:2000]}\n\n"
        f"{internal_block}"
        f"Web search snippets (public; may be incomplete):\n"
        f"{chr(10).join(hits_lines) if hits_lines else '(no Tavily snippets in this request)'}\n"
    )

    use_web = bool(skip_tavily or merge_web)
    strict_json = bool(use_web or merge_web)
    system = _brand_synthesis_system_prompt(strict_json_prose=strict_json)

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_block},
    ]

    if merge_web:
        warnings.append(
            "ARTIFEX_BACKBOARD_RESEARCH_MERGE_WEB: Tavily snippets are included and Backboard web_search is enabled."
        )

    use_json = "openai.com" in (OPENAI_BASE_URL or "").lower()

    try:
        if backboard_syn:
            parsed, raw_bb = _post_backboard_brand_json(
                system,
                user_block,
                thread_id=bb_thread,
                use_web_search=use_web,
                multipart_files=None,
                is_cancelled=is_cancelled,
            )
            bb_thread = str(raw_bb.get("thread_id") or bb_thread or "").strip() or bb_thread
            bb_assistant = str(raw_bb.get("assistant_id") or bb_assistant or "").strip() or bb_assistant
        else:
            parsed = _post_synthesis_json(messages, use_json_object_format=use_json)
    except CancelledGeneration:
        raise
    except ValueError as exc:
        logger.warning("brand_research_synthesis_failed err=%s", exc)
        warnings.append(f"synthesis_error:{str(exc)[:120]}")
        if not OPENAI_API_KEY and not backboard_syn:
            return _fallback_from_documents(company, prompt, documents)
        return BrandResearchResult(
            digest=_trim(doc_excerpt or (prompt.strip()[:1200]), 1800),
            sources=[],
            brief={
                "brand_snapshot": company or "",
                "visual_packaging_cues": "",
                "category_competitive_notes": str(exc)[:200],
                "financial_snapshot": "",
                "corporate_strategy": "",
            },
            warnings=warnings,
            tavily_results=tavily_rows,
            backboard_thread_id=bb_thread,
            backboard_assistant_id=bb_assistant,
        )

    return _brand_result_from_parsed(
        parsed,
        tavily_rows=tavily_rows,
        warnings=warnings,
        bb_thread=bb_thread,
        bb_assistant=bb_assistant,
    )
