from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.spec import ProductSpec
from app.services.meshy import normalize_meshy_target_formats


JobStatus = Literal[
    "queued",
    "running",
    "awaiting_concept_confirmation",
    "completed",
    "failed",
    "cancelled",
]


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=1000)
    company: str | None = Field(default=None, max_length=120)
    # Supporting context (strategy docs, annual report excerpts, etc).
    # Keep as plain text for MVP; the client can concatenate or chunk.
    documents: list[str] = Field(default_factory=list, max_length=12)
    # When true, reference images use IMAGE_OPENAI_MODEL_FAST instead of IMAGE_OPENAI_MODEL.
    fast_reference_images: bool = False


class ConfirmConceptRequest(BaseModel):
    """Meshy image-to-3D export formats (passed through as `target_formats`)."""

    target_formats: list[str] = Field(default_factory=lambda: ["glb"])

    @field_validator("target_formats", mode="before")
    @classmethod
    def _meshy_formats(cls, value: object) -> list[str]:
        if value is None:
            return normalize_meshy_target_formats(None)
        if isinstance(value, list):
            return normalize_meshy_target_formats(value)
        raise ValueError("target_formats must be a list of format strings or null.")


class ErrorPayload(BaseModel):
    code: Literal[
        "INVALID_SPEC",
        "UNSUPPORTED_OBJECT_TYPE",
        "GENERATION_FAILED",
        "RENDER_FAILED",
    ]
    message: str


class FilesPayload(BaseModel):
    step: str | None = None
    stl: str | None = None
    glb: str | None = None
    preview: str | None = None
    spec: str | None = None
    meshy_stl: str | None = None
    meshy_obj: str | None = None
    meshy_mtl: str | None = None
    meshy_fbx: str | None = None
    meshy_usdz: str | None = None
    meshy_3mf: str | None = None


class JobResponse(BaseModel):
    job_id: str
    user_id: str = "anonymous"
    status: JobStatus
    prompt: str
    fast_reference_images: bool = False
    # Concept pipeline sub-step (cleared when the job finishes).
    generation_phase: str | None = None
    # Populated when status is awaiting_concept_confirmation (view key -> URL path or absolute URL).
    concept_references: dict[str, str] | None = None
    spec: ProductSpec | None = None
    files: FilesPayload = Field(default_factory=FilesPayload)
    error: ErrorPayload | None = None
    warnings: list[str] = Field(default_factory=list)
    stage_durations_ms: dict[str, int] = Field(default_factory=dict)
    cancel_requested: bool = False
    queue: dict[str, str | None] = Field(default_factory=dict)
    # ISO8601; used by clients to merge poll state after regenerate flows.
    updated_at: str | None = None
    # Last Meshy export formats chosen at confirm (or regenerate-3d); not always present on older jobs.
    meshy_target_formats: list[str] | None = None


class GenerateResponse(BaseModel):
    job_id: str
    status: Literal["queued"]


class CancelJobResponse(BaseModel):
    job_id: str
    status: JobStatus
    cancel_requested: bool
