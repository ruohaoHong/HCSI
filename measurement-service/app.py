from __future__ import annotations

import hashlib
import os
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, UploadFile

from geometry import extract_object_geometry
from rulernet import infer_ruler, local_px_per_cm, perspective_step_pct

MAX_UPLOAD_BYTES = 8_000_000
DEFAULT_MAX_PERSPECTIVE_STEP_PCT = 4.0
DEFAULT_MAX_ALIGNMENT_DEG = 20.0

app = FastAPI(title="HCSI Measurement Service", version="0.1.0")


def _round(value: float | None, digits: int = 3) -> float | None:
    return None if value is None else round(float(value), digits)


def _invalid_result(*, image_sha256: str, width: int, height: int, reasons: list[str], ruler: dict[str, Any] | None = None, obj: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "schema_version": "hcsi.measurement.v1",
        "image_sha256": image_sha256,
        "measurement_valid": False,
        "length_mm": None,
        "width_mm": None,
        "scale_px_per_cm": None,
        "image": {"width_px": width, "height_px": height},
        "ruler": ruler or {"detected": False, "mark_count": 0, "median_px_per_cm": None, "local_px_per_cm": None, "perspective_ratio": None, "perspective_step_pct": None, "perspective_ok": False},
        "object": obj or {"detected": False, "contour_reliable": False, "contour_area_px": None, "contour_area_ratio": None, "solidity": None, "principal_length_px": None, "principal_width_px": None, "min_area_length_px": None, "min_area_width_px": None, "principal_angle_deg": None, "ruler_alignment_deg": None, "segmentation_method": "border_lab+edges"},
        "gate_reasons": sorted(set(reasons)),
        "capture_assumptions": {"same_plane_required": True, "same_plane_verified": False, "near_overhead_required": True, "ruler_parallel_required": True},
    }


def measure_rgb(image_rgb: np.ndarray, image_sha256: str = "synthetic") -> dict[str, Any]:
    height, width = image_rgb.shape[:2]
    ruler_obs = infer_ruler(image_rgb)
    perspective_pct = perspective_step_pct(ruler_obs.perspective_ratio)
    max_perspective = float(os.environ.get("HCSI_MAX_PERSPECTIVE_STEP_PCT", DEFAULT_MAX_PERSPECTIVE_STEP_PCT))
    perspective_ok = perspective_pct is not None and perspective_pct <= max_perspective
    ruler_json: dict[str, Any] = {
        "detected": ruler_obs.detected,
        "mark_count": int(len(ruler_obs.mark_points_px)),
        "median_px_per_cm": _round(ruler_obs.median_px_per_cm),
        "local_px_per_cm": None,
        "perspective_ratio": _round(ruler_obs.perspective_ratio, 6),
        "perspective_step_pct": _round(perspective_pct),
        "perspective_ok": perspective_ok,
    }
    reasons = list(ruler_obs.gate_reasons)
    if ruler_obs.detected and not perspective_ok:
        reasons.append("perspective_too_strong_for_2d_measurement")
    if not ruler_obs.detected or ruler_obs.median_px_per_cm is None:
        return _invalid_result(image_sha256=image_sha256, width=width, height=height, reasons=reasons or ["ruler_not_detected"], ruler=ruler_json)

    max_alignment = float(os.environ.get("HCSI_MAX_RULER_ALIGNMENT_DEG", DEFAULT_MAX_ALIGNMENT_DEG))
    geometry = extract_object_geometry(image_rgb, ruler_obs.mark_points_px, ruler_obs.median_px_per_cm, ruler_obs.direction_xy, max_alignment_deg=max_alignment)
    local_scale = local_px_per_cm(ruler_obs.mark_points_px, geometry.center_xy) if geometry.center_xy is not None else None
    effective_scale = local_scale or ruler_obs.median_px_per_cm
    ruler_json["local_px_per_cm"] = _round(local_scale)
    object_json: dict[str, Any] = {
        "detected": geometry.detected,
        "contour_reliable": geometry.contour_reliable,
        "contour_area_px": _round(geometry.contour_area_px),
        "contour_area_ratio": _round(geometry.contour_area_ratio, 6),
        "solidity": _round(geometry.solidity),
        "principal_length_px": _round(geometry.principal_length_px),
        "principal_width_px": _round(geometry.principal_width_px),
        "min_area_length_px": _round(geometry.min_area_length_px),
        "min_area_width_px": _round(geometry.min_area_width_px),
        "principal_angle_deg": _round(geometry.principal_angle_deg),
        "ruler_alignment_deg": _round(geometry.ruler_alignment_deg),
        "segmentation_method": geometry.segmentation_method,
    }
    reasons.extend(geometry.gate_reasons)
    measurement_valid = ruler_obs.detected and perspective_ok and geometry.detected and geometry.contour_reliable and effective_scale is not None and effective_scale > 0 and geometry.principal_length_px is not None and geometry.principal_width_px is not None
    if not measurement_valid:
        return _invalid_result(image_sha256=image_sha256, width=width, height=height, reasons=reasons or ["measurement_gate_failed"], ruler=ruler_json, obj=object_json)

    length_mm = geometry.principal_length_px / effective_scale * 10.0
    width_mm = geometry.principal_width_px / effective_scale * 10.0
    return {
        "schema_version": "hcsi.measurement.v1",
        "image_sha256": image_sha256,
        "measurement_valid": True,
        "length_mm": round(float(length_mm), 2),
        "width_mm": round(float(width_mm), 2),
        "scale_px_per_cm": _round(effective_scale),
        "image": {"width_px": width, "height_px": height},
        "ruler": ruler_json,
        "object": object_json,
        "gate_reasons": [],
        "capture_assumptions": {"same_plane_required": True, "same_plane_verified": False, "near_overhead_required": True, "ruler_parallel_required": True},
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/measure")
async def measure(file: UploadFile = File(...), authorization: str | None = Header(default=None)) -> dict[str, Any]:
    expected_token = os.environ.get("HCSI_MEASUREMENT_TOKEN", "").strip()
    if expected_token and authorization != f"Bearer {expected_token}":
        raise HTTPException(status_code=401, detail="unauthorized")
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if not raw or len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="image is empty or too large")
    array = np.frombuffer(raw, dtype=np.uint8)
    image_bgr = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise HTTPException(status_code=400, detail="unable to decode image")
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    digest = hashlib.sha256(raw).hexdigest()
    try:
        return measure_rgb(image_rgb, digest)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
