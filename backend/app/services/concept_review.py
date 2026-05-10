from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any, Protocol

_STYLE_FRONT_RE = re.compile(r"^style_(\d+)_front\.png$")


def style_front_filename(index: int) -> str:
    return f"style_{index}_front.png"


def style_three_quarter_filename(index: int) -> str:
    return f"style_{index}_three_quarter.png"


def list_concept_style_indices(output_dir: Path) -> list[int]:
    indices: set[int] = set()
    for p in output_dir.glob("style_*_front.png"):
        m = _STYLE_FRONT_RE.match(p.name)
        if m:
            indices.add(int(m.group(1)))
    if not indices and (output_dir / "reference_front.png").exists():
        indices.add(0)
    return sorted(indices)


def next_concept_style_index(output_dir: Path) -> int:
    idxs = list_concept_style_indices(output_dir)
    return (max(idxs) + 1) if idxs else 0


class _ConceptUrlPublisher(Protocol):
    def concept_style_slot_urls(self, job_id: str, output_dir: Path, style_index: int) -> dict[str, str]:
        ...

    def concept_reference_urls(self, job_id: str, output_dir: Path) -> dict[str, str]:
        ...


def build_concept_review_snapshot(
    storage_backend: _ConceptUrlPublisher,
    job_id: str,
    output_dir: Path,
    job_dict: dict[str, Any],
    *,
    generation_style_index: int | None,
) -> dict[str, Any]:
    """URLs for every saved style slot plus the selected pair for `concept_references`."""
    indices = list_concept_style_indices(output_dir)
    selected = int(job_dict.get("selected_concept_style_index") or 0)
    if indices:
        if selected not in indices:
            selected = indices[0] if selected < min(indices) else indices[-1]
    else:
        selected = 0

    styles: list[dict[str, Any]] = []
    for i in indices:
        slot = storage_backend.concept_style_slot_urls(job_id, output_dir, i)
        if i == 0 and not slot.get("front") and (output_dir / "reference_front.png").exists():
            slot = storage_backend.concept_reference_urls(job_id, output_dir)
        if not slot.get("front"):
            continue
        row: dict[str, Any] = {"index": i, "front": slot["front"]}
        if slot.get("three_quarter"):
            row["three_quarter"] = slot["three_quarter"]
        styles.append(row)

    slot_sel = storage_backend.concept_style_slot_urls(job_id, output_dir, selected)
    if not slot_sel.get("front") and (output_dir / "reference_front.png").exists():
        slot_sel = storage_backend.concept_reference_urls(job_id, output_dir)
    concept_refs = {k: v for k, v in slot_sel.items() if v}

    return {
        "concept_styles": styles or None,
        "concept_references": concept_refs or None,
        "selected_concept_style_index": selected,
        "concept_generation_style_index": generation_style_index,
    }


def copy_style_to_canonical_reference(output_dir: Path, style_index: int) -> None:
    """Copy the chosen style slot onto reference_front.png / reference_three_quarter.png for Meshy."""
    src_f = output_dir / style_front_filename(style_index)
    if not src_f.exists() and style_index == 0 and (output_dir / "reference_front.png").exists():
        src_f = output_dir / "reference_front.png"
    if not src_f.exists():
        raise ValueError(f"Missing concept front image for style index {style_index}.")
    dest_f = output_dir / "reference_front.png"
    if src_f.resolve() != dest_f.resolve():
        shutil.copyfile(src_f, dest_f)
    src_tq = output_dir / style_three_quarter_filename(style_index)
    dest_tq = output_dir / "reference_three_quarter.png"
    if src_tq.exists():
        if src_tq.resolve() != dest_tq.resolve():
            shutil.copyfile(src_tq, dest_tq)
    elif style_index == 0 and (output_dir / "reference_three_quarter.png").exists():
        # Legacy jobs only had canonical three-quarter; nothing to copy.
        pass
    else:
        tq_dest = output_dir / "reference_three_quarter.png"
        if tq_dest.exists():
            tq_dest.unlink()
