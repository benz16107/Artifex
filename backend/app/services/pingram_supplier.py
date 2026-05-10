"""Server-side outbound email to suppliers via Pingram (https://www.pingram.io/)."""

from __future__ import annotations

import hashlib
import html
import json
import logging
import re
import urllib.error
import urllib.request
from typing import Any

_logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def validate_supplier_email(addr: str) -> str | None:
    """Return normalized email or None if invalid."""
    s = (addr or "").strip().lower()
    if len(s) > 254 or not _EMAIL_RE.match(s):
        return None
    return s


def pingram_readiness(api_key: str | None, base_url: str) -> tuple[bool, str]:
    if not (api_key or "").strip():
        return False, "PINGRAM_API_KEY is not set."
    if not (base_url or "").strip().startswith("https://"):
        return False, "PINGRAM_BASE_URL must be an https URL."
    return True, "Pingram supplier email is configured."


def _recipient_user_id(job_id: str, to_email: str) -> str:
    raw = f"{job_id}|{to_email}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:48]


def send_supplier_email(
    *,
    api_key: str,
    base_url: str,
    notification_type: str,
    job_id: str,
    to_email: str,
    subject: str,
    message_plain: str,
    product_name: str | None,
    company: str | None,
) -> dict[str, Any]:
    """
    POST /send with inline email. Returns parsed JSON on success (expects trackingId).
    Raises ValueError with a user-safe message on failure.
    """
    to = validate_supplier_email(to_email)
    if not to:
        raise ValueError("Invalid supplier email address.")

    subj = (subject or "").strip()
    if not subj or len(subj) > 200:
        raise ValueError("Subject must be between 1 and 200 characters.")

    body = (message_plain or "").strip()
    if not body or len(body) > 16_000:
        raise ValueError("Message must be between 1 and 16,000 characters.")

    ntype = (notification_type or "").strip() or "artifex_supplier_inquiry"
    if len(ntype) > 120:
        raise ValueError("Invalid notification type configuration.")

    safe_body = html.escape(body, quote=True)
    safe_product = html.escape((product_name or "").strip() or "—", quote=True)
    safe_company = html.escape((company or "").strip() or "—", quote=True)
    footer = (
        "<hr style=\"border:none;border-top:1px solid #ddd;margin:20px 0\" />"
        "<p style=\"font-size:12px;color:#666;line-height:1.5\">"
        f"This message was sent from <strong>Artifex</strong> using Pingram.<br />"
        f"Run ID: <code>{html.escape(job_id, quote=True)}</code><br />"
        f"Product (from spec): {safe_product}<br />"
        f"Workspace company: {safe_company}"
        "</p>"
    )
    html_content = (
        f"<div style=\"font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.55;color:#222\">"
        f"<p style=\"white-space:pre-wrap;margin:0 0 12px\">{safe_body}</p>{footer}</div>"
    )

    payload: dict[str, Any] = {
        "type": ntype,
        "to": {"id": _recipient_user_id(job_id, to), "email": to},
        "forceChannels": ["EMAIL"],
        "email": {"subject": subj, "html": html_content},
    }

    url = f"{base_url.rstrip('/')}/send"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key.strip()}",
            "User-Agent": "Artifex/1.0 (supplier-contact)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace").strip()
        _logger.warning("pingram_send_http status=%s body=%s", e.code, detail[:500])
        try:
            parsed = json.loads(detail) if detail else {}
            msg = str(parsed.get("message") or parsed.get("detail") or parsed.get("error") or "").strip()
        except json.JSONDecodeError:
            msg = ""
        raise ValueError(msg or f"Pingram returned HTTP {e.code}.") from e
    except urllib.error.URLError as e:
        _logger.warning("pingram_send_url_err err=%s", e)
        raise ValueError("Could not reach Pingram. Check PINGRAM_BASE_URL and network.") from e

    try:
        out = json.loads(raw) if raw else {}
    except json.JSONDecodeError as e:
        raise ValueError("Unexpected response from Pingram.") from e

    if not isinstance(out, dict):
        raise ValueError("Unexpected response from Pingram.")
    return out
