from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from app.config import S3_BUCKET, S3_PUBLIC_BASE_URL, S3_REGION, STORAGE_BACKEND


@dataclass(frozen=True)
class ArtifactPaths:
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


class StorageBackend(Protocol):
    def publish(self, job_id: str, output_dir: Path) -> ArtifactPaths:
        ...

    def concept_reference_urls(self, job_id: str, output_dir: Path) -> dict[str, str]:
        """Public URLs for concept reference_* PNG files that exist under output_dir."""
        ...

    def readiness(self) -> tuple[bool, str]:
        ...


class LocalStorage:
    _REF_FILENAMES: dict[str, str] = {
        "front": "reference_front.png",
        "three_quarter": "reference_three_quarter.png",
    }

    def publish(self, job_id: str, output_dir: Path) -> ArtifactPaths:
        def maybe(path: Path, url: str) -> str | None:
            return url if path.exists() else None

        return ArtifactPaths(
            step=maybe(output_dir / "model.step", f"/outputs/{job_id}/model.step"),
            stl=maybe(output_dir / "model.stl", f"/outputs/{job_id}/model.stl"),
            glb=maybe(output_dir / "model.glb", f"/outputs/{job_id}/model.glb"),
            preview=maybe(output_dir / "preview.png", f"/outputs/{job_id}/preview.png"),
            spec=maybe(output_dir / "spec.json", f"/outputs/{job_id}/spec.json"),
            meshy_stl=maybe(output_dir / "meshy_scan.stl", f"/outputs/{job_id}/meshy_scan.stl"),
            meshy_obj=maybe(output_dir / "meshy_model.obj", f"/outputs/{job_id}/meshy_model.obj"),
            meshy_mtl=maybe(output_dir / "meshy_model.mtl", f"/outputs/{job_id}/meshy_model.mtl"),
            meshy_fbx=maybe(output_dir / "meshy_model.fbx", f"/outputs/{job_id}/meshy_model.fbx"),
            meshy_usdz=maybe(output_dir / "meshy_model.usdz", f"/outputs/{job_id}/meshy_model.usdz"),
            meshy_3mf=maybe(output_dir / "meshy_model.3mf", f"/outputs/{job_id}/meshy_model.3mf"),
        )

    def concept_reference_urls(self, job_id: str, output_dir: Path) -> dict[str, str]:
        out: dict[str, str] = {}
        for view, fname in self._REF_FILENAMES.items():
            path = output_dir / fname
            if path.exists():
                out[view] = f"/outputs/{job_id}/{fname}"
        return out

    def readiness(self) -> tuple[bool, str]:
        return True, "local storage ready"


class S3Storage:
    def __init__(self) -> None:
        if not S3_BUCKET:
            raise RuntimeError("S3 backend selected but S3_BUCKET is not configured.")
        try:
            import boto3  # type: ignore
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("S3 backend requires boto3 dependency.") from exc
        self.bucket = S3_BUCKET
        self.region = S3_REGION
        self.public_base_url = S3_PUBLIC_BASE_URL
        self.client = boto3.client("s3", region_name=self.region)

    def publish(self, job_id: str, output_dir: Path) -> ArtifactPaths:
        mapping = {
            "step": "model.step",
            "stl": "model.stl",
            "glb": "model.glb",
            "preview": "preview.png",
            "spec": "spec.json",
            "meshy_stl": "meshy_scan.stl",
            "meshy_obj": "meshy_model.obj",
            "meshy_mtl": "meshy_model.mtl",
            "meshy_fbx": "meshy_model.fbx",
            "meshy_usdz": "meshy_model.usdz",
            "meshy_3mf": "meshy_model.3mf",
        }
        urls: dict[str, str] = {}
        for key, filename in mapping.items():
            local_path = output_dir / filename
            if not local_path.exists():
                continue
            object_key = f"{job_id}/{filename}"
            self.client.upload_file(str(local_path), self.bucket, object_key)
            if self.public_base_url:
                urls[key] = f"{self.public_base_url.rstrip('/')}/{object_key}"
            else:
                urls[key] = f"https://{self.bucket}.s3.{self.region}.amazonaws.com/{object_key}"
        return ArtifactPaths(**urls)

    def concept_reference_urls(self, job_id: str, output_dir: Path) -> dict[str, str]:
        urls: dict[str, str] = {}
        fname_by_view = {
            "front": "reference_front.png",
            "three_quarter": "reference_three_quarter.png",
        }
        for view, filename in fname_by_view.items():
            local_path = output_dir / filename
            if not local_path.exists():
                continue
            object_key = f"{job_id}/{filename}"
            self.client.upload_file(str(local_path), self.bucket, object_key)
            if self.public_base_url:
                urls[view] = f"{self.public_base_url.rstrip('/')}/{object_key}"
            else:
                urls[view] = f"https://{self.bucket}.s3.{self.region}.amazonaws.com/{object_key}"
        return urls

    def readiness(self) -> tuple[bool, str]:
        try:
            self.client.head_bucket(Bucket=self.bucket)
            return True, f"s3 bucket reachable: {self.bucket}"
        except Exception as exc:  # pragma: no cover
            return False, f"s3 not ready: {exc}"


def get_storage_backend() -> StorageBackend:
    if STORAGE_BACKEND == "s3":
        return S3Storage()
    return LocalStorage()
