"""HTTP client for Backboard API (https://docs.backboard.io/)."""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from typing import Any, Callable
from urllib import error, request

from app.config import (
    BACKBOARD_API_KEY,
    BACKBOARD_ASSISTANT_ID,
    BACKBOARD_BASE_URL,
    BACKBOARD_DOCUMENT_POLL_INTERVAL_SECONDS,
    BACKBOARD_DOCUMENT_POLL_MAX_SECONDS,
    BACKBOARD_HTTP_TIMEOUT_SECONDS,
    BACKBOARD_LLM_PROVIDER,
    BACKBOARD_MEMORY,
    BACKBOARD_MODEL_NAME,
)

logger = logging.getLogger("object-first-mvp")


class BackboardError(Exception):
    """Raised when Backboard returns an error or unusable response."""


def is_configured() -> bool:
    return bool(BACKBOARD_API_KEY)


def _api_root() -> str:
    return (BACKBOARD_BASE_URL or "https://app.backboard.io/api").rstrip("/")


def _headers_json() -> dict[str, str]:
    if not BACKBOARD_API_KEY:
        raise BackboardError("BACKBOARD_API_KEY is not set.")
    return {
        "X-API-Key": BACKBOARD_API_KEY,
        "Content-Type": "application/json",
        "User-Agent": "Artifex/1.0 (backboard)",
    }


def _headers_multipart(boundary: str) -> dict[str, str]:
    if not BACKBOARD_API_KEY:
        raise BackboardError("BACKBOARD_API_KEY is not set.")
    return {
        "X-API-Key": BACKBOARD_API_KEY,
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "User-Agent": "Artifex/1.0 (backboard)",
    }


def _encode_multipart(fields: dict[str, str], file_parts: list[tuple[str, str, bytes]]) -> tuple[bytes, str]:
    """Return (body, boundary) for multipart/form-data.

    file_parts: list of (form_field_name, filename, raw_bytes)
    """
    boundary = f"----ArtifexBackboard{uuid.uuid4().hex}"
    crlf = b"\r\n"
    parts: list[bytes] = []

    for key, value in fields.items():
        parts.append(f"--{boundary}".encode())
        parts.append(
            f'Content-Disposition: form-data; name="{key}"'.encode() + crlf + crlf + value.encode("utf-8") + crlf
        )

    for field_name, filename, data in file_parts:
        safe_fn = "".join(
            c if c.isascii() and c not in '"\\;\r\n' else "_" for c in (filename or "file.bin")
        )[:180] or "file.bin"
        parts.append(f"--{boundary}".encode())
        header = (
            f'Content-Disposition: form-data; name="{field_name}"; filename="{safe_fn}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n"
        )
        parts.append(header.encode())
        parts.append(data + crlf)

    parts.append(f"--{boundary}--".encode() + crlf)
    return b"".join(parts), boundary


