from __future__ import annotations

import json
import logging
import re
from typing import Any

from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from pydantic import BaseModel, Field, ValidationError, field_validator

from app.config import COMPOSIO_DEFAULT_CALLBACK_URL, composio_oauth_callback_prefixes
from app.services import composio_context
from app.views_api import _authenticate_or_response, _json_error

logger = logging.getLogger(__name__)

_DRIVE_FILE_ID_PATTERNS = (
    re.compile(r"/file/d/([a-zA-Z0-9_-]+)(?:/|$|\?)"),
    re.compile(r"[?&]id=([a-zA-Z0-9_-]+)(?:&|$)"),
    re.compile(r"/open\?id=([a-zA-Z0-9_-]+)(?:&|$)"),
)


def _extract_google_drive_file_id(raw: str) -> str:
    s = raw.strip()
    for pat in _DRIVE_FILE_ID_PATTERNS:
        m = pat.search(s)
        if m:
            return m.group(1)
    return s


class ComposioConnectBody(BaseModel):
    toolkit: str = Field(min_length=2, max_length=64)
    callback_url: str | None = Field(default=None, max_length=2048)


class ComposioDisconnectBody(BaseModel):
    toolkit: str = Field(min_length=2, max_length=64)


class ComposioDriveBrowseBody(BaseModel):
    """Browse or search the connected user's Google Drive via Composio."""

    folder_id: str | None = Field(default=None, max_length=128)
    query: str | None = Field(default=None, max_length=500)
    page_token: str | None = Field(default=None, max_length=4096)
    page_size: int = Field(default=40, ge=1, le=100)


class ComposioFetchBody(BaseModel):
    toolkit: str = Field(min_length=2, max_length=64)
    # Accept full Drive URLs before `before` validators shrink to the id.
    file_id: str | None = Field(default=None, max_length=2048)
    mime_type: str | None = Field(default=None, max_length=200)
    page_id: str | None = Field(default=None, max_length=128)
    include_transcript: bool | None = None

    @field_validator("file_id", mode="before")
    @classmethod
    def drive_file_id(cls, v: object) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            return v
        s = v.strip()
        if not s:
            return None
        if s.startswith("{") and ("detail" in s or '"detail"' in s):
            raise ValueError(
                "That value looks like a JSON error, not an id. Paste the Google Drive link or only the "
                "file id from between /d/ and /view."
            )
        extracted = _extract_google_drive_file_id(s)
        if len(extracted) > 128:
            raise ValueError("Drive file id is too long after parsing the URL.")
        return extracted

    @field_validator("page_id", mode="before")
    @classmethod
    def notion_page_id(cls, v: object) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            return v
        s = v.strip()
        if not s:
            return None
        if s.startswith("{") and ("detail" in s or '"detail"' in s):
            raise ValueError(
                "That value looks like a JSON error, not a Notion page id. Paste the page UUID from the URL."
            )
        return s


def _effective_callback_url(requested: str | None) -> str | None:
    prefixes = composio_oauth_callback_prefixes()
    if requested and requested.strip():
        u = requested.strip()
        if prefixes:
            if not any(u.startswith(p) for p in prefixes):
                raise ValueError(
                    "callback_url must start with one of the prefixes in COMPOSIO_OAUTH_CALLBACK_URL_PREFIXES.",
                )
            return u
        return COMPOSIO_DEFAULT_CALLBACK_URL
    return COMPOSIO_DEFAULT_CALLBACK_URL


@require_http_methods(["GET"])
def composio_toolkits(request: HttpRequest) -> JsonResponse:
    auth = _authenticate_or_response(request)
    if isinstance(auth, JsonResponse):
        return auth
    if not composio_context.is_configured():
        return JsonResponse({"enabled": False, "toolkits": []}, safe=False)
    try:
        toolkits = composio_context.list_toolkits_with_status(auth)
    except composio_context.ComposioContextError as exc:
        return _json_error(str(exc), exc.http_status)
    except Exception as exc:  # pragma: no cover
        logger.exception("composio toolkits failed")
        return _json_error(f"Composio error: {exc}", 502)
    return JsonResponse({"enabled": True, "toolkits": toolkits}, safe=False)


