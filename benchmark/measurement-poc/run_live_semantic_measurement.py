from __future__ import annotations

import base64
import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SERVICE_DIR = ROOT / "measurement-service"
sys.path.insert(0, str(SERVICE_DIR))

from app import measure_rgb  # noqa: E402


def main() -> None:
    payload = json.loads(Path("semantic-live-output.json").read_text(encoding="utf-8"))
    routing = payload["routing"]
    resolved = payload["resolved_measurement_plan"]

    encoded = (
        ROOT
        / "benchmark"
        / "measurement-poc"
        / "fixtures"
        / "generated"
        / "bolt_ruler_case.jpg.b64"
    ).read_text(encoding="utf-8").strip()
    raw = base64.b64decode(encoded, validate=True)
    image_bgr = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise RuntimeError("unable to decode integration fixture")
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)

    steps = [
        {
            "operation": step["operation"],
            "inputs": step["inputs"],
            "purpose": step["purpose"],
        }
        for step in resolved["executable_steps"]
    ]
    result = measure_rgb(
        image_rgb,
        hashlib.sha256(raw).hexdigest(),
        steps,
        routing["semantic_vision"],
    )

    if result["measurement_status"] != "valid":
        raise AssertionError(
            f"semantic-guided measurement was not valid: {result['reason_codes']}"
        )
    if "semantic_roi" not in result["object"]["segmentation_method"]:
        raise AssertionError(
            f"semantic target ROI was not applied: {result['object']['segmentation_method']}"
        )
    if result["object"]["semantic_head_style"] != routing["semantic_vision"]["head_style"]:
        raise AssertionError("semantic head style was not threaded into measurement")

    convention = resolved["length_convention"]
    axial_steps = [
        step
        for step in resolved["executable_steps"]
        if step["operation"] == "axial_distance" and "object_tip" in step["inputs"]
    ]
    if convention == "overall":
        assert all("head_top" in step["inputs"] for step in axial_steps)
    elif convention == "under_head_to_tip":
        assert all("head_underface" in step["inputs"] for step in axial_steps)

    summary = {
        "planner": {
            "category": routing["category"],
            "object_hint": routing["object_hint"],
            "head_style": routing["semantic_vision"]["head_style"],
            "target_region": routing["semantic_vision"]["target_region"],
            "reference_region": routing["semantic_vision"]["reference_region"],
            "length_convention": convention,
        },
        "measurement": {
            "status": result["measurement_status"],
            "length_mm": result["length_mm"],
            "width_mm": result["width_mm"],
            "scale_px_per_cm": result["scale_px_per_cm"],
            "segmentation_method": result["object"]["segmentation_method"],
            "risk_signals": result["object"]["risk_signals"],
            "reason_codes": result["reason_codes"],
            "geometry_steps": result["geometry_steps"],
        },
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
