from __future__ import annotations

import base64
import errno
import json
import logging
import time
from collections.abc import Callable
from pathlib import Path
from urllib import error, request

from app.config import MESHY_AI_MODEL, MESHY_API_KEY, MESHY_HTTP_RETRIES, MESHY_HTTP_TIMEOUT_SECONDS
from app.services.jobs import CancelledGeneration

logger = logging.getLogger("object-first-mvp")

# Image-to-3D `target_formats` (Meshy OpenAPI). Order preserved after normalize.
MESHY_EXPORT_FORMATS: frozenset[str] = frozenset({"glb", "obj", "fbx", "stl", "usdz", "3mf"})

# Local filenames (Meshy STL kept distinct from any legacy `model.stl` name).
_MESHY_OUTPUT_FILENAMES: dict[str, str] = {
    "glb": "model.glb",
    "stl": "meshy_scan.stl",
    "obj": "meshy_model.obj",
    "fbx": "meshy_model.fbx",
    "usdz": "meshy_model.usdz",
    "3mf": "meshy_model.3mf",
}


class MeshyError(Exception):
    pass


def _retryable_meshy_url_error(exc: error.URLError) -> bool:
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


def _meshy_http_read(
    req: request.Request,
    *,
    context: str,
    is_cancelled: Callable[[], bool] | None = None,
) -> bytes:
    """GET/POST with retries for transient network errors and retryable HTTP status codes."""
    attempts = max(1, 1 + max(0, MESHY_HTTP_RETRIES))
    backoff_s = 2.0
    timeout = float(MESHY_HTTP_TIMEOUT_SECONDS)
    for attempt in range(attempts):
        if is_cancelled is not None and is_cancelled():
            raise CancelledGeneration("Meshy request aborted (cancel requested).")
        try:
            with request.urlopen(req, timeout=timeout) as response:
                return response.read()
        except error.HTTPError as exc:
            code = getattr(exc, "code", 0) or 0
            if code in (408, 429, 500, 502, 503, 504) and attempt < attempts - 1:
                logger.warning(
                    "meshy_http_retry context=%s attempt=%s/%s http=%s",
                    context,
                    attempt + 1,
                    attempts,
                    code,
                )
                if is_cancelled is not None and is_cancelled():
                    raise CancelledGeneration("Meshy request aborted (cancel requested).")
                time.sleep(backoff_s)
                backoff_s = min(backoff_s * 2.0, 60.0)
                continue
            try:
                detail = exc.read().decode("utf-8", errors="replace")
            except Exception:
                detail = str(exc)
            raise MeshyError(f"Meshy {context} failed: HTTP {code}: {detail}") from exc
        except error.URLError as exc:
            if attempt < attempts - 1 and _retryable_meshy_url_error(exc):
                logger.warning(
                    "meshy_http_retry context=%s attempt=%s/%s reason=%r",
                    context,
                    attempt + 1,
                    attempts,
                    exc.reason,
                )
                if is_cancelled is not None and is_cancelled():
                    raise CancelledGeneration("Meshy request aborted (cancel requested).")
                time.sleep(backoff_s)
                backoff_s = min(backoff_s * 2.0, 60.0)
                continue
            hint = ""
            if _retryable_meshy_url_error(exc):
                hint = (
                    " Transient errors persisted after "
                    f"{attempts} attempt(s) (per-attempt timeout {MESHY_HTTP_TIMEOUT_SECONDS}s). "
                    "Try MESHY_HTTP_TIMEOUT_SECONDS=180 or MESHY_HTTP_RETRIES=6; check VPN/firewall and api.meshy.ai reachability."
                )
            raise MeshyError(f"Meshy {context} failed (network): {exc}{hint}") from exc
    raise MeshyError(f"Meshy {context} failed after retries.")  # pragma: no cover


def normalize_meshy_target_formats(formats: list[str] | None) -> list[str]:
    """Dedupe, validate, and return a non-empty list for Meshy `target_formats`."""
    if not formats:
        return ["glb"]
    out: list[str] = []
    seen: set[str] = set()
    for raw in formats:
        fmt = str(raw).lower().strip()
        if fmt not in MESHY_EXPORT_FORMATS:
            allowed = ", ".join(sorted(MESHY_EXPORT_FORMATS))
            raise ValueError(f"Unsupported Meshy format {raw!r}. Allowed: {allowed}.")
        if fmt not in seen:
            seen.add(fmt)
            out.append(fmt)
    if not out:
        raise ValueError("Select at least one Meshy export format.")
    return out


def _require_key() -> None:
    if not MESHY_API_KEY:
        raise ValueError("MESHY_API_KEY is not set (required for concept mode).")