@csrf_exempt
@require_http_methods(["POST"])
def composio_connect(request: HttpRequest) -> JsonResponse:
    auth = _authenticate_or_response(request)
    if isinstance(auth, JsonResponse):
        return auth
    if not composio_context.is_configured():
        return _json_error("Composio is not enabled.", 404)
    try:
        body = json.loads(request.body.decode() or "{}")
        payload = ComposioConnectBody.model_validate(body)
    except (json.JSONDecodeError, ValidationError) as e:
        if isinstance(e, ValidationError):
            return JsonResponse({"detail": e.errors()}, status=422)
        return _json_error("Invalid JSON body", 400)
    try:
        cb = _effective_callback_url(payload.callback_url)
        data = composio_context.get_connection_link(auth, payload.toolkit, cb)
    except composio_context.ComposioAlreadyConnected as exc:
        return JsonResponse(
            {"detail": str(exc), "already_connected": True},
            status=exc.http_status,
        )
    except composio_context.ComposioContextError as exc:
        return _json_error(str(exc), exc.http_status)
    except ValueError as exc:
        return _json_error(str(exc), 400)
    except Exception as exc:  # pragma: no cover
        logger.exception("composio connect failed")
        return _json_error(f"Composio error: {exc}", 502)
    return JsonResponse(data, safe=False)


@csrf_exempt
@require_http_methods(["POST"])
def composio_disconnect(request: HttpRequest) -> JsonResponse:
    auth = _authenticate_or_response(request)
    if isinstance(auth, JsonResponse):
        return auth
    if not composio_context.is_configured():
        return _json_error("Composio is not enabled.", 404)
    try:
        raw = json.loads(request.body.decode() or "{}")
        payload = ComposioDisconnectBody.model_validate(raw)
    except (json.JSONDecodeError, ValidationError) as e:
        if isinstance(e, ValidationError):
            return JsonResponse({"detail": e.errors()}, status=422)
        return _json_error("Invalid JSON body", 400)
    try:
        data = composio_context.disconnect_toolkit(auth, payload.toolkit)
    except composio_context.ComposioContextError as exc:
        return _json_error(str(exc), exc.http_status)
    except Exception as exc:  # pragma: no cover
        logger.exception("composio disconnect failed")
        return _json_error(f"Composio error: {exc}", 502)
    return JsonResponse(data, safe=False)


@csrf_exempt
@require_http_methods(["POST"])
def composio_fetch(request: HttpRequest) -> JsonResponse:
    auth = _authenticate_or_response(request)
    if isinstance(auth, JsonResponse):
        return auth
    if not composio_context.is_configured():
        return _json_error("Composio is not enabled.", 404)
    try:
        raw = json.loads(request.body.decode() or "{}")
        payload = ComposioFetchBody.model_validate(raw)
    except (json.JSONDecodeError, ValidationError) as e:
        if isinstance(e, ValidationError):
            return JsonResponse({"detail": e.errors()}, status=422)
        return _json_error("Invalid JSON body", 400)
    body: dict[str, Any] = payload.model_dump(exclude_none=True)
    try:
        sections = composio_context.fetch_context(auth, payload.toolkit, body)
    except composio_context.ComposioContextError as exc:
        return _json_error(str(exc), exc.http_status)
    except Exception as exc:  # pragma: no cover
        logger.exception("composio fetch failed")
        return _json_error(f"Composio error: {exc}", 502)
    return JsonResponse({"sections": sections}, safe=False)


@csrf_exempt
@require_http_methods(["POST"])
def composio_drive_browse(request: HttpRequest) -> JsonResponse:
    auth = _authenticate_or_response(request)
    if isinstance(auth, JsonResponse):
        return auth
    if not composio_context.is_configured():
        return _json_error("Composio is not enabled.", 404)
    try:
        raw = json.loads(request.body.decode() or "{}")
        payload = ComposioDriveBrowseBody.model_validate(raw)
    except (json.JSONDecodeError, ValidationError) as e:
        if isinstance(e, ValidationError):
            return JsonResponse({"detail": e.errors()}, status=422)
        return _json_error("Invalid JSON body", 400)
    try:
        data = composio_context.browse_google_drive(
            auth,
            folder_id=payload.folder_id,
            query=payload.query,
            page_token=payload.page_token,
            page_size=payload.page_size,
        )
    except composio_context.ComposioContextError as exc:
        return _json_error(str(exc), exc.http_status)
    except Exception as exc:  # pragma: no cover
        logger.exception("composio drive browse failed")
        return _json_error(f"Composio error: {exc}", 502)
    return JsonResponse(data, safe=False)
