from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from urllib import error as urllib_error

from app.config import MANIFEST_FILENAME, SPEC_FILENAME
from app.schemas.api import ErrorPayload
from app.services.jobs import job_lock, job_output_dir, read_job, update_job
from app.services.meshy import MeshyError, normalize_meshy_target_formats, run_image_to_3d
from app.services.reference_images import generate_reference_images
from app.services.spec_parser import parse_prompt_to_spec
from app.services.storage import get_storage_backend

logger = logging.getLogger("object-first-mvp")
storage_backend = get_storage_backend()


class JobCancelledError(Exception):
    pass


def _finalize_concept_mesh_outputs(job_id: str, spec, output_dir: Path, stage_durations_ms: dict[str, int]) -> None:
    """Publish Meshy + spec artifacts, write manifest, mark job completed."""
    files_payload = storage_backend.publish(job_id, output_dir)
    files = {
        "step": files_payload.step,
        "stl": files_payload.stl,
        "glb": files_payload.glb,
        "preview": files_payload.preview,
        "spec": files_payload.spec,
        "meshy_stl": files_payload.meshy_stl,
        "meshy_obj": files_payload.meshy_obj,
        "meshy_mtl": files_payload.meshy_mtl,
        "meshy_fbx": files_payload.meshy_fbx,
        "meshy_usdz": files_payload.meshy_usdz,
        "meshy_3mf": files_payload.meshy_3mf,
    }
    manifest = {
        "job_id": job_id,
        "artifacts": {},
        "urls": files,
    }
    (output_dir / MANIFEST_FILENAME).write_text(json.dumps(manifest, indent=2))

    update_job(
        job_id,
        {
            "status": "completed",
            "generation_phase": None,
            "concept_references": None,
            "spec": spec.model_dump(mode="json"),
            "files": files,
            "warnings": spec.warnings,
            "stage_durations_ms": stage_durations_ms,
        },
    )
    logger.info("job_complete job_id=%s status=completed durations=%s", job_id, stage_durations_ms)


def _run_concept_pipeline_start(job_id: str, spec, stage_durations_ms: dict[str, int], job_context: dict | None) -> None:
    """Reference images, then pause for user confirmation before Meshy."""
    output_dir = job_output_dir(job_id)
    (output_dir / SPEC_FILENAME).write_text(spec.model_dump_json(indent=2))
    _abort_if_cancelled(job_id)

    update_job(job_id, {"generation_phase": "concept_reference_images"})
    t_ref = time.perf_counter()
    generate_reference_images(
        prompt=job_context.get("prompt") if job_context else spec.product_name,
        company=(job_context or {}).get("company"),
        documents=(job_context or {}).get("documents") or [],
        output_dir=output_dir,
        spec=spec,
    )
    stage_durations_ms["reference_images"] = int((time.perf_counter() - t_ref) * 1000)
    logger.info(
        "job_stage job_id=%s stage=reference_images duration_ms=%s",
        job_id,
        stage_durations_ms["reference_images"],
    )
    _abort_if_cancelled(job_id)

    ref_urls = storage_backend.concept_reference_urls(job_id, output_dir)
    if not ref_urls.get("front"):
        raise ValueError("Concept reference generation did not produce a front view image on disk.")

    update_job(
        job_id,
        {
            "status": "awaiting_concept_confirmation",
            "generation_phase": None,
            "concept_references": ref_urls,
            "spec": spec.model_dump(mode="json"),
            "stage_durations_ms": stage_durations_ms,
        },
    )
    logger.info("job_pause job_id=%s awaiting_concept_confirmation refs=%s", job_id, list(ref_urls.keys()))


