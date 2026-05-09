#!/usr/bin/env python3
"""Emit a tiny valid GLB (single triangle) for StreamingAssets smoke tests."""
from __future__ import annotations

import json
import struct
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    out = root / "Assets" / "StreamingAssets" / "test.glb"
    out.parent.mkdir(parents=True, exist_ok=True)

    # One triangle in XY plane; 3 x vec3 + 3 x uint16 indices.
    verts = struct.pack("<9f", 0.0, 0.0, 0.0, 0.2, 0.0, 0.0, 0.0, 0.2, 0.0)
    indices = struct.pack("<3H", 0, 1, 2)
    bin_blob = verts + indices
    pad = (4 - (len(bin_blob) % 4)) % 4
    bin_blob += b"\x00" * pad

    gltf = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
        "accessors": [
            {
                "bufferView": 0,
                "byteOffset": 0,
                "componentType": 5126,
                "count": 3,
                "type": "VEC3",
                "max": [0.2, 0.2, 0.0],
                "min": [0.0, 0.0, 0.0],
            },
            {
                "bufferView": 0,
                "byteOffset": 36,
                "componentType": 5123,
                "count": 3,
                "type": "SCALAR",
                "max": [2],
                "min": [0],
            },
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": 36},
            {"buffer": 0, "byteOffset": 36, "byteLength": 6},
        ],
        "buffers": [{"byteLength": len(bin_blob)}],
    }

    json_str = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_pad = (4 - (len(json_str) % 4)) % 4
    json_str += b" " * json_pad

    glb = bytearray()
    glb += struct.pack("<4sII", b"glTF", 2, 0)  # total length placeholder
    glb += struct.pack("<II", len(json_str), 0x4E4F534A)
    glb += json_str
    glb += struct.pack("<II", len(bin_blob), 0x004E4942)
    glb += bin_blob
    struct.pack_into("<I", glb, 8, len(glb))
    out.write_bytes(glb)
    print(f"Wrote {out} ({len(glb)} bytes)")


if __name__ == "__main__":
    main()
