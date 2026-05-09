from __future__ import annotations

import json
from typing import Any

from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from pydantic import ValidationError

from app.config import API_AUTH_TOKEN, DEFAULT_USER_ID, QUEUE_BACKEND, STORAGE_BACKEND
from app.services import composio_context
from app.schemas.api import (
    CancelJobResponse,
    ConfirmConceptRequest,
    GenerateRequest,
    GenerateResponse,
    JobResponse,
)
from app.services.jobs import create_job, read_job, request_cancel, update_job
from app.services.queue import (
    cancel_enqueued_job_if_possible,
    enqueue_continue_concept,
    enqueue_generate_prompt,
    queue_readiness,
)
from app.services.storage import get_storage_backend


def _json_error(detail: str, status: int) -> JsonResponse:
    return JsonResponse({"detail": detail}, status=status)


def _authenticate(request: HttpRequest) -> str:
    token = request.headers.get("x-api-token")
    user_id = request.headers.get("x-user-id") or DEFAULT_USER_ID
    if API_AUTH_TOKEN and token != API_AUTH_TOKEN:
        raise PermissionError("Unauthorized")
    return user_id


def _authenticate_or_response(request: HttpRequest) -> str | JsonResponse:
    try:
        return _authenticate(request)
    except PermissionError:
        return _json_error("Unauthorized", 401)


def _authorize_job_access(job: dict[str, Any], request_user: str) -> None:
    owner = job.get("user_id", DEFAULT_USER_ID)
    if owner != request_user:
        raise PermissionError("Forbidden: job owned by another user")


@require_http_methods(["GET"])
def health(request: HttpRequest) -> JsonResponse:
    return JsonResponse({"status": "ok"})


@require_http_methods(["GET"])
def ready(request: HttpRequest) -> JsonResponse:
    queue_ok, queue_message = queue_readiness()
    storage = get_storage_backend()
    storage_ok, storage_message = storage.readiness()
    overall = queue_ok and storage_ok
    composio_ok, composio_message = composio_context.composio_readiness()
    checks: dict[str, dict[str, str | bool]] = {
        "queue": {"ok": queue_ok, "message": queue_message},
        "storage": {"ok": storage_ok, "message": storage_message},
        "composio": {"ok": composio_ok, "message": composio_message},
    }
    return JsonResponse(
        {
            "status": "ready" if overall else "not_ready",
            "queue_backend": QUEUE_BACKEND,
            "storage_backend": STORAGE_BACKEND,
            "checks": checks,
        }
    )


@require_http_methods(["GET"])
def sample_prompts(request: HttpRequest) -> JsonResponse:
    return JsonResponse({"prompts": []})


@csrf_exempt
@require_http_methods(["POST"])
def generate(request: HttpRequest) -> JsonResponse:
    auth = _authenticate_or_response(request)
    if isinstance(auth, JsonResponse):
        return auth
    try:
        body = json.loads(request.body.decode() or "{}")
        payload = GenerateRequest.model_validate(body)
    except (json.JSONDecodeError, ValidationError) as e:
        if isinstance(e, ValidationError):
            return JsonResponse({"detail": e.errors()}, status=422)
        return _json_error("Invalid JSON body", 400)

    job = create_job(
        prompt=payload.prompt,
        user_id=auth,
        company=payload.company,
        documents=payload.documents,
    )
    enqueue_result = enqueue_generate_prompt(job["job_id"], payload.prompt)
    update_job(job["job_id"], {"queue": {"backend": enqueue_result.backend, "task_id": enqueue_result.task_id}})
    data = GenerateResponse(job_id=job["job_id"], status="queued").model_dump(mode="json")
    return JsonResponse(data, safe=False)


@csrf_exempt
@require_http_methods(["POST"])
def confirm_concept(request: HttpRequest, job_id: str) -> JsonResponse:
    auth = _authenticate_or_response(request)
    if isinstance(auth, JsonResponse):
        return auth
    job = read_job(job_id)
    if not job:
        return _json_error("Job not found.", 404)
    try:
        _authorize_job_access(job, auth)
    except PermissionError:
        return _json_error("Forbidden: job owned by another user", 403)
    if job.get("status") != "awaiting_concept_confirmation":
        return _json_error("Job is not waiting for reference-image confirmation.", 409)
    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return _json_error("Invalid JSON body", 400)
    try:
        confirm_payload = ConfirmConceptRequest.model_validate(body)
    except ValidationError as e:
        return JsonResponse({"detail": e.errors()}, status=422)
    update_job(job_id, {"meshy_target_formats": confirm_payload.target_formats})
    enqueue_result = enqueue_continue_concept(job_id)
    update_job(job_id, {"queue": {"backend": enqueue_result.backend, "task_id": enqueue_result.task_id}})
    data = GenerateResponse(job_id=job_id, status="queued").model_dump(mode="json")
    return JsonResponse(data, safe=False)


@require_http_methods(["GET"])
def get_job(request: HttpRequest, job_id: str) -> JsonResponse:
    auth = _authenticate_or_response(request)
    if isinstance(auth, JsonResponse):
        return auth
    job = read_job(job_id)
    if not job:
        return _json_error("Job not found.", 404)
    try:
        _authorize_job_access(job, auth)
    except PermissionError:
        return _json_error("Forbidden: job owned by another user", 403)
    data = JobResponse.model_validate(job).model_dump(mode="json")
    return JsonResponse(data, safe=False)


@csrf_exempt
@require_http_methods(["POST"])
def cancel_job(request: HttpRequest, job_id: str) -> JsonResponse:
    auth = _authenticate_or_response(request)
    if isinstance(auth, JsonResponse):
        return auth
    job = read_job(job_id)
    if not job:
        return _json_error("Job not found.", 404)
    try:
        _authorize_job_access(job, auth)
    except PermissionError:
        return _json_error("Forbidden: job owned by another user", 403)
    updated = request_cancel(job_id)
    cancel_enqueued_job_if_possible(job_id)
    data = CancelJobResponse(
        job_id=job_id,
        status=updated["status"],
        cancel_requested=updated.get("cancel_requested", False),
    ).model_dump(mode="json")
    return JsonResponse(data, safe=False)
