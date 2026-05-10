from __future__ import annotations

import json
from typing import Any

from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from pydantic import ValidationError

from app.config import (
    API_AUTH_TOKEN,
    DEFAULT_USER_ID,
    IMAGE_OPENAI_MODEL,
    IMAGE_OPENAI_MODEL_FAST,
    JOB_METADATA_FILENAME,
    OUTPUTS_DIR,
    QUEUE_BACKEND,
    STORAGE_BACKEND,
)
from app.services import composio_context
from app.services.asset_analysis import (
    AssetAnalysisError,
    MAX_FILES,
    MAX_TOTAL_BYTES,
    UploadedAsset,
    analyze_uploaded_assets,
)
from app.schemas.api import (
    AddConceptStyleRequest,
    CancelJobResponse,
    ConfirmConceptRequest,
    ConfirmImageGenerationRequest,
    GenerateRequest,
    GenerateResponse,
    JobResponse,
    SelectConceptStyleRequest,
)
from app.services.concept_review import (
    build_concept_review_snapshot,
    copy_style_to_canonical_reference,
    list_concept_style_indices,
)
from app.services.jobs import (
    create_job,
    delete_job_artifacts,
    is_safe_job_id,
    job_lock,
    job_output_dir,
    read_job,
    request_cancel,
    update_job,
)
from app.services.reference_images import build_reference_image_prompt_preview


_RESEARCH_BRIEF_FIELDS: tuple[tuple[str, str], ...] = (
    ("brand_snapshot", "Brand snapshot"),
    ("visual_packaging_cues", "Visual & packaging cues"),
    ("category_competitive_notes", "Category & market"),
    ("financial_snapshot", "Financial signals → product implications"),
    ("corporate_strategy", "Corporate strategy → product direction"),
)


def _digest_from_brief(brief: dict[str, str] | None) -> str:
    """Render the structured brief as a single digest blob the image model can read."""
    if not brief:
        return ""
    parts: list[str] = []
    for key, label in _RESEARCH_BRIEF_FIELDS:
        value = str(brief.get(key) or "").strip()
        if not value:
            continue
        parts.append(f"{label}:\n{value}")
    return "\n\n".join(parts).strip()


