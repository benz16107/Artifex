from __future__ import annotations

import json
import logging
import re
from typing import Any, Protocol

from app.config import (
    COMPOSIO_ALLOWED_TOOLKITS,
    COMPOSIO_API_KEY,
    COMPOSIO_DEFAULT_CALLBACK_URL,
    COMPOSIO_FETCH_TIMEOUT_SECONDS,
    COMPOSIO_TOOL_EXECUTE_VERSION,
    canonical_composio_toolkit,
    composio_feature_enabled,
)

logger = logging.getLogger(__name__)

_DRIVE_FILE_ID_RE = (
    re.compile(r"/file/d/([a-zA-Z0-9_-]+)(?:/|$|\?)"),
    re.compile(r"[?&]id=([a-zA-Z0-9_-]+)(?:&|$)"),
    re.compile(r"/open\?id=([a-zA-Z0-9_-]+)(?:&|$)"),
)


def _normalize_google_drive_file_id(raw: str) -> str:
    s = raw.strip()
    for pat in _DRIVE_FILE_ID_RE:
        m = pat.search(s)
        if m:
            return m.group(1)
    return s


# Align with spec / reference image context caps (plain text only).
_MAX_SECTION_CHARS = 4000
_MAX_TOTAL_CHARS = 8000
_MAX_SECTIONS = 12

_TOOLKIT_LABELS: dict[str, str] = {
    "googledrive": "Google Drive",
    "notion": "Notion",
}


class ComposioContextError(Exception):
    """User-facing Composio integration errors."""

    def __init__(self, message: str, *, http_status: int = 400):
        super().__init__(message)
        self.http_status = http_status


class ComposioAlreadyConnected(ComposioContextError):
    """Raised when Composio refuses a new link because an ACTIVE connection already exists."""

    def __init__(self) -> None:
        super().__init__(
            "This toolkit is already connected for this user. Use Pull into context, or use Disconnect below "
            "(or remove the connection in your Composio project) and try Connect again.",
            http_status=409,
        )


def is_configured() -> bool:
    return composio_feature_enabled()


def _client():
    if not COMPOSIO_API_KEY:
        raise ComposioContextError("Composio is not configured (missing COMPOSIO_API_KEY).", http_status=503)
    from composio import Composio

    timeout = int(max(5, min(COMPOSIO_FETCH_TIMEOUT_SECONDS, 120)))
    return Composio(api_key=COMPOSIO_API_KEY, timeout=timeout)


_GOOGLE_APPS_FOLDER_MIME = "application/vnd.google-apps.folder"


def _oauth_tools_for_new_auth_config(toolkit_slug: str) -> list[str]:
    """Tools used at auth-config creation time so Composio requests sufficient OAuth scopes."""
    if toolkit_slug == "googledrive":
        return [
            "GOOGLEDRIVE_DOWNLOAD_FILE",
            "GOOGLEDRIVE_GET_FILE_METADATA",
            "GOOGLEDRIVE_FIND_FILE",
        ]
    if toolkit_slug == "notion":
        return ["NOTION_GET_PAGE_MARKDOWN"]
    return []


def resolve_auth_config_id(composio: Any, toolkit_slug: str) -> str:
    """Resolve or create a Composio-managed auth config for a toolkit (mirrors SDK toolkits helper)."""
    lst = composio.auth_configs.list(toolkit_slug=toolkit_slug)
    items = getattr(lst, "items", None) or []
    if len(items) > 0:
        sorted_items = sorted(items, key=lambda x: str(getattr(x, "created_at", "") or ""), reverse=True)
        return sorted_items[0].id
    # Composio Python SDK: create(toolkit_slug: str, options: dict) → AuthConfig with .id
    tools = _oauth_tools_for_new_auth_config(toolkit_slug)
    created = composio.auth_configs.create(
        toolkit_slug,
        {
            "type": "use_composio_managed_auth",
            "tool_access_config": {"tools_for_connected_account_creation": tools},
        },
    )
    return created.id


