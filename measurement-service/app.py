from __future__ import annotations

import hashlib
import json
import os
from typing import Any, Literal

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile

from geometry import extract_object_geometry
from geometry_executor import execute_geometry_steps, unmeasured_geometry_steps
from rulernet import infer_ruler, local_px_per_cm, perspective_step_pct
from scale_reference import resolve_scale_reference

MAX_UPLOAD_BYTES = 8_000_000
MAX_GEOMETRY_STEPS = 12
MAX_GEOMETRY_STEPS_JSON_BYTES = 20_000
DEFAULT_MAX_PERSPECTIVE_STEP_PCT = 4.0
DEFAULT_MAX_ALIGNMENT_DEG = 20.0

MeasurementStatus = Literal["valid", "no_reference", "unreliable"]
AnalysisMode = Literal["measurement_assisted", "appearance_only"]

app = FastAPI(title="HCSI Measurement Service", version="0.4.0")


def _round(value: float | None, digits: int = 3) -> float | None:
    return None if value is None else round(float(value), digits)


def _empty_ruler() -> dict[str, Any]:
    return {
        "detected": False,
        "mark_count": 0,
        "scale_system": "unknown",
        "scale_source": "none",
        "scale_confidence": 0.0,
        "px_per_cm": None,
        "px_per_inch": None,
        "reference_interval_cm": None,
        "median_px_per_cm": None,
        "local_px_per_cm": None,
        "perspective_ratio": None,
        "perspective_step_pct": None,
        "perspective_ok": False,
    }


def _empty_object() -> dict[str, Any]:
    return {
        "detected": False,
        "contour_reliable": False,
        "contour_area_px": None,
        "contour_area_ratio": None,
        "solidity": None,
        "principal_length_px": None,
        "principal_width_px": None,
        "min_area_length_px": None,
        "min_area_width_px": None,
        "principal_angle_deg": None,
        "ruler_alignment_deg": None,
        "segmentation_method": "border_lab+edges",
        "risk_signals": [],
    }


