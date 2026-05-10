from __future__ import annotations

from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, Field, field_validator

from app.schemas.spec import ProductSpec
from app.services.pingram_supplier import validate_supplier_email
from app.services.meshy import normalize_meshy_target_formats


JobStatus = Literal[
    "queued",
    "running",
    "awaiting_image_generation_preview",
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


class ConceptStyleRow(BaseModel):
    index: int = Field(ge=0)
    front: str
    three_quarter: str | None = None


class SelectConceptStyleRequest(BaseModel):
    style_index: int = Field(ge=0)


class AddConceptStyleRequest(BaseModel):
    """Optional extra instructions for one additional concept style generation."""

    detail_prompt: str | None = Field(
        default=None,
        max_length=2000,
        validation_alias=AliasChoices("detail_prompt", "detailPrompt"),
    )

    @field_validator("detail_prompt")
    @classmethod
    def _strip_detail_prompt(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class ResearchBriefPayload(BaseModel):
    """Structured research brief edited by the user before reference-image generation."""

    brand_snapshot: str | None = Field(default=None, max_length=4000)
    visual_packaging_cues: str | None = Field(default=None, max_length=4000)
    category_competitive_notes: str | None = Field(default=None, max_length=4000)
    financial_snapshot: str | None = Field(default=None, max_length=4000)
    corporate_strategy: str | None = Field(default=None, max_length=4000)


class ConfirmImageGenerationRequest(BaseModel):
    """Optional research text override before reference-image generation."""

    research_digest: str | None = Field(default=None, max_length=8000)
    research_brief: ResearchBriefPayload | None = Field(default=None)


class ManufacturingBriefRequest(BaseModel):
    """Optional extra company context from the workspace (not persisted on the job)."""

    company_context: str | None = Field(default=None, max_length=12000)
    refresh: bool = False


class SupplierContactRequest(BaseModel):
    """Email a supplier via Pingram from a completed Artifex run (server holds PINGRAM_API_KEY)."""

    to_email: str = Field(min_length=3, max_length=254)
    subject: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=16_000)

    @field_validator("to_email")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        s = (value or "").strip().lower()
        ok = validate_supplier_email(s)
        if not ok:
            raise ValueError("Invalid supplier email address.")
        return ok


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
    company: str | None = None
    fast_reference_images: bool = False
    # Concept pipeline sub-step (cleared when the job finishes).
    generation_phase: str | None = None
    # Populated when status is awaiting_concept_confirmation (view key -> URL path or absolute URL).
    concept_references: dict[str, str] | None = None
    # Multiple concept styles (front + optional three-quarter URLs per index).
    concept_styles: list[ConceptStyleRow] | None = None
    selected_concept_style_index: int = 0
    # While a style slot is being generated, the index of that slot (otherwise null).
    concept_generation_style_index: int | None = None
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
    # Brand research + image prompt preview (after research, before reference images).
    documents: list[str] = Field(default_factory=list)
    research_digest: str | None = None
    research_sources: list[dict[str, str]] | None = None
    research_brief: dict[str, str] | None = None
    research_warnings: list[str] = Field(default_factory=list)
    image_generation_preview: dict[str, Any] | None = None
    # Populated after POST /jobs/{id}/manufacturing-brief (cached on the job).
    manufacturing_plan: dict[str, Any] | None = None


class GenerateResponse(BaseModel):
    job_id: str
    status: Literal["queued"]


class CancelJobResponse(BaseModel):
    job_id: str
    status: JobStatus
    cancel_requested: bool
