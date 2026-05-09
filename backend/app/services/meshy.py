from __future__ import annotations

import base64
import json
import logging
import time
from pathlib import Path
from urllib import error, request

from app.config import MESHY_AI_MODEL, MESHY_API_KEY

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


def create_image_to_3d_task(*, image_path: Path, target_formats: list[str]) -> str:
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
        with request.urlopen(req, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
    except error.URLError as exc:
        raise MeshyError(f"Meshy create task failed (network): {exc}") from exc
    except error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8", errors="replace")
        except Exception:
            detail = str(exc)
        raise MeshyError(f"Meshy create task failed: HTTP {getattr(exc, 'code', '?')}: {detail}") from exc
    task_id = body.get("result")
    if not task_id:
        raise MeshyError("Meshy create task did not return a task id.")
    logger.info("meshy_task_created task_id=%s", task_id)
    return str(task_id)


def get_task(task_id: str) -> dict:
    _require_key()
    url = f"https://api.meshy.ai/openapi/v1/image-to-3d/{task_id}"
    req = request.Request(
        url,
        headers={"Authorization": f"Bearer {MESHY_API_KEY}"},
        method="GET",
    )
    try:
        with request.urlopen(req, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.URLError as exc:
        raise MeshyError(f"Meshy task status request failed (network): {exc}") from exc


def wait_for_task(task_id: str, *, timeout_seconds: int = 900, poll_seconds: float = 3.0) -> dict:
    t0 = time.time()
    last_log = t0

    while True:
        task = get_task(task_id)
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
        time.sleep(poll_seconds)


def download_to(url: str, path: Path) -> None:
    req = request.Request(url, method="GET")
    try:
        with request.urlopen(req, timeout=120) as response:
            path.write_bytes(response.read())
    except error.URLError as exc:
        raise MeshyError(f"Meshy asset download failed (network): {exc}") from exc


def run_image_to_3d(*, image_path: Path, output_dir: Path, target_formats: list[str] | None = None) -> dict[str, Path]:
    """
    Runs Meshy image->3D and writes selected formats under output_dir (see _MESHY_OUTPUT_FILENAMES),
    plus preview.png when Meshy returns thumbnail_url.
    """
    formats = normalize_meshy_target_formats(target_formats)
    task_id = create_image_to_3d_task(image_path=image_path, target_formats=formats)
    task = wait_for_task(task_id)
    status = str(task.get("status", "")).upper()
    if status != "SUCCEEDED":
        message = ((task.get("task_error") or {}) or {}).get("message") or "unknown error"
        raise MeshyError(f"Meshy image-to-3d failed: {message}")

    model_urls = task.get("model_urls") or {}
    thumb_url = task.get("thumbnail_url")
    out: dict[str, Path] = {}

    for fmt in formats:
        file_url = model_urls.get(fmt)
        if not file_url:
            raise MeshyError(f"Meshy task succeeded but no {fmt.upper()} url was returned.")
        fname = _MESHY_OUTPUT_FILENAMES[fmt]
        dest = output_dir / fname
        download_to(file_url, dest)
        out[fmt] = dest

    if "obj" in formats:
        mtl_url = model_urls.get("mtl")
        if mtl_url:
            mtl_path = output_dir / "meshy_model.mtl"
            download_to(mtl_url, mtl_path)
            out["mtl"] = mtl_path

    preview_path = output_dir / "preview.png"
    if thumb_url:
        download_to(thumb_url, preview_path)
        out["preview"] = preview_path
    return out

