"""Run immutable real fixtures through a selected measurement-service tree.

The runner never downloads, generates, or replaces a fixture.  It verifies the
locked SHA-256 before measurement and is therefore safe to use with the private
A/B/D fixture artifact and the repository E derivative.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import sys
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "benchmark" / "measurement-poc" / "cases" / "real-cases-v1.json"
SUPPORTED_CASES = ("A", "B", "D", "E")


def _region(values: list[float]) -> dict:
    return {
        "present": True,
        "confidence": 0.95,
        "x_min": values[0],
        "y_min": values[1],
        "x_max": values[2],
        "y_max": values[3],
    }


def _fixture_path(directory: Path, case_id: str) -> Path:
    names = {
        "A": ("case-a.bin", "case-a.jpg"),
        "B": ("case-b.bin", "case-b.jpg"),
        "D": ("case-d.bin", "case-d.jpg"),
        "E": ("case-e.webp",),
    }[case_id]
    for name in names:
        candidate = directory / name
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"Case {case_id} fixture not found in {directory}")


def _step_value(result: dict, operation: str):
    return next(
        (step for step in result.get("geometry_steps", []) if step["operation"] == operation),
        None,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--service-dir", required=True, type=Path)
    parser.add_argument("--fixture-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--label", required=True)
    parser.add_argument("--cases", nargs="+", choices=SUPPORTED_CASES, default=list(SUPPORTED_CASES))
    args = parser.parse_args()

    sys.path.insert(0, str(args.service_dir.resolve()))
    service_app = importlib.import_module("app")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    definitions = {case["id"]: case for case in manifest["cases"]}
    rows = []

    for case_id in args.cases:
        definition = definitions[case_id]
        path = _fixture_path(args.fixture_dir, case_id)
        raw = path.read_bytes()
        actual_hash = hashlib.sha256(raw).hexdigest()
        expected_hash = (
            definition["repository_derivative"]["sha256"]
            if case_id == "E"
            else definition["sha256"]
        )
        if actual_hash != expected_hash:
            raise RuntimeError(
                f"Case {case_id} fixture SHA mismatch: expected {expected_hash}, got {actual_hash}"
            )

        semantic_input = definition["semantic_input"]
        semantic = {
            "target_region": _region(semantic_input["target_region"]),
            "reference_region": _region(semantic_input["reference_region"]),
            "head_style": semantic_input["head_style"],
        }
        length_anchor = (
            "head_top"
            if definition["length_convention"] == "head_top_to_tip"
            else "head_underface"
        )
        steps = [
            {"operation": "outer_width", "inputs": ["threaded_shank"], "purpose": "D"},
            {"operation": "periodicity", "inputs": ["threaded_shank"], "purpose": "P"},
            {
                "operation": "axial_distance",
                "inputs": ["object_tip", length_anchor],
                "purpose": "L",
            },
        ]
        image = np.asarray(Image.open(BytesIO(raw)).convert("RGB"))
        result = service_app.measure_rgb(image, actual_hash, steps, semantic)
        diameter = _step_value(result, "outer_width")
        pitch = _step_value(result, "periodicity")
        length = _step_value(result, "axial_distance")
        values = {
            "D_mm": None if diameter is None else diameter["value_mm"],
            "P_mm": None if pitch is None else pitch["value_mm"],
            "L_mm": None if length is None else length["value_mm"],
        }
        rows.append(
            {
                "case": case_id,
                "fixture": path.name,
                "fixture_sha256": actual_hash,
                "fixture_sha_match": True,
                "measurement_status": result["measurement_status"],
                "measurement_confidence": result.get("measurement_confidence"),
                "confidence_reason_codes": (result.get("confidence_evaluation") or {}).get(
                    "reason_codes"
                ),
                "same_plane_status": result.get("capture_assumptions", {}).get(
                    "same_plane_status"
                ),
                "values_mm": values,
                "ground_truth_mm": definition["ground_truth"],
                "step_statuses": {
                    "D": None if diameter is None else diameter["status"],
                    "P": None if pitch is None else pitch["status"],
                    "L": None if length is None else length["status"],
                },
            }
        )

    payload = {"label": args.label, "cases": rows}
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