def continue_concept_job(job_id: str) -> None:
    """Resume after user confirms reference images: Meshy image-to-3D, then publish."""
    stage_durations_ms: dict[str, int] = {}
    job_snapshot: dict | None = None
    with job_lock(job_id):
        job = read_job(job_id)
        if not job:
            logger.warning("continue_concept_job missing job_id=%s", job_id)
            return
        if job.get("status") != "awaiting_concept_confirmation":
            logger.info("continue_concept_job skip job_id=%s status=%s", job_id, job.get("status"))
            return
        if bool(job.get("cancel_requested")) or job.get("status") == "cancelled":
            update_job(job_id, {"status": "cancelled", "generation_phase": None})
            return
        stage_durations_ms = dict(job.get("stage_durations_ms") or {})
        job_snapshot = dict(job)
        update_job(
            job_id,
            {"status": "running", "generation_phase": "concept_image_to_3d"},
        )

    output_dir = job_output_dir(job_id)
    logger.info("job_continue_concept job_id=%s", job_id)

    try:
        from app.schemas.spec import ProductSpec

        spec_path = output_dir / SPEC_FILENAME
        if not spec_path.exists():
            raise ValueError("Missing spec.json for job; cannot continue concept pipeline.")
        spec = ProductSpec.model_validate_json(spec_path.read_text())

        front = output_dir / "reference_front.png"
        if not front.exists():
            raise ValueError("Missing reference_front.png; reference step must be re-run.")

        meshy_formats = normalize_meshy_target_formats((job_snapshot or {}).get("meshy_target_formats"))
        t_mesh = time.perf_counter()
        run_image_to_3d(image_path=front, output_dir=output_dir, target_formats=meshy_formats)
        stage_durations_ms["image_to_3d"] = int((time.perf_counter() - t_mesh) * 1000)
        logger.info(
            "job_stage job_id=%s stage=image_to_3d duration_ms=%s",
            job_id,
            stage_durations_ms["image_to_3d"],
        )
        _abort_if_cancelled(job_id)

        _finalize_concept_mesh_outputs(job_id, spec, output_dir, stage_durations_ms)
    except TimeoutError as exc:
        logger.exception("Concept continuation timeout for %s", job_id)
        update_job(
            job_id,
            {
                "status": "failed",
                "generation_phase": None,
                "concept_references": (job_snapshot or {}).get("concept_references"),
                "error": ErrorPayload(
                    code="GENERATION_FAILED",
                    message=str(exc),
                ).model_dump(mode="json"),
                "stage_durations_ms": stage_durations_ms,
            },
        )
    except urllib_error.URLError as exc:
        logger.exception("Concept continuation network error for %s", job_id)
        update_job(
            job_id,
            {
                "status": "failed",
                "generation_phase": None,
                "concept_references": (job_snapshot or {}).get("concept_references"),
                "error": ErrorPayload(
                    code="GENERATION_FAILED",
                    message=(
                        "A network request timed out or could not complete "
                        f"({exc}). Check VPN, firewall, and proxy settings; retry when the API host is reachable."
                    ),
                ).model_dump(mode="json"),
                "stage_durations_ms": stage_durations_ms,
            },
        )
    except MeshyError as exc:
        logger.exception("Concept continuation Meshy error for %s", job_id)
        update_job(
            job_id,
            {
                "status": "failed",
                "generation_phase": None,
                "concept_references": (job_snapshot or {}).get("concept_references"),
                "error": ErrorPayload(
                    code="GENERATION_FAILED",
                    message=str(exc),
                ).model_dump(mode="json"),
                "stage_durations_ms": stage_durations_ms,
            },
        )
    except ValueError as exc:
        logger.exception("Concept continuation invalid for %s", job_id)
        update_job(
            job_id,
            {
                "status": "failed",
                "generation_phase": None,
                "concept_references": (job_snapshot or {}).get("concept_references"),
                "error": ErrorPayload(
                    code="INVALID_SPEC",
                    message=str(exc),
                ).model_dump(mode="json"),
                "stage_durations_ms": stage_durations_ms,
            },
        )
    except JobCancelledError:
        logger.info("Cancelled concept continuation for %s", job_id)
        update_job(job_id, {"status": "cancelled", "generation_phase": None})
    except Exception as exc:  # pragma: no cover - safety net
        logger.exception("Concept continuation failure for %s", job_id)
        update_job(
            job_id,
            {
                "status": "failed",
                "generation_phase": None,
                "concept_references": (job_snapshot or {}).get("concept_references"),
                "error": ErrorPayload(
                    code="RENDER_FAILED",
                    message=f"Unexpected generation failure: {exc}",
                ).model_dump(mode="json"),
                "stage_durations_ms": stage_durations_ms,
            },
        )


def process_job(job_id: str, prompt: str) -> None:
    if _is_cancelled(job_id):
        update_job(job_id, {"status": "cancelled"})
        return
    update_job(job_id, {"status": "running"})
    stage_durations_ms: dict[str, int] = {}
    logger.info("job_start job_id=%s source=prompt", job_id)

    try:
        t0 = time.perf_counter()
        job = read_job(job_id) or {}
        spec = parse_prompt_to_spec(
            prompt,
            context={
                "company": job.get("company"),
                "documents": job.get("documents") or [],
            },
        )
        stage_durations_ms["spec_parse"] = int((time.perf_counter() - t0) * 1000)
        _abort_if_cancelled(job_id)
        _run_concept_pipeline_start(job_id, spec, stage_durations_ms, job_context=job)
    except TimeoutError as exc:
        logger.exception("Generation timeout for %s", job_id)
        update_job(
            job_id,
            {
                "status": "failed",
                "generation_phase": None,
                "error": ErrorPayload(
                    code="GENERATION_FAILED",
                    message=str(exc),
                ).model_dump(mode="json"),
                "stage_durations_ms": stage_durations_ms,
            },
        )
    except urllib_error.URLError as exc:
        logger.exception("Generation network error for %s", job_id)
        update_job(
            job_id,
            {
                "status": "failed",
                "generation_phase": None,
                "error": ErrorPayload(
                    code="GENERATION_FAILED",
                    message=(
                        "A network request timed out or could not complete "
                        f"({exc}). Check VPN, firewall, and proxy settings; retry when the API host is reachable."
                    ),
                ).model_dump(mode="json"),
                "stage_durations_ms": stage_durations_ms,
            },
        )
    except ValueError as exc:
        logger.exception("Invalid generation request for %s", job_id)
        update_job(
            job_id,
            {
                "status": "failed",
                "generation_phase": None,
                "error": ErrorPayload(
                    code="INVALID_SPEC",
                    message=str(exc),
                ).model_dump(mode="json"),
                "stage_durations_ms": stage_durations_ms,
            },
        )
    except JobCancelledError:
        logger.info("Cancelled generation for %s", job_id)
        update_job(job_id, {"status": "cancelled", "generation_phase": None})
    except Exception as exc:  # pragma: no cover - safety net
        logger.exception("Unhandled generation failure for %s", job_id)
        update_job(
            job_id,
            {
                "status": "failed",
                "generation_phase": None,
                "error": ErrorPayload(
                    code="RENDER_FAILED",
                    message=f"Unexpected generation failure: {exc}",
                ).model_dump(mode="json"),
                "stage_durations_ms": stage_durations_ms,
            },
        )


def _is_cancelled(job_id: str) -> bool:
    job = read_job(job_id)
    if not job:
        return False
    return bool(job.get("cancel_requested")) or job.get("status") == "cancelled"


def _abort_if_cancelled(job_id: str) -> None:
    if _is_cancelled(job_id):
        update_job(job_id, {"status": "cancelled"})
        raise JobCancelledError("Job cancelled by user.")