def _normalize_geometry_steps(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("geometry_steps must be a JSON array")
    if len(value) > MAX_GEOMETRY_STEPS:
        raise ValueError("too many geometry steps")

    normalized: list[dict[str, Any]] = []
    for raw in value:
        if not isinstance(raw, dict):
            raise ValueError("each geometry step must be an object")
        operation = raw.get("operation")
        inputs = raw.get("inputs")
        purpose = raw.get("purpose", "")
        if not isinstance(operation, str) or not operation.strip():
            raise ValueError("geometry step operation is required")
        if not isinstance(inputs, list) or not all(isinstance(item, str) for item in inputs):
            raise ValueError("geometry step inputs must be strings")
        if not isinstance(purpose, str):
            raise ValueError("geometry step purpose must be a string")
        normalized.append(
            {
                "operation": operation.strip(),
                "inputs": [item.strip() for item in inputs],
                "purpose": purpose.strip(),
            }
        )
    return normalized


def _parse_geometry_steps(raw: str | None) -> list[dict[str, Any]]:
    if raw is None or not raw.strip():
        return []
    if len(raw.encode("utf-8")) > MAX_GEOMETRY_STEPS_JSON_BYTES:
        raise ValueError("geometry_steps payload is too large")
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("geometry_steps is not valid JSON") from exc
    return _normalize_geometry_steps(decoded)


def _result(
    *,
    image_sha256: str,
    width: int,
    height: int,
    status: MeasurementStatus,
    reasons: list[str],
    ruler: dict[str, Any] | None = None,
    obj: dict[str, Any] | None = None,
    length_mm: float | None = None,
    width_mm: float | None = None,
    scale_system: str = "unknown",
    scale_px_per_cm: float | None = None,
    scale_px_per_inch: float | None = None,
    geometry_steps: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    valid = status == "valid"
    return {
        "schema_version": "hcsi.measurement.v1",
        "image_sha256": image_sha256,
        "measurement_status": status,
        "analysis_mode": "measurement_assisted" if valid else "appearance_only",
        "measurement_valid": valid,
        "retry_recommended": status == "unreliable",
        "length_mm": round(float(length_mm), 2) if valid and length_mm is not None else None,
        "width_mm": round(float(width_mm), 2) if valid and width_mm is not None else None,
        "scale_system": scale_system,
        "scale_px_per_cm": _round(scale_px_per_cm) if valid else None,
        "scale_px_per_inch": _round(scale_px_per_inch) if valid else None,
        "geometry_steps": geometry_steps or [],
        "image": {"width_px": width, "height_px": height},
        "ruler": ruler or _empty_ruler(),
        "object": obj or _empty_object(),
        "reason_codes": sorted(set(reasons)),
        "capture_assumptions": {
            "same_plane_required": True,
            "same_plane_verified": False,
            "near_overhead_required": True,
            "ruler_parallel_required": False,
            "ruler_parallel_preferred": True,
        },
    }


def measure_rgb(
    image_rgb: np.ndarray,
    image_sha256: str = "synthetic",
    geometry_steps: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    requested_steps = _normalize_geometry_steps(geometry_steps)
    height, width = image_rgb.shape[:2]
    ruler_obs = infer_ruler(image_rgb)
    scale_ref = resolve_scale_reference(image_rgb, ruler_obs)

    metric_perspective_pct = perspective_step_pct(ruler_obs.perspective_ratio)
    using_rulernet_metric = scale_ref.source in {"rulernet_cm", "rulernet_cm+imperial_ticks"}
    perspective_pct = metric_perspective_pct if using_rulernet_metric else scale_ref.perspective_step_pct
    max_perspective = float(os.environ.get("HCSI_MAX_PERSPECTIVE_STEP_PCT", DEFAULT_MAX_PERSPECTIVE_STEP_PCT))
    perspective_ok = perspective_pct is not None and perspective_pct <= max_perspective

    ruler_json: dict[str, Any] = {
        "detected": scale_ref.system != "unknown",
        "mark_count": int(len(scale_ref.reference_points_px)),
        "scale_system": scale_ref.system,
        "scale_source": scale_ref.source,
        "scale_confidence": _round(scale_ref.confidence),
        "px_per_cm": _round(scale_ref.px_per_cm),
        "px_per_inch": _round(scale_ref.px_per_inch),
        "reference_interval_cm": _round(scale_ref.reference_interval_cm, 6),
        "median_px_per_cm": _round(ruler_obs.median_px_per_cm),
        "local_px_per_cm": None,
        "perspective_ratio": _round(ruler_obs.perspective_ratio, 6) if using_rulernet_metric else None,
        "perspective_step_pct": _round(perspective_pct),
        "perspective_ok": perspective_ok,
    }

    if scale_ref.system == "unknown" or scale_ref.px_per_cm is None:
        reasons = list(scale_ref.reason_codes) + list(ruler_obs.gate_reasons)
        return _result(
            image_sha256=image_sha256,
            width=width,
            height=height,
            status="no_reference",
            reasons=reasons or ["scale_reference_not_confirmed"],
            ruler=ruler_json,
            scale_system="unknown",
            geometry_steps=unmeasured_geometry_steps(requested_steps, "scale_reference_not_confirmed"),
        )

    reasons: list[str] = []
    if not perspective_ok:
        reasons.append("perspective_too_strong_for_2d_measurement")

    max_alignment = float(os.environ.get("HCSI_MAX_RULER_ALIGNMENT_DEG", DEFAULT_MAX_ALIGNMENT_DEG))
    geometry = extract_object_geometry(
        image_rgb,
        scale_ref.reference_points_px,
        scale_ref.px_per_cm,
        scale_ref.direction_xy,
        max_alignment_deg=max_alignment,
    )

    local_scale = None
    if using_rulernet_metric and geometry.center_xy is not None:
        local_scale = local_px_per_cm(scale_ref.reference_points_px, geometry.center_xy)
    effective_scale = local_scale or scale_ref.px_per_cm
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
        "risk_signals": list(geometry.risk_signals),
    }
    reasons.extend(geometry.gate_reasons)

    measurement_valid = (
        perspective_ok
        and geometry.detected
        and geometry.contour_reliable
        and effective_scale is not None
        and effective_scale > 0
        and geometry.principal_length_px is not None
        and geometry.principal_width_px is not None
    )
    if not measurement_valid:
        failure_reason = reasons[0] if reasons else "measurement_evidence_unreliable"
        return _result(
            image_sha256=image_sha256,
            width=width,
            height=height,
            status="unreliable",
            reasons=reasons or ["measurement_evidence_unreliable"],
            ruler=ruler_json,
            obj=object_json,
            scale_system=scale_ref.system,
            geometry_steps=unmeasured_geometry_steps(requested_steps, failure_reason),
        )

    length_mm = geometry.principal_length_px / effective_scale * 10.0
    width_mm = geometry.principal_width_px / effective_scale * 10.0
    executed_steps = execute_geometry_steps(
        image_rgb,
        scale_ref.reference_points_px,
        effective_scale,
        requested_steps,
    )
    return _result(
        image_sha256=image_sha256,
        width=width,
        height=height,
        status="valid",
        reasons=[],
        ruler=ruler_json,
        obj=object_json,
        length_mm=length_mm,
        width_mm=width_mm,
        scale_system=scale_ref.system,
        scale_px_per_cm=effective_scale,
        scale_px_per_inch=effective_scale * 2.54,
        geometry_steps=executed_steps,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/measure")
async def measure(
    file: UploadFile = File(...),
    geometry_steps: str | None = Form(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    expected_token = os.environ.get("HCSI_MEASUREMENT_TOKEN", "").strip()
    if expected_token and authorization != f"Bearer {expected_token}":
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        requested_steps = _parse_geometry_steps(geometry_steps)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

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
        return measure_rgb(image_rgb, digest, requested_steps)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