def _ensure_toolkit_allowed(toolkit: str) -> str:
    slug = canonical_composio_toolkit(toolkit)
    if not slug or slug not in COMPOSIO_ALLOWED_TOOLKITS:
        raise ComposioContextError("Toolkit is not allowed for this deployment.")
    return slug


def composio_readiness() -> tuple[bool, str]:
    if not COMPOSIO_API_KEY:
        return True, "disabled"
    if not COMPOSIO_ALLOWED_TOOLKITS:
        return True, "api_key_set_no_toolkits"
    try:
        composio = _client()
        composio.toolkits.list(limit=1)
        return True, "ok"
    except Exception as exc:  # pragma: no cover - network
        logger.warning("composio readiness check failed: %s", exc)
        return False, str(exc)


def _static_toolkit_rows(*, warning: str | None = None) -> list[dict[str, Any]]:
    """Fallback rows from env only when the Composio client cannot be created."""
    rows: list[dict[str, Any]] = []
    for slug in COMPOSIO_ALLOWED_TOOLKITS:
        label = _TOOLKIT_LABELS.get(slug, slug.replace("_", " ").title())
        row: dict[str, Any] = {
            "slug": slug,
            "name": label,
            "connected": False,
            "fetch_fields": _fetch_field_hints(slug),
        }
        if warning:
            row["warning"] = warning[:800]
        rows.append(row)
    return rows


def list_toolkits_with_status(user_id: str) -> list[dict[str, Any]]:
    if not is_configured():
        return []
    try:
        composio = _client()
    except Exception as exc:
        logger.warning("composio client init failed: %s", exc)
        return _static_toolkit_rows(warning=str(exc))

    out: list[dict[str, Any]] = []
    for slug in COMPOSIO_ALLOWED_TOOLKITS:
        label = _TOOLKIT_LABELS.get(slug, slug.replace("_", " ").title())
        name = label
        connected = False
        warning: str | None = None
        try:
            try:
                info = composio.toolkits.get(slug)
                name = getattr(info, "name", None) or label
            except Exception as exc:
                logger.info("composio toolkits.get %s: %s", slug, exc)
                warning = f"Toolkit metadata unavailable: {exc}"
            try:
                acc = composio.connected_accounts.list(
                    user_ids=[user_id],
                    toolkit_slugs=[slug],
                    statuses=["ACTIVE"],
                )
                connected = bool(getattr(acc, "items", None))
            except Exception as exc:
                logger.info("composio connected_accounts.list %s: %s", slug, exc)
                extra = f"Connection status unavailable: {exc}"
                warning = f"{warning}; {extra}" if warning else extra
        except Exception as exc:
            logger.warning("composio list_toolkits slug=%s: %s", slug, exc)
            warning = str(exc)
        row: dict[str, Any] = {
            "slug": slug,
            "name": name,
            "connected": connected,
            "fetch_fields": _fetch_field_hints(slug),
        }
        if warning:
            row["warning"] = warning[:800]
        out.append(row)
    return out


def _fetch_field_hints(slug: str) -> dict[str, Any]:
    if slug == "googledrive":
        return {"required": ["file_id"], "optional": ["mime_type"]}
    if slug == "notion":
        return {"required": ["page_id"], "optional": []}
    return {"required": [], "optional": []}


def get_connection_link(user_id: str, toolkit: str, callback_url: str | None) -> dict[str, str | None]:
    from composio import exceptions as composio_exc
    from composio_client import APIStatusError

    slug = _ensure_toolkit_allowed(toolkit)
    composio = _client()
    cb = callback_url or COMPOSIO_DEFAULT_CALLBACK_URL
    try:
        auth_config_id = resolve_auth_config_id(composio, slug)
        req = composio.connected_accounts.link(
            user_id=user_id,
            auth_config_id=auth_config_id,
            callback_url=cb,
        )
    except composio_exc.ComposioMultipleConnectedAccountsError:
        raise ComposioAlreadyConnected() from None
    except Exception as exc:
        if isinstance(exc, APIStatusError):
            detail = f"Composio API HTTP {exc.status_code}: {exc.message}"
            if exc.body is not None:
                detail += f" | {str(exc.body)[:500]}"
            http_s = 502 if exc.status_code >= 500 else 400
            raise ComposioContextError(detail, http_status=http_s) from exc
        raise
    return {
        "redirect_url": req.redirect_url,
        "connection_request_id": req.id,
        "status": req.status,
    }


