from __future__ import annotations

import json
import re
import shutil
import tempfile
import time
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

try:
    import fcntl
except ImportError:
    fcntl = None  # Windows / minimal environments: no cross-process lock

from app.config import JOB_METADATA_FILENAME, OUTPUTS_DIR


class CancelledGeneration(Exception):
    """Raised when the user cancels during long-running image or mesh work (cooperative abort)."""


_JOB_ID_RE = re.compile(r"^job_[0-9a-f]{10}$")


def is_safe_job_id(job_id: str) -> bool:
    return bool(_JOB_ID_RE.match(job_id))


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _job_dir(job_id: str) -> Path:
    return OUTPUTS_DIR / job_id


def create_job(
    prompt: str,
    user_id: str = "anonymous",
    *,
    mode: str | None = None,
    company: str | None = None,
    documents: list[str] | None = None,
    fast_reference_images: bool = False,
) -> dict[str, Any]:
    job_id = f"job_{uuid.uuid4().hex[:10]}"
    path = _job_dir(job_id)
    path.mkdir(parents=True, exist_ok=True)
    data = {
        "job_id": job_id,
        "status": "queued",
        "user_id": user_id,
        "prompt": prompt,
        "mode": mode or "concept",
        "company": company,
        "documents": documents or [],
        "fast_reference_images": bool(fast_reference_images),
        "created_at": _utc_now(),
        "updated_at": _utc_now(),
        "spec": None,
        "files": {},
        "error": None,
        "warnings": [],
        "stage_durations_ms": {},
        "queue": {},
        "cancel_requested": False,
        "generation_phase": None,
        "concept_references": None,
        "concept_styles": None,
        "selected_concept_style_index": 0,
        "concept_generation_style_index": None,
        "research_digest": None,
        "research_sources": None,
        "research_brief": None,
        "research_warnings": [],
        "image_generation_preview": None,
        "backboard_thread_id": None,
        "backboard_assistant_id": None,
    }
    _write(path / JOB_METADATA_FILENAME, data)
    return data


def read_job(job_id: str) -> dict[str, Any] | None:
    path = _job_dir(job_id) / JOB_METADATA_FILENAME
    if not path.exists():
        return None
    for _ in range(5):
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            # Another thread may be replacing metadata atomically; retry briefly.
            time.sleep(0.01)
    return json.loads(path.read_text())


def update_job(job_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    current = read_job(job_id)
    if current is None:
        raise FileNotFoundError(f"Unknown job_id: {job_id}")
    current.update(updates)
    current["updated_at"] = _utc_now()
    _write(_job_dir(job_id) / JOB_METADATA_FILENAME, current)
    return current


def request_cancel(job_id: str) -> dict[str, Any]:
    """Serialize with workers so a cancel cannot be overwritten by a queued→running transition."""
    with job_lock(job_id):
        current = read_job(job_id)
        if current is None:
            raise FileNotFoundError(f"Unknown job_id: {job_id}")
        if current["status"] in {"completed", "failed", "cancelled"}:
            return current
        updates: dict[str, Any] = {"cancel_requested": True}
        if current["status"] in {"queued", "awaiting_concept_confirmation", "awaiting_image_generation_preview"}:
            updates["status"] = "cancelled"
        current.update(updates)
        current["updated_at"] = _utc_now()
        _write(_job_dir(job_id) / JOB_METADATA_FILENAME, current)
        return current


def job_output_dir(job_id: str) -> Path:
    path = _job_dir(job_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


@contextmanager
def job_lock(job_id: str):
    """Exclusive lock per job directory (POSIX). Prevents duplicate concept continuation races."""
    if fcntl is None:
        yield
        return
    lock_path = _job_dir(job_id) / ".job_lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "w") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _write(path: Path, data: dict[str, Any]) -> None:
    with tempfile.NamedTemporaryFile("w", dir=str(path.parent), delete=False) as temp_file:
        temp_file.write(json.dumps(data, indent=2))
        temp_path = Path(temp_file.name)
    temp_path.replace(path)


def delete_job_artifacts(job_id: str) -> None:
    """Remove the job output directory and all artifacts (metadata, meshes, locks)."""
    if not is_safe_job_id(job_id):
        raise ValueError("Invalid job_id")
    path = _job_dir(job_id)
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