def _as_data_uri_png(path: Path) -> str:
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def create_image_to_3d_task(
    *,
    image_path: Path,
    target_formats: list[str],
    is_cancelled: Callable[[], bool] | None = None,
) -> str:
    _require_key()
    url = "https://api.meshy.ai/openapi/v1/image-to-3d"
    payload = {
        "image_url": _as_data_uri_png(image_path),
        "model_type": "standard",
        "ai_model": MESHY_AI_MODEL,
        "should_texture": True,
        "enable_pbr": False,
        "target_formats": target_formats,
    }
    req = request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {MESHY_API_KEY}",
        },
        method="POST",
    )
    try:
        raw = _meshy_http_read(req, context="create task", is_cancelled=is_cancelled)
        body = json.loads(raw.decode("utf-8"))
    except CancelledGeneration:
        raise
    except MeshyError:
        raise
    except json.JSONDecodeError as exc:
        raise MeshyError(f"Meshy create task returned invalid JSON: {exc}") from exc
    task_id = body.get("result")
    if not task_id:
        raise MeshyError("Meshy create task did not return a task id.")
    logger.info("meshy_task_created task_id=%s", task_id)
    return str(task_id)


def get_task(task_id: str, *, is_cancelled: Callable[[], bool] | None = None) -> dict:
    _require_key()
    url = f"https://api.meshy.ai/openapi/v1/image-to-3d/{task_id}"
    req = request.Request(
        url,
        headers={"Authorization": f"Bearer {MESHY_API_KEY}"},
        method="GET",
    )
    raw = _meshy_http_read(req, context="task status", is_cancelled=is_cancelled)
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise MeshyError(f"Meshy task status returned invalid JSON: {exc}") from exc


def wait_for_task(
    task_id: str,
    *,
    timeout_seconds: int = 900,
    poll_seconds: float = 3.0,
    is_cancelled: Callable[[], bool] | None = None,
) -> dict:
    t0 = time.time()
    last_log = t0

    while True:
        if is_cancelled is not None and is_cancelled():
            raise CancelledGeneration("Meshy image-to-3d stopped (cancel requested).")
        task = get_task(task_id, is_cancelled=is_cancelled)
        status = str(task.get("status", "")).upper()
        if status in {"SUCCEEDED", "FAILED", "CANCELED"}:
            return task
        if (time.time() - t0) > timeout_seconds:
            raise MeshyError("Meshy image-to-3d timed out.")
        now = time.time()
        if now - last_log >= 20.0:
            prog = task.get("progress")
            logger.info(
                "meshy_poll task_id=%s status=%s progress=%s elapsed_s=%d",
                task_id,
                status or "?",
                prog,
                int(now - t0),
            )
            last_log = now
        if is_cancelled is not None and is_cancelled():
            raise CancelledGeneration("Meshy image-to-3d stopped (cancel requested).")
        time.sleep(poll_seconds)


def download_to(url: str, path: Path, *, is_cancelled: Callable[[], bool] | None = None) -> None:
    req = request.Request(url, method="GET")
    path.write_bytes(_meshy_http_read(req, context="asset download", is_cancelled=is_cancelled))


def run_image_to_3d(
    *,
    image_path: Path,
    output_dir: Path,
    target_formats: list[str] | None = None,
    is_cancelled: Callable[[], bool] | None = None,
) -> dict[str, Path]:
    """
    Runs Meshy image->3D and writes selected formats under output_dir (see _MESHY_OUTPUT_FILENAMES),
    plus preview.png when Meshy returns thumbnail_url.
    """
    formats = normalize_meshy_target_formats(target_formats)
    task_id = create_image_to_3d_task(image_path=image_path, target_formats=formats, is_cancelled=is_cancelled)
    task = wait_for_task(task_id, is_cancelled=is_cancelled)
    status = str(task.get("status", "")).upper()
    if status != "SUCCEEDED":
        message = ((task.get("task_error") or {}) or {}).get("message") or "unknown error"
        raise MeshyError(f"Meshy image-to-3d failed: {message}")

    model_urls = task.get("model_urls") or {}
    thumb_url = task.get("thumbnail_url")
    out: dict[str, Path] = {}

    for fmt in formats:
        if is_cancelled is not None and is_cancelled():
            raise CancelledGeneration("Meshy downloads stopped (cancel requested).")
        file_url = model_urls.get(fmt)
        if not file_url:
            raise MeshyError(f"Meshy task succeeded but no {fmt.upper()} url was returned.")
        fname = _MESHY_OUTPUT_FILENAMES[fmt]
        dest = output_dir / fname
        download_to(file_url, dest, is_cancelled=is_cancelled)
        out[fmt] = dest

    if "obj" in formats:
        mtl_url = model_urls.get("mtl")
        if mtl_url:
            if is_cancelled is not None and is_cancelled():
                raise CancelledGeneration("Meshy downloads stopped (cancel requested).")
            mtl_path = output_dir / "meshy_model.mtl"
            download_to(mtl_url, mtl_path, is_cancelled=is_cancelled)
            out["mtl"] = mtl_path

    preview_path = output_dir / "preview.png"
    if thumb_url:
        if is_cancelled is not None and is_cancelled():
            raise CancelledGeneration("Meshy downloads stopped (cancel requested).")
        download_to(thumb_url, preview_path, is_cancelled=is_cancelled)
        out["preview"] = preview_path
    return out