def disconnect_toolkit(user_id: str, toolkit: str) -> dict[str, Any]:
    """Remove Composio connected accounts for this user + toolkit (soft-delete via API)."""
    from composio_client import APIStatusError

    slug = _ensure_toolkit_allowed(toolkit)
    composio = _client()
    statuses = [
        "INITIALIZING",
        "INITIATED",
        "ACTIVE",
        "FAILED",
        "EXPIRED",
        "INACTIVE",
        "REVOKED",
    ]
    removed_ids: list[str] = []
    cursor: str | None = None
    for _ in range(60):
        kwargs: dict[str, Any] = {
            "user_ids": [user_id],
            "toolkit_slugs": [slug],
            "statuses": statuses,
            "limit": 100,
        }
        if cursor:
            kwargs["cursor"] = cursor
        try:
            acc = composio.connected_accounts.list(**kwargs)
        except Exception as exc:
            if isinstance(exc, APIStatusError):
                detail = f"Composio API HTTP {exc.status_code}: {exc.message}"
                if exc.body is not None:
                    detail += f" | {str(exc.body)[:500]}"
                http_s = 502 if exc.status_code >= 500 else 400
                raise ComposioContextError(detail, http_status=http_s) from exc
            raise
        items = getattr(acc, "items", None) or []
        for item in items:
            cid = getattr(item, "id", None)
            if not cid:
                continue
            try:
                composio.connected_accounts.delete(str(cid))
            except Exception as exc:
                if isinstance(exc, APIStatusError):
                    detail = f"Composio API HTTP {exc.status_code}: {exc.message}"
                    if exc.body is not None:
                        detail += f" | {str(exc.body)[:500]}"
                    http_s = 502 if exc.status_code >= 500 else 400
                    raise ComposioContextError(detail, http_status=http_s) from exc
                raise
            removed_ids.append(str(cid))
            logger.info("composio disconnected account id=%s toolkit=%s user_id=%s", cid, slug, user_id)
        cursor = getattr(acc, "next_cursor", None) or None
        if not cursor:
            break
    return {"removed": len(removed_ids), "connected_account_ids": removed_ids}


def _truncate_sections(sections: list[str]) -> list[str]:
    trimmed: list[str] = []
    total = 0
    for raw in sections:
        if not raw or not str(raw).strip():
            continue
        s = str(raw).strip()
        if len(s) > _MAX_SECTION_CHARS:
            s = s[: _MAX_SECTION_CHARS] + "\n…(truncated)"
        if total + len(s) > _MAX_TOTAL_CHARS:
            remain = _MAX_TOTAL_CHARS - total
            if remain <= 80:
                break
            s = s[:remain] + "\n…(truncated)"
        trimmed.append(s)
        total += len(s)
        if len(trimmed) >= _MAX_SECTIONS:
            break
    return trimmed


def _is_drive_access_denied(message: str) -> bool:
    m = message.lower()
    return "403" in m or "forbidden" in m


def _explain_drive_http_error(message: str, *, context: str = "download") -> None:
    """Raise a clearer error for Google Drive HTTP failures surfaced by Composio."""
    if not _is_drive_access_denied(message):
        return
    if context == "browse":
        raise ComposioContextError(
            "Google Drive blocked listing or search (HTTP 403). This is usually not about sharing a single file: "
            "the Google account linked in Composio needs permission to list Drive. Use “Disconnect” below (or remove "
            "the connection in the Composio dashboard), then “Connect account” again so OAuth includes search/list "
            "tools (for example GOOGLEDRIVE_FIND_FILE). If you use Google Workspace, an admin may block third-party "
            "Drive API access. "
            "You can still paste a file link and use Pull if that file is readable by the linked account.",
            http_status=403,
        ) from None
    raise ComposioContextError(
        "Google Drive refused access (HTTP 403). Usually the Google account you connected in Composio "
        "cannot read this file: open the file in Drive → Share, and add that account as Viewer (or turn on "
        "“Anyone with the link” as Viewer). If you connected Google Drive before this app requested "
        "download scopes, use “Disconnect” below or remove the connection in Composio, then “Connect account” here again.",
        http_status=403,
    ) from None


