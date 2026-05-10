"""Web-grounded brand research (Tavily) + LLM synthesis for concept image prompts."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib import error, request

from app.config import (
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENAI_MODEL,
    RESEARCH_LLM_MAX_RETRIES,
    RESEARCH_LLM_TIMEOUT_SECONDS,
    RESEARCH_MAX_QUERIES,
    RESEARCH_TAVILY_MAX_RESULTS,
    TAVILY_API_KEY,
)
from app.services.jobs import CancelledGeneration

logger = logging.getLogger("object-first-mvp")

RESEARCH_JSON_FILENAME = "research.json"


@dataclass
class BrandResearchResult:
    """Structured output persisted on the job and merged into image prompts."""

    digest: str
    sources: list[dict[str, str]]
    brief: dict[str, str]
    warnings: list[str]
    tavily_results: list[dict[str, Any]]


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
        },
        warnings=["synthesis_fallback_no_llm_json"],
        tavily_results=[],
    )


def run_brand_research(
    *,
    company: str | None,
    prompt: str,
    documents: list[str],
    is_cancelled: Callable[[], bool] | None = None,
) -> BrandResearchResult:
    """
    Run Tavily web search (when TAVILY_API_KEY is set) + one chat call for digest and sources.

    Without TAVILY_API_KEY, only user documents + idea inform the brief (see research warnings).
    """
    tavily_rows, warnings = _collect_tavily_hits(company, prompt, is_cancelled=is_cancelled)
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

    user_block = (
        f"Company (user): {company or 'none'}\n"
        f"Product idea (user):\n{prompt.strip()[:2000]}\n\n"
        f"Internal document excerpts (authoritative for confidential brand rules):\n{doc_excerpt or '(none)'}\n\n"
        f"Web search snippets (public; may be incomplete):\n"
        f"{chr(10).join(hits_lines) if hits_lines else '(no web results)'}\n"
    )

    system = (
        "You are a brand and product research assistant for industrial design concept art. "
        "Return a single JSON object with these keys: "
        "brand_snapshot (string, 2-4 sentences), "
        "visual_packaging_cues (string, bullets or short paragraph about colors, finishes, logo usage if known), "
        "category_competitive_notes (string, short), "
        "research_digest (string, max 1800 chars, plain English bullets the image model can follow; "
        "no URLs inside digest; if a fact is only from web snippets say 'reportedly'; "
        "if internal documents conflict with web, prefer internal documents for brand rules), "
        "sources (array of objects with keys source_id int, title string, url string, supporting_quote string under 240 chars). "
        "Every non-obvious factual claim in research_digest should map to a source in `sources` when web snippets exist. "
        "If there are no web snippets, sources may be an empty array."
    )

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_block},
    ]

    use_json = "openai.com" in (OPENAI_BASE_URL or "").lower()
    try:
        parsed = _post_synthesis_json(messages, use_json_object_format=use_json)
    except ValueError as exc:
        logger.warning("brand_research_synthesis_failed err=%s", exc)
        warnings.append(f"synthesis_error:{str(exc)[:120]}")
        if not OPENAI_API_KEY:
            return _fallback_from_documents(company, prompt, documents)
        return BrandResearchResult(
            digest=_trim(doc_excerpt or (prompt.strip()[:1200]), 1800),
            sources=[],
            brief={
                "brand_snapshot": company or "",
                "visual_packaging_cues": "",
                "category_competitive_notes": str(exc)[:200],
            },
            warnings=warnings,
            tavily_results=tavily_rows,
        )

    digest = _trim(str(parsed.get("research_digest") or "").strip(), 2000)
    if not digest:
        digest = _trim(
            "\n".join(
                str(parsed.get(k) or "")
                for k in ("brand_snapshot", "visual_packaging_cues", "category_competitive_notes")
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
    }

    return BrandResearchResult(
        digest=digest,
        sources=sources,
        brief=brief,
        warnings=list(warnings),
        tavily_results=tavily_rows,
    )