def _apply_research_digest_to_image_preview(
    job_id: str,
    job: dict[str, Any],
    *,
    research_digest: str | None,
    research_brief: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Rebuild persisted image prompt preview from edited research text (no queue).

    Accepts either a free-form digest blob, a structured brief, or both. When a
    brief is supplied, it becomes the source of truth and (if no explicit digest
    is provided) the digest is rebuilt from the brief so the image model sees
    every section, including financial signals and corporate strategy.
    """
    use_fast = bool(job.get("fast_reference_images"))
    image_model = IMAGE_OPENAI_MODEL_FAST if use_fast else IMAGE_OPENAI_MODEL

    normalized_brief: dict[str, str] | None = None
    if research_brief is not None:
        normalized_brief = {
            key: str(research_brief.get(key) or "").strip()
            for key, _label in _RESEARCH_BRIEF_FIELDS
        }

    digest_value = (research_digest or "").strip() or None
    if digest_value is None and normalized_brief is not None:
        derived = _digest_from_brief(normalized_brief)
        digest_value = derived or None

    preview = build_reference_image_prompt_preview(
        prompt=job.get("prompt") or "",
        company=job.get("company"),
        documents=job.get("documents") or [],
        research_digest=digest_value,
        variation_detail_prompt=None,
        openai_image_model=image_model,
    )

    update_payload: dict[str, Any] = {
        "research_digest": digest_value,
        "image_generation_preview": preview,
    }
    if normalized_brief is not None:
        update_payload["research_brief"] = normalized_brief
    elif research_digest is not None:
        update_payload["research_brief"] = {
            key: "" for key, _label in _RESEARCH_BRIEF_FIELDS
        }

    return update_job(job_id, update_payload)
from app.services.queue import (
    cancel_enqueued_job_if_possible,
    enqueue_add_concept_style,
    enqueue_confirm_image_generation,
    enqueue_continue_concept,
    enqueue_generate_prompt,
    enqueue_regenerate_concept_references,
    enqueue_regenerate_mesh,
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
        fast_reference_images=payload.fast_reference_images,
    )
    enqueue_result = enqueue_generate_prompt(job["job_id"], payload.prompt)
    update_job(job["job_id"], {"queue": {"backend": enqueue_result.backend, "task_id": enqueue_result.task_id}})
    data = GenerateResponse(job_id=job["job_id"], status="queued").model_dump(mode="json")
    return JsonResponse(data, safe=False)


@csrf_exempt
@require_http_methods(["POST"])
def confirm_image_generation(request: HttpRequest, job_id: str) -> JsonResponse:
    """Resume reference-image generation after the user reviewed research + prompt preview."""
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
    if job.get("status") != "awaiting_image_generation_preview":
        return _json_error("Job is not waiting for image-generation confirmation.", 409)
    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return _json_error("Invalid JSON body", 400)
    try:
        confirm_image_payload = ConfirmImageGenerationRequest.model_validate(body)
    except ValidationError as e:
        return JsonResponse({"detail": e.errors()}, status=422)

    if "research_digest" in body or "research_brief" in body:
        rd = (confirm_image_payload.research_digest or "").strip()
        digest_value = rd or None
        brief_payload = confirm_image_payload.research_brief
        brief_value = brief_payload.model_dump() if brief_payload is not None else None
        _apply_research_digest_to_image_preview(
            job_id,
            job,
            research_digest=digest_value if "research_digest" in body else None,
            research_brief=brief_value,
        )

    enqueue_result = enqueue_confirm_image_generation(job_id)
    update_job(job_id, {"queue": {"backend": enqueue_result.backend, "task_id": enqueue_result.task_id}})
    data = GenerateResponse(job_id=job_id, status="queued").model_dump(mode="json")
    return JsonResponse(data, safe=False)


@csrf_exempt
@require_http_methods(["POST"])
def save_image_generation_preview(request: HttpRequest, job_id: str) -> JsonResponse:
    """Rebuild image prompt preview from edited research text; stay on awaiting_image_generation_preview."""
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
    if job.get("status") != "awaiting_image_generation_preview":
        return _json_error("Job is not waiting for image-generation confirmation.", 409)
    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return _json_error("Invalid JSON body", 400)
    try:
        payload = ConfirmImageGenerationRequest.model_validate(body)
    except ValidationError as e:
        return JsonResponse({"detail": e.errors()}, status=422)
    rd = (payload.research_digest or "").strip()
    digest_value = rd or None
    brief_payload = payload.research_brief
    brief_value = brief_payload.model_dump() if brief_payload is not None else None
    updated = _apply_research_digest_to_image_preview(
        job_id,
        job,
        research_digest=digest_value if "research_digest" in body else None,
        research_brief=brief_value,
    )
    data = JobResponse.model_validate(updated).model_dump(mode="json")
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


@csrf_exempt
@require_http_methods(["POST"])
def regenerate_concept_references(request: HttpRequest, job_id: str) -> JsonResponse:
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
        return _json_error("Regenerate concept art is only available while reference images are awaiting review.", 409)
    enqueue_result = enqueue_regenerate_concept_references(job_id)
    update_job(job_id, {"queue": {"backend": enqueue_result.backend, "task_id": enqueue_result.task_id}})
    data = GenerateResponse(job_id=job_id, status="queued").model_dump(mode="json")
    return JsonResponse(data, safe=False)


@csrf_exempt
@require_http_methods(["POST"])
def add_concept_style(request: HttpRequest, job_id: str) -> JsonResponse:
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
        return _json_error("Add concept style is only available while reference images are awaiting review.", 409)
    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return _json_error("Invalid JSON body", 400)
    try:
        add_payload = AddConceptStyleRequest.model_validate(body)
    except ValidationError as e:
        return JsonResponse({"detail": e.errors()}, status=422)
    # Persist before enqueue so the worker always sees the text (thread/RQ can start immediately).
    update_job(job_id, {"pending_add_concept_style_detail": add_payload.detail_prompt})
    enqueue_result = enqueue_add_concept_style(job_id, add_payload.detail_prompt)
    update_job(job_id, {"queue": {"backend": enqueue_result.backend, "task_id": enqueue_result.task_id}})
    data = GenerateResponse(job_id=job_id, status="queued").model_dump(mode="json")
    return JsonResponse(data, safe=False)


@csrf_exempt
@require_http_methods(["POST"])
def select_concept_style(request: HttpRequest, job_id: str) -> JsonResponse:
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
        return _json_error("Pick a concept style only while reference images are awaiting review.", 409)
    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return _json_error("Invalid JSON body", 400)
    try:
        payload = SelectConceptStyleRequest.model_validate(body)
    except ValidationError as e:
        return JsonResponse({"detail": e.errors()}, status=422)

    output_dir = job_output_dir(job_id)
    job_cur: dict[str, Any] = {}
    try:
        with job_lock(job_id):
            job_locked = read_job(job_id)
            if not job_locked or job_locked.get("status") != "awaiting_concept_confirmation":
                return _json_error("Job is no longer awaiting concept review.", 409)
            if payload.style_index not in list_concept_style_indices(output_dir):
                return _json_error("That concept style is not available yet.", 400)
            copy_style_to_canonical_reference(output_dir, payload.style_index)
            update_job(job_id, {"selected_concept_style_index": payload.style_index})
            job_cur = read_job(job_id) or {}
    except ValueError as exc:
        return _json_error(str(exc), 400)

    storage = get_storage_backend()
    snap = build_concept_review_snapshot(
        storage,
        job_id,
        output_dir,
        job_cur,
        generation_style_index=None,
    )
    update_job(job_id, snap)
    refreshed = read_job(job_id)
    if not refreshed:
        return _json_error("Job not found.", 404)
    data = JobResponse.model_validate(refreshed).model_dump(mode="json")
    return JsonResponse(data, safe=False)


@csrf_exempt
@require_http_methods(["POST"])
def regenerate_mesh(request: HttpRequest, job_id: str) -> JsonResponse:
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
    if job.get("status") not in {"completed", "failed"}:
        return _json_error("Regenerate 3D is only available after a mesh build has finished or failed.", 409)
    output_dir = job_output_dir(job_id)
    if not (output_dir / "reference_front.png").exists():
        return _json_error("Missing concept reference image on disk; cannot rebuild the mesh.", 409)
    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return _json_error("Invalid JSON body", 400)
    try:
        regen_payload = ConfirmConceptRequest.model_validate(body)
    except ValidationError as e:
        return JsonResponse({"detail": e.errors()}, status=422)
    update_job(job_id, {"meshy_target_formats": regen_payload.target_formats})
    enqueue_result = enqueue_regenerate_mesh(job_id)
    update_job(job_id, {"queue": {"backend": enqueue_result.backend, "task_id": enqueue_result.task_id}})
    data = GenerateResponse(job_id=job_id, status="queued").model_dump(mode="json")
    return JsonResponse(data, safe=False)


@csrf_exempt
@require_http_methods(["GET"])
def list_jobs(request: HttpRequest) -> JsonResponse:
    """List recent jobs owned by the authenticated user (any status), newest first.

    Used by the web client to recover the prototype gallery when localStorage is empty
    or wiped (e.g. another browser, cleared site data, dev-server crash). The on-disk
    metadata under OUTPUTS_DIR is the source of truth.
    """
    auth = _authenticate_or_response(request)
    if isinstance(auth, JsonResponse):
        return auth
    if not OUTPUTS_DIR.is_dir():
        return JsonResponse({"items": []}, safe=False)

    def _mtime(p: Path) -> float:
        try:
            return p.stat().st_mtime
        except OSError:
            return 0.0

    candidates: list[tuple[float, Path]] = []
    for path in OUTPUTS_DIR.iterdir():
        if not path.is_dir():
            continue
        job_id = path.name
        if not is_safe_job_id(job_id):
            continue
        if not (path / JOB_METADATA_FILENAME).is_file():
            continue
        candidates.append((_mtime(path), path))

    items: list[dict[str, Any]] = []
    try:
        limit = int(request.GET.get("limit", "60"))
    except (TypeError, ValueError):
        limit = 60
    limit = max(1, min(200, limit))

    for _, path in sorted(candidates, key=lambda t: t[0], reverse=True):
        job_id = path.name
        job = read_job(job_id)
        if not job:
            continue
        try:
            _authorize_job_access(job, auth)
        except PermissionError:
            continue
        try:
            data = JobResponse.model_validate(job).model_dump(mode="json")
        except ValidationError:
            continue
        items.append(data)
        if len(items) >= limit:
            break

    return JsonResponse({"items": items}, safe=False)


@csrf_exempt
@require_http_methods(["GET"])
def list_viewer_models(request: HttpRequest) -> JsonResponse:
    """List jobs under OUTPUTS_DIR that have model.glb and belong to the authenticated user (Quest viewer sync)."""
    auth = _authenticate_or_response(request)
    if isinstance(auth, JsonResponse):
        return auth
    items: list[dict[str, Any]] = []
    if not OUTPUTS_DIR.is_dir():
        return JsonResponse({"items": []}, safe=False)

    def _mtime(p: Path) -> float:
        try:
            return p.stat().st_mtime
        except OSError:
            return 0.0

    candidates: list[tuple[float, Path]] = []
    for path in OUTPUTS_DIR.iterdir():
        if not path.is_dir():
            continue
        job_id = path.name
        if not is_safe_job_id(job_id):
            continue
        if not (path / "model.glb").is_file():
            continue
        candidates.append((_mtime(path), path))

    for _, path in sorted(candidates, key=lambda t: t[0], reverse=True):
        job_id = path.name
        job = read_job(job_id)
        if not job:
            continue
        try:
            _authorize_job_access(job, auth)
        except PermissionError:
            continue
        prompt = (job.get("prompt") or "").strip().replace("\n", " ")
        if len(prompt) > 120:
            prompt = prompt[:117] + "..."
        # camelCase keys: Unity JsonUtility deserializes this reliably on device.
        items.append(
            {
                "jobId": job_id,
                "status": job.get("status"),
                "prompt": prompt,
                "glbPath": f"/outputs/{job_id}/model.glb",
            }
        )
        if len(items) >= 100:
            break

    return JsonResponse({"items": items}, safe=False)


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


def delete_job(request: HttpRequest, job_id: str) -> JsonResponse:
    auth = _authenticate_or_response(request)
    if isinstance(auth, JsonResponse):
        return auth
    if not is_safe_job_id(job_id):
        return _json_error("Invalid job id.", 400)
    job = read_job(job_id)
    if not job:
        return _json_error("Job not found.", 404)
    try:
        _authorize_job_access(job, auth)
    except PermissionError:
        return _json_error("Forbidden: job owned by another user", 403)
    cancel_enqueued_job_if_possible(job_id)
    try:
        request_cancel(job_id)
    except FileNotFoundError:
        pass
    try:
        delete_job_artifacts(job_id)
    except ValueError:
        return _json_error("Invalid job id.", 400)
    return JsonResponse({"job_id": job_id, "deleted": True}, safe=False)


@csrf_exempt
def job_route(request: HttpRequest, job_id: str) -> JsonResponse:
    if request.method == "GET":
        return get_job(request, job_id)
    if request.method == "DELETE":
        return delete_job(request, job_id)
    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@require_http_methods(["POST"])
def analyze_assets(request: HttpRequest) -> JsonResponse:
    """Analyze uploaded reference files and return text sections to merge into context documents."""
    auth = _authenticate_or_response(request)
    if isinstance(auth, JsonResponse):
        return auth
    files = request.FILES.getlist("files")
    if not files:
        return _json_error("Upload at least one file under the 'files' form field.", 400)
    if len(files) > MAX_FILES:
        return _json_error(
            f"Too many files: {len(files)} (max {MAX_FILES} per request).", 413
        )
    roles_raw = (request.POST.get("roles_json") or "").strip()
    roles: list[str] = []
    if roles_raw:
        try:
            parsed = json.loads(roles_raw)
        except json.JSONDecodeError:
            return _json_error("roles_json must be a JSON array of strings.", 400)
        if not isinstance(parsed, list):
            return _json_error("roles_json must be a JSON array.", 400)
        roles = [str(x).strip().lower() for x in parsed]
        if len(roles) != len(files):
            return _json_error("roles_json must have one entry per uploaded file.", 400)
        for r in roles:
            if r not in ("reference", "sketch"):
                return _json_error("Each role must be 'reference' or 'sketch'.", 400)
    else:
        roles = ["reference"] * len(files)

    total = 0
    assets: list[UploadedAsset] = []
    for i, f in enumerate(files):
        size = getattr(f, "size", None) or 0
        total += size
        if total > MAX_TOTAL_BYTES:
            return _json_error(
                f"Combined upload exceeds the {MAX_TOTAL_BYTES // (1024 * 1024)} MB request limit.",
                413,
            )
        try:
            data = f.read()
        finally:
            try:
                f.seek(0)
            except Exception:
                pass
        assets.append(
            UploadedAsset(
                filename=getattr(f, "name", "") or "file",
                content_type=(getattr(f, "content_type", "") or "").lower(),
                data=data,
                role=roles[i],
            )
        )
    try:
        sections, warnings = analyze_uploaded_assets(assets)
    except AssetAnalysisError as exc:
        return _json_error(str(exc), exc.http_status)
    return JsonResponse({"sections": sections, "warnings": warnings}, safe=False)


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
