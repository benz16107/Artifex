"""Optional Cloudinary upload for raster job assets (preview + concept PNGs).

CAD meshes and JSON stay on STORAGE_BACKEND (local|S3). When CLOUDINARY_* env
vars are set, PNGs are uploaded and job payloads use secure_url strings so the
frontend can apply transformation URLs for thumbnails and q_auto/f_auto.
"""

from __future__ import annotations

from pathlib import Path

from app.config import CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME


def cloudinary_raster_enabled() -> bool:
    return bool(CLOUDINARY_CLOUD_NAME and CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET)


def _configure() -> None:
    import cloudinary

    cloudinary.config(
        cloud_name=CLOUDINARY_CLOUD_NAME,
        api_key=CLOUDINARY_API_KEY,
        api_secret=CLOUDINARY_API_SECRET,
    )


def upload_raster_file(local_path: Path, public_id: str) -> str:
    """Upload a local image to Cloudinary; return HTTPS secure_url."""
    import cloudinary.uploader

    _configure()
    try:
        result = cloudinary.uploader.upload(
            str(local_path),
            public_id=public_id,
            overwrite=True,
            resource_type="image",
        )
    except Exception as exc:
        low = str(exc).lower()
        if "invalid cloud_name" in low:
            raise RuntimeError(
                "Cloudinary rejected CLOUDINARY_CLOUD_NAME (it must match the exact "
                "'Cloud name' from https://console.cloudinary.com — not a placeholder "
                "like 'Soon'). Or unset CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and "
                f"CLOUDINARY_API_SECRET to skip CDN uploads. Original: {exc}"
            ) from exc
        raise
    url = result.get("secure_url")
    if not url:
        raise RuntimeError("Cloudinary upload returned no secure_url")
    return str(url)


def cloudinary_raster_readiness() -> tuple[bool, str]:
    if not cloudinary_raster_enabled():
        return False, "cloudinary disabled (set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)"
    try:
        import cloudinary.api

        _configure()
        cloudinary.api.ping()
        return True, f"cloudinary reachable ({CLOUDINARY_CLOUD_NAME})"
    except Exception as exc:  # pragma: no cover - network
        return False, f"cloudinary not ready: {exc}"