def _tool_result_payload(resp: dict[str, Any], *, drive_error_context: str = "download") -> Any:
    """Return tool `data` or raise ComposioContextError on failure."""
    if not resp.get("successful"):
        err = resp.get("error") or "Composio tool execution failed"
        _explain_drive_http_error(str(err), context=drive_error_context)
        raise ComposioContextError(str(err))
    return resp.get("data")


def _text_from_tool_result(resp: dict[str, Any]) -> str:
    data = _tool_result_payload(resp, drive_error_context="download")
    if isinstance(data, str) and data.strip():
        return data.strip()
    if isinstance(data, dict):
        for key in ("markdown", "text", "content", "body", "response", "message", "output"):
            v = data.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
        # Some tools nest file / download payloads
        for key in ("file", "file_content", "downloaded_file_content", "result"):
            v = data.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
            if isinstance(v, dict):
                for sk in ("content", "text", "data", "s3url"):
                    inner = v.get(sk)
                    if isinstance(inner, str) and inner.strip():
                        return inner.strip()
        try:
            return json.dumps(data, indent=2, default=str)
        except TypeError:
            return str(data)
    if data is None:
        return ""
    return str(data)


def _parse_drive_files_list_payload(data: Any) -> tuple[list[dict[str, Any]], str | None]:
    """Normalize GOOGLEDRIVE_FIND_FILE / files.list style body to items + nextPageToken."""
    if data is None:
        return [], None
    payload: dict[str, Any]
    if isinstance(data, str):
        s = data.strip()
        if not s:
            return [], None
        try:
            parsed = json.loads(s)
        except json.JSONDecodeError:
            return [], None
        payload = parsed if isinstance(parsed, dict) else {}
    elif isinstance(data, dict):
        payload = data
    else:
        return [], None
    files = payload.get("files")
    if not isinstance(files, list):
        files = []
    next_raw = payload.get("nextPageToken")
    next_token = str(next_raw) if next_raw else None
    items: list[dict[str, Any]] = []
    for f in files:
        if not isinstance(f, dict):
            continue
        fid = f.get("id")
        if not fid:
            continue
        mime = (f.get("mimeType") or "") or ""
        items.append(
            {
                "id": str(fid),
                "name": (f.get("name") or "").strip() or "(untitled)",
                "mime_type": mime,
                "is_folder": mime == _GOOGLE_APPS_FOLDER_MIME,
            }
        )
    return items, next_token


class FetchFn(Protocol):
    def __call__(self, composio: Any, user_id: str, body: dict[str, Any]) -> list[str]: ...


def _execute_tool(composio: Any, tool_slug: str, arguments: dict[str, Any], user_id: str) -> Any:
    """Composio SDK rejects implicit version='latest' unless dangerously_skip_version_check=True."""
    ver = (COMPOSIO_TOOL_EXECUTE_VERSION or "").strip()
    if ver and ver.lower() != "latest":
        return composio.tools.execute(
            tool_slug,
            arguments,
            user_id=user_id,
            version=ver,
            dangerously_skip_version_check=True,
        )
    return composio.tools.execute(
        tool_slug,
        arguments,
        user_id=user_id,
        dangerously_skip_version_check=True,
    )


def _browse_find_file_fallback_args(primary: dict[str, Any]) -> dict[str, Any] | None:
    """If the first FIND_FILE used shared-drive flags, retry without them (some tenants return 403)."""
    if not primary.get("includeItemsFromAllDrives") and not primary.get("supportsAllDrives"):
        return None
    fb = dict(primary)
    fb["supportsAllDrives"] = False
    fb["includeItemsFromAllDrives"] = False
    return fb