def _read_json_response(resp_data: bytes) -> dict[str, Any]:
    try:
        return json.loads(resp_data.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise BackboardError(f"Invalid JSON from Backboard: {exc}") from exc


def post_threads_messages_json(body: dict[str, Any]) -> dict[str, Any]:
    url = f"{_api_root()}/threads/messages"
    raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = request.Request(url, data=raw, headers=_headers_json(), method="POST")
    try:
        with request.urlopen(req, timeout=BACKBOARD_HTTP_TIMEOUT_SECONDS) as response:
            return _read_json_response(response.read())
    except error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:800]
        except Exception:
            detail = str(exc)
        raise BackboardError(f"Backboard HTTP {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise BackboardError(f"Backboard network error: {exc.reason!r}") from exc


def post_threads_messages_multipart(fields: dict[str, str], files: list[tuple[str, str, bytes]]) -> dict[str, Any]:
    url = f"{_api_root()}/threads/messages"
    body, boundary = _encode_multipart(fields, files)
    req = request.Request(url, data=body, headers=_headers_multipart(boundary), method="POST")
    try:
        with request.urlopen(req, timeout=BACKBOARD_HTTP_TIMEOUT_SECONDS) as response:
            return _read_json_response(response.read())
    except error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:800]
        except Exception:
            detail = str(exc)
        raise BackboardError(f"Backboard HTTP {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise BackboardError(f"Backboard network error: {exc.reason!r}") from exc


def _response_assistant_text(parsed: dict[str, Any]) -> str:
    status = (parsed.get("status") or "").upper()
    if status == "FAILED":
        msg = parsed.get("message") or parsed.get("content") or "unknown"
        raise BackboardError(f"Backboard message status FAILED: {msg}")
    content = parsed.get("content")
    text: str | None = None
    if isinstance(content, str) and content.strip():
        text = content.strip()
    if text is None:
        alt = parsed.get("message")
        if isinstance(alt, str) and alt.strip():
            text = alt.strip()
    if text:
        return text
    if status in ("IN_PROGRESS", "REQUIRES_ACTION", "CANCELLED"):
        raise BackboardError(f"Backboard message not ready (status={status or 'unknown'}).")
    if not isinstance(content, str) and content is not None:
        raise BackboardError(f"Unexpected content type from Backboard: {type(content)}")
    raise BackboardError("Backboard returned empty content.")


def send_message(
    *,
    content: str,
    thread_id: str | None = None,
    assistant_id: str | None = None,
    system_prompt: str | None = None,
    web_search: str = "off",
    json_output: bool = False,
    memory: str | None = None,
    send_to_llm: str = "true",
    multipart_files: list[tuple[str, str, bytes]] | None = None,
) -> dict[str, Any]:
    """POST /threads/messages. Returns full JSON object including thread_id and content.

    multipart_files: optional list of (form_field_name, filename, bytes) for multipart mode.
    """
    mem = (memory if memory is not None else (BACKBOARD_MEMORY or "off")).strip() or "off"
    aid = (assistant_id or BACKBOARD_ASSISTANT_ID or "").strip() or None
    fields_json: dict[str, Any] = {
        "content": content,
        "stream": False,
        "web_search": web_search,
        "json_output": bool(json_output),
        "memory": mem,
        "send_to_llm": send_to_llm,
        "llm_provider": BACKBOARD_LLM_PROVIDER,
        "model_name": BACKBOARD_MODEL_NAME,
    }
    if thread_id:
        fields_json["thread_id"] = thread_id
    if aid:
        fields_json["assistant_id"] = aid
    if system_prompt:
        fields_json["system_prompt"] = system_prompt

    if multipart_files:
        # Multipart: booleans as strings per Backboard examples
        mp_fields: dict[str, str] = {
            "content": content,
            "stream": "false",
            "web_search": web_search,
            "json_output": "true" if json_output else "false",
            "memory": mem,
            "send_to_llm": send_to_llm,
            "llm_provider": BACKBOARD_LLM_PROVIDER,
            "model_name": BACKBOARD_MODEL_NAME,
        }
        if thread_id:
            mp_fields["thread_id"] = thread_id
        if aid:
            mp_fields["assistant_id"] = aid
        if system_prompt:
            mp_fields["system_prompt"] = system_prompt
        return post_threads_messages_multipart(mp_fields, multipart_files)

    return post_threads_messages_json(fields_json)


def assistant_text(parsed: dict[str, Any]) -> str:
    return _response_assistant_text(parsed)


def upload_thread_document(thread_id: str, filename: str, data: bytes) -> dict[str, Any]:
    """POST /threads/{thread_id}/documents (multipart file field ``file``)."""
    if not BACKBOARD_API_KEY:
        raise BackboardError("BACKBOARD_API_KEY is not set.")
    boundary = f"----ArtifexDoc{uuid.uuid4().hex}"
    crlf = b"\r\n"
    safe_fn = (filename or "upload.bin").replace('"', "'").replace("\r", "").replace("\n", "")[:200]
    body_parts: list[bytes] = [
        f"--{boundary}".encode(),
        (
            f'Content-Disposition: form-data; name="file"; filename="{safe_fn}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n"
        ).encode(),
        data + crlf,
        f"--{boundary}--".encode() + crlf,
    ]
    body = b"".join(body_parts)
    url = f"{_api_root()}/threads/{thread_id}/documents"
    req = request.Request(
        url,
        data=body,
        headers={
            "X-API-Key": BACKBOARD_API_KEY,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "Artifex/1.0 (backboard-doc)",
        },
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=BACKBOARD_HTTP_TIMEOUT_SECONDS) as response:
            return _read_json_response(response.read())
    except error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:800]
        except Exception:
            detail = str(exc)
        raise BackboardError(f"Backboard document upload HTTP {exc.code}: {detail}") from exc


def get_document_status(document_id: str) -> dict[str, Any]:
    url = f"{_api_root()}/documents/{document_id}/status"
    req = request.Request(url, headers=_headers_json(), method="GET")
    try:
        with request.urlopen(req, timeout=BACKBOARD_HTTP_TIMEOUT_SECONDS) as response:
            return _read_json_response(response.read())
    except error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:800]
        except Exception:
            detail = str(exc)
        raise BackboardError(f"Backboard document status HTTP {exc.code}: {detail}") from exc


def wait_document_indexed(document_id: str, *, is_cancelled: Callable[[], bool] | None = None) -> None:
    deadline = time.monotonic() + max(1, BACKBOARD_DOCUMENT_POLL_MAX_SECONDS)
    while time.monotonic() < deadline:
        if is_cancelled and is_cancelled():
            raise BackboardError("Cancelled while waiting for Backboard document indexing.")
        st = get_document_status(document_id)
        status = (st.get("status") or "").lower()
        if status == "indexed":
            return
        if status == "error":
            msg = st.get("status_message") or st.get("message") or "unknown"
            raise BackboardError(f"Backboard document indexing error: {msg}")
        time.sleep(max(0.5, BACKBOARD_DOCUMENT_POLL_INTERVAL_SECONDS))
    raise BackboardError(f"Timed out waiting for document {document_id} to become indexed.")


def parse_json_content(text: str) -> dict[str, Any]:
    """Strip optional markdown fences and parse a JSON object."""
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\s*```$", "", t)
    return json.loads(t)
