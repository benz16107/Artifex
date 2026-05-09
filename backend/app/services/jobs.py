from __future__ import annotations

import json
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
    current = read_job(job_id)
    if current is None:
        raise FileNotFoundError(f"Unknown job_id: {job_id}")
    if current["status"] in {"completed", "failed", "cancelled"}:
        return current
    updates: dict[str, Any] = {"cancel_requested": True}
    if current["status"] in {"queued", "awaiting_concept_confirmation"}:
        updates["status"] = "cancelled"
    return update_job(job_id, updates)


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