def browse_google_drive(
    user_id: str,
    *,
    folder_id: str | None,
    query: str | None,
    page_token: str | None,
    page_size: int,
) -> dict[str, Any]:
    """List Drive files via Composio (GOOGLEDRIVE_FIND_FILE) for in-app folder browse or search."""
    _ensure_toolkit_allowed("googledrive")
    composio = _client()
    size = max(1, min(max(1, page_size), 100))
    args: dict[str, Any] = {
        "pageSize": size,
        "supportsAllDrives": True,
        "includeItemsFromAllDrives": True,
    }
    if page_token and page_token.strip():
        args["pageToken"] = page_token.strip()
    q = (query or "").strip()
    if q:
        args["q"] = q
        fid = (folder_id or "").strip()
        if fid and fid != "root":
            args["folder_id"] = fid
    else:
        fid = (folder_id or "root").strip() or "root"
        args["folder_id"] = fid
        args["orderBy"] = "folder desc,name_natural"

    attempts: list[dict[str, Any]] = [args]
    fb = _browse_find_file_fallback_args(args)
    if fb is not None:
        attempts.append(fb)

    for i, ar in enumerate(attempts):
        try:
            raw_resp = _execute_tool(composio, "GOOGLEDRIVE_FIND_FILE", ar, user_id)
        except Exception as exc:
            if len(attempts) > 1 and i == 0 and _is_drive_access_denied(str(exc)):
                continue
            _explain_drive_http_error(str(exc), context="browse")
            raise
        resp_dict = dict(raw_resp) if not isinstance(raw_resp, dict) else raw_resp
        if resp_dict.get("successful"):
            data = _tool_result_payload(resp_dict, drive_error_context="browse")
            items, next_t = _parse_drive_files_list_payload(data)
            return {"items": items, "next_page_token": next_t}
        err = str(resp_dict.get("error") or "")
        if len(attempts) > 1 and i == 0 and _is_drive_access_denied(err):
            continue
        _tool_result_payload(resp_dict, drive_error_context="browse")
    raise ComposioContextError("Drive browse failed unexpectedly.", http_status=502)


def _fetch_googledrive(composio: Any, user_id: str, body: dict[str, Any]) -> list[str]:
    raw = (body.get("file_id") or body.get("fileId") or "").strip()
    file_id = _normalize_google_drive_file_id(raw) if raw else ""
    if not file_id:
        raise ComposioContextError("file_id is required for Google Drive.")
    mime_type = (body.get("mime_type") or body.get("mimeType") or "").strip() or None
    args: dict[str, Any] = {"fileId": file_id}
    if mime_type:
        args["mime_type"] = mime_type
    try:
        resp = _execute_tool(composio, "GOOGLEDRIVE_DOWNLOAD_FILE", args, user_id)
    except Exception as exc:
        _explain_drive_http_error(str(exc))
        raise
    text = _text_from_tool_result(dict(resp))
    title = f"Google Drive file {file_id}"
    return [f"{title}\n\n{text}".strip()] if text else [title]


def _fetch_notion(composio: Any, user_id: str, body: dict[str, Any]) -> list[str]:
    page_id = (body.get("page_id") or body.get("pageId") or "").strip()
    if not page_id:
        raise ComposioContextError("page_id is required for Notion.")
    args: dict[str, Any] = {"page_id": page_id}
    if "include_transcript" in body:
        args["include_transcript"] = bool(body.get("include_transcript"))
    resp = _execute_tool(composio, "NOTION_GET_PAGE_MARKDOWN", args, user_id)
    text = _text_from_tool_result(dict(resp))
    title = f"Notion page {page_id}"
    return [f"{title}\n\n{text}".strip()] if text else [title]


_FETCH_REGISTRY: dict[str, FetchFn] = {
    "googledrive": _fetch_googledrive,
    "notion": _fetch_notion,
}


def fetch_context(user_id: str, toolkit: str, body: dict[str, Any]) -> list[str]:
    slug = _ensure_toolkit_allowed(toolkit)
    fn = _FETCH_REGISTRY.get(slug)
    if fn is None:
        raise ComposioContextError(f"No fetch adapter is registered for toolkit {slug!r}.")
    composio = _client()
    sections = fn(composio, user_id, body)
    return _truncate_sections(sections)
