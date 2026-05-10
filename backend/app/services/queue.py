from __future__ import annotations

from dataclasses import dataclass
from threading import Thread

from app.config import QUEUE_BACKEND, REDIS_URL, RQ_QUEUE_NAME
from app.services.jobs import read_job
from app.services.worker import (
    add_concept_style_job,
    confirm_image_generation_job,
    continue_concept_job,
    process_job,
    regenerate_concept_references_job,
    regenerate_mesh_job,
)


@dataclass(frozen=True)
class EnqueueResult:
    backend: str
    task_id: str | None = None


def enqueue_generate_prompt(job_id: str, prompt: str) -> EnqueueResult:
    if QUEUE_BACKEND == "rq":
        return _enqueue_rq("app.services.worker.process_job", job_id, prompt)
    Thread(target=process_job, args=(job_id, prompt), daemon=True).start()
    return EnqueueResult(backend="inline")


def enqueue_continue_concept(job_id: str) -> EnqueueResult:
    if QUEUE_BACKEND == "rq":
        return _enqueue_rq("app.services.worker.continue_concept_job", job_id)
    Thread(target=continue_concept_job, args=(job_id,), daemon=True).start()
    return EnqueueResult(backend="inline")


def enqueue_confirm_image_generation(job_id: str) -> EnqueueResult:
    if QUEUE_BACKEND == "rq":
        return _enqueue_rq("app.services.worker.confirm_image_generation_job", job_id)
    Thread(target=confirm_image_generation_job, args=(job_id,), daemon=True).start()
    return EnqueueResult(backend="inline")


def enqueue_regenerate_concept_references(job_id: str) -> EnqueueResult:
    if QUEUE_BACKEND == "rq":
        return _enqueue_rq("app.services.worker.regenerate_concept_references_job", job_id)
    Thread(target=regenerate_concept_references_job, args=(job_id,), daemon=True).start()
    return EnqueueResult(backend="inline")


def enqueue_add_concept_style(job_id: str, variation_detail_prompt: str | None = None) -> EnqueueResult:
    if QUEUE_BACKEND == "rq":
        return _enqueue_rq("app.services.worker.add_concept_style_job", job_id, variation_detail_prompt)
    Thread(target=add_concept_style_job, args=(job_id, variation_detail_prompt), daemon=True).start()
    return EnqueueResult(backend="inline")


def enqueue_regenerate_mesh(job_id: str) -> EnqueueResult:
    if QUEUE_BACKEND == "rq":
        return _enqueue_rq("app.services.worker.regenerate_mesh_job", job_id)
    Thread(target=regenerate_mesh_job, args=(job_id,), daemon=True).start()
    return EnqueueResult(backend="inline")


def _enqueue_rq(func_path: str, *args) -> EnqueueResult:
    try:
        from redis import Redis
        from rq import Queue
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("RQ backend requires rq and redis packages.") from exc

    connection = Redis.from_url(REDIS_URL)
    queue = Queue(RQ_QUEUE_NAME, connection=connection, default_timeout="20m")
    job = queue.enqueue(func_path, *args)
    return EnqueueResult(backend="rq", task_id=job.id)


def cancel_enqueued_job_if_possible(job_id: str) -> bool:
    if QUEUE_BACKEND != "rq":
        return False
    job = read_job(job_id)
    if not job:
        return False
    task_id = (job.get("queue") or {}).get("task_id")
    if not task_id:
        return False
    try:
        from redis import Redis
        from rq import cancel_job
    except ImportError:  # pragma: no cover
        return False
    try:
        connection = Redis.from_url(REDIS_URL)
        cancel_job(task_id, connection=connection)
        return True
    except Exception:  # pragma: no cover
        return False


def queue_readiness() -> tuple[bool, str]:
    if QUEUE_BACKEND != "rq":
        return True, "inline queue mode"
    try:
        from redis import Redis
        connection = Redis.from_url(REDIS_URL)
        connection.ping()
        return True, f"rq ready on {REDIS_URL}"
    except Exception as exc:  # pragma: no cover
        return False, f"rq not ready: {exc}"
