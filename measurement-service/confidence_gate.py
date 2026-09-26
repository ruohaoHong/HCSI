"""Evidence-based confidence gate for deterministic measurements.

The geometry pipeline answers whether it produced a number.  This module
answers the separate question of whether observable evidence supports using
that number as a verified specification.  It deliberately does not modify or
recalculate D, P, L, scale, or any geometry-step value.

No percentage confidence score is emitted: the checks are qualitative,
machine-readable evidence states.  In particular, a clear ruler and low
one-dimensional perspective progression cannot prove that the ruler and the
hardware occupy the same physical plane.
"""
from __future__ import annotations

import json
from typing import Any, Literal

import numpy as np


MeasurementConfidence = Literal[
    "measured", "verified", "uncertain", "not_measured"
]
CheckStatus = Literal["passed", "failed", "unknown", "not_applicable"]

_CAPTURE_STATUSES = {"verified", "rejected", "unknown"}
_CAPTURE_SOURCES = {
    "manual_confirmation",
    "calibrated_capture",
    "multi_view_calibration",
}


def parse_capture_evidence(raw: str | None) -> dict[str, Any] | None:
    """Parse optional externally supplied capture evidence.

    Current single-image analysis supplies no such evidence.  The schema is
    intentionally small so a future calibrated capture or explicit human
    confirmation can be connected without changing the confidence output.
    """
    if raw is None or not raw.strip():
        return None
    if len(raw.encode("utf-8")) > 4_000:
        raise ValueError("capture_evidence payload is too large")
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("capture_evidence is not valid JSON") from exc
    return normalize_capture_evidence(decoded)


def normalize_capture_evidence(value: Any) -> dict[str, dict[str, str]]:
    """Validate evidence without treating an unsupported claim as proof."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("capture_evidence must be a JSON object")

    normalized: dict[str, dict[str, str]] = {}
    unknown = set(value) - {"same_plane", "near_overhead"}
    if unknown:
        raise ValueError("capture_evidence contains unsupported fields")
    for name in ("same_plane", "near_overhead"):
        raw = value.get(name)
        if raw is None:
            continue
        if not isinstance(raw, dict):
            raise ValueError(f"capture_evidence.{name} must be an object")
        status = raw.get("status")
        source = raw.get("source")
        if status not in _CAPTURE_STATUSES:
            raise ValueError(
                f"capture_evidence.{name}.status must be verified, rejected, or unknown"
            )
        if not isinstance(source, str) or source not in _CAPTURE_SOURCES:
            raise ValueError(f"capture_evidence.{name}.source is unsupported")
        normalized[name] = {"status": status, "source": source}
    return normalized


def _check(
    check_id: str,
    status: CheckStatus,
    *,
    required: bool,
    reason_code: str | None = None,
    evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": check_id,
        "status": status,
        "required": required,
        "reason_code": reason_code,
        "evidence": evidence or {},
    }


def determine_confidence_status(
    has_measurement: bool,
    checks: list[dict[str, Any]],
) -> MeasurementConfidence:
    """Collapse explicit checks without inventing a numeric confidence score."""
    if not has_measurement:
        return "not_measured"
    if not checks:
        # Reserved for callers that have produced a number but have not yet
        # run a verification policy.
        return "measured"
    required = [check for check in checks if bool(check.get("required"))]
    if required and all(check.get("status") == "passed" for check in required):
        return "verified"
    return "uncertain"


def _capture_check(
    check_id: str,
    capture: dict[str, dict[str, str]],
    key: str,
    unknown_reason: str,
    rejected_reason: str,
) -> dict[str, Any]:
    observation = capture.get(key)
    if observation is None or observation["status"] == "unknown":
        return _check(
            check_id,
            "unknown",
            required=True,
            reason_code=unknown_reason,
            evidence={
                "source": None if observation is None else observation["source"],
                "inferred_from_image": False,
            },
        )
    if observation["status"] == "rejected":
        return _check(
            check_id,
            "failed",
            required=True,
            reason_code=rejected_reason,
            evidence={"source": observation["source"], "inferred_from_image": False},
        )
    return _check(
        check_id,
        "passed",
        required=True,
        evidence={"source": observation["source"], "inferred_from_image": False},
    )


def _recommendations(reason_codes: list[str]) -> list[dict[str, str]]:
    mapping = {
        "scale_reference_not_confirmed": (
            "include_scale_reference",
            "請重新拍攝，讓已知尺制與多個完整刻度清楚入鏡；仍可先使用僅外觀辨識。",
        ),
        "scale_observation_support_insufficient": (
            "show_more_scale_marks",
            "請讓更多連續刻度清楚入鏡，避免遮擋或只露出極短尺段。",
        ),
        "perspective_risk_detected": (
            "retake_near_overhead",
            "請改為接近垂直俯拍，並讓尺與五金位於影像中央附近。",
        ),
        "perspective_evidence_unavailable": (
            "capture_perspective_evidence",
            "請以接近垂直俯拍重拍；目前影像沒有足夠證據驗證透視風險。",
        ),
        "same_plane_unverified": (
            "confirm_same_plane",
            "請將尺與五金平放在同一硬質平面後重拍；目前無法由單張照片確認共面。",
        ),
        "same_plane_rejected": (
            "place_on_same_plane",
            "請將尺與五金放在同一平面後重新拍攝。",
        ),
        "capture_orientation_unverified": (
            "confirm_capture_orientation",
            "請以接近垂直俯拍方式重拍；目前未獨立驗證拍攝姿態。",
        ),
        "capture_orientation_rejected": (
            "retake_near_overhead",
            "拍攝角度不符合量測條件，請接近垂直俯拍後重試。",
        ),
        "object_geometry_unreliable": (
            "isolate_hardware",
            "請讓五金完整入鏡、避免裁切，並使用對比清楚的單純背景。",
        ),
        "segmentation_risk_detected": (
            "reduce_segmentation_risk",
            "請分開尺與五金的輪廓、減少遮擋與重疊後重拍。",
        ),
        "semantic_target_unconfirmed": (
            "confirm_measurement_target",
            "請確認框選的量測目標與五金本體一致。",
        ),
        "semantic_reference_unconfirmed": (
            "confirm_scale_reference",
            "請確認尺度參考區域只涵蓋尺，並避免與五金重疊。",
        ),
        "geometry_steps_not_requested": (
            "request_semantic_dimensions",
            "目前只有外形包絡估計；如需採購規格，請要求對應的 D、P、L 幾何量測。",
        ),
        "geometry_steps_incomplete": (
            "retake_for_missing_geometry",
            "部分必要尺寸沒有可靠量到；請依失敗步驟的原因改善拍攝後重試。",
        ),
    }
    result: list[dict[str, str]] = []
    used: set[str] = set()
    for reason in reason_codes:
        item = mapping.get(reason)
        if item is None or item[0] in used:
            continue
        used.add(item[0])
        result.append({"code": item[0], "message": item[1]})
    return result


def evaluate_measurement_confidence(
    *,
    measurement_status: str,
    has_measurement: bool,
    ruler: dict[str, Any],
    object_evidence: dict[str, Any],
    geometry_steps: list[dict[str, Any]],
    capture_evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Evaluate observable evidence without altering measurement outputs."""
    capture = normalize_capture_evidence(capture_evidence)
    checks: list[dict[str, Any]] = []

    scale_available = bool(
        ruler.get("detected")
        and ruler.get("scale_system") != "unknown"
        and isinstance(ruler.get("px_per_cm"), (int, float))
        and np.isfinite(ruler["px_per_cm"])
        and float(ruler["px_per_cm"]) > 0
    )
    checks.append(
        _check(
            "scale_available",
            "passed" if scale_available else "failed",
            required=True,
            reason_code=None if scale_available else "scale_reference_not_confirmed",
            evidence={
                "system": ruler.get("scale_system", "unknown"),
                "source": ruler.get("scale_source", "none"),
                "px_per_cm_present": ruler.get("px_per_cm") is not None,
            },
        )
    )

    mark_count = int(ruler.get("mark_count") or 0)
    scale_supported = scale_available and mark_count >= 4
    checks.append(
        _check(
            "scale_observation_support",
            "passed" if scale_supported else ("failed" if scale_available else "not_applicable"),
            required=True,
            reason_code=(
                None
                if scale_supported or not scale_available
                else "scale_observation_support_insufficient"
            ),
            evidence={"reference_point_count": mark_count, "minimum_required": 4},
        )
    )

    perspective = ruler.get("perspective_step_pct")
    if perspective is None:
        perspective_status: CheckStatus = "unknown"
        perspective_reason = "perspective_evidence_unavailable"
    elif bool(ruler.get("perspective_ok")):
        perspective_status = "passed"
        perspective_reason = None
    else:
        perspective_status = "failed"
        perspective_reason = "perspective_risk_detected"
    checks.append(
        _check(
            "perspective_risk",
            perspective_status,
            required=True,
            reason_code=perspective_reason,
            evidence={
                "perspective_step_pct": perspective,
                "uses_one_dimensional_scale_progression": True,
            },
        )
    )

    object_ok = bool(
        object_evidence.get("detected") and object_evidence.get("contour_reliable")
    )
    checks.append(
        _check(
            "object_geometry",
            "passed" if object_ok else "failed",
            required=True,
            reason_code=None if object_ok else "object_geometry_unreliable",
            evidence={
                "detected": bool(object_evidence.get("detected")),
                "contour_reliable": bool(object_evidence.get("contour_reliable")),
                "segmentation_method": object_evidence.get("segmentation_method", "unknown"),
            },
        )
    )

    risks = list(object_evidence.get("risk_signals") or [])
    segmentation_risks = [risk for risk in risks if risk != "object_ruler_alignment_unknown"]
    checks.append(
        _check(
            "segmentation_risk",
            "passed" if not segmentation_risks else "failed",
            required=True,
            reason_code=None if not segmentation_risks else "segmentation_risk_detected",
            evidence={"risk_signals": segmentation_risks},
        )
    )

    target = object_evidence.get("semantic_target_region") or {}
    target_present = bool(target.get("present"))
    target_applied = "+semantic_roi" in str(
        object_evidence.get("segmentation_method", "")
    )
    semantic_optional = object_evidence.get("semantic_routing_supplied") is False
    if semantic_optional:
        target_status: CheckStatus = "not_applicable"
        target_reason = None
    elif not target_present:
        target_status = "unknown"
        target_reason = "semantic_target_unconfirmed"
    elif target_applied:
        target_status = "passed"
        target_reason = None
    else:
        target_status = "failed"
        target_reason = "semantic_target_unconfirmed"
    checks.append(
        _check(
            "semantic_target_consistency",
            target_status,
            required=not semantic_optional,
            reason_code=target_reason,
            evidence={
                "present": target_present,
                "confidence": target.get("confidence"),
                "applied_to_segmentation": target_applied,
            },
        )
    )

    reference = object_evidence.get("semantic_reference_region") or {}
    reference_present = bool(reference.get("present"))
    reference_applied = "+semantic_reference_exclusion" in str(
        object_evidence.get("segmentation_method", "")
    )
    if semantic_optional:
        reference_status: CheckStatus = "not_applicable"
        reference_reason = None
    elif not reference_present:
        reference_status = "unknown"
        reference_reason = "semantic_reference_unconfirmed"
    elif reference_applied:
        reference_status = "passed"
        reference_reason = None
    else:
        reference_status = "failed"
        reference_reason = "semantic_reference_unconfirmed"
    checks.append(
        _check(
            "semantic_reference_consistency",
            reference_status,
            required=not semantic_optional,
            reason_code=reference_reason,
            evidence={
                "present": reference_present,
                "confidence": reference.get("confidence"),
                "applied_to_segmentation": reference_applied,
            },
        )
    )

    if not geometry_steps:
        geometry_status: CheckStatus = "unknown"
        geometry_reason = "geometry_steps_not_requested"
    elif all(step.get("status") == "measured" for step in geometry_steps):
        geometry_status = "passed"
        geometry_reason = None
    else:
        geometry_status = "failed"
        geometry_reason = "geometry_steps_incomplete"
    checks.append(
        _check(
            "geometry_steps_complete",
            geometry_status,
            required=True,
            reason_code=geometry_reason,
            evidence={
                "requested": len(geometry_steps),
                "measured": sum(
                    step.get("status") == "measured" for step in geometry_steps
                ),
                "failed_operations": [
                    step.get("operation")
                    for step in geometry_steps
                    if step.get("status") != "measured"
                ],
            },
        )
    )
    for index, step in enumerate(geometry_steps):
        measured = step.get("status") == "measured"
        checks.append(
            _check(
                f"geometry_step_{index}",
                "passed" if measured else "failed",
                required=True,
                reason_code=(
                    None
                    if measured
                    else str((step.get("reason_codes") or ["geometry_step_failed"])[0])
                ),
                evidence={
                    "operation": step.get("operation"),
                    "inputs": list(step.get("inputs") or []),
                    "status": step.get("status"),
                },
            )
        )

    checks.append(
        _capture_check(
            "same_plane",
            capture,
            "same_plane",
            "same_plane_unverified",
            "same_plane_rejected",
        )
    )
    checks.append(
        _capture_check(
            "near_overhead_capture",
            capture,
            "near_overhead",
            "capture_orientation_unverified",
            "capture_orientation_rejected",
        )
    )

    status = determine_confidence_status(has_measurement, checks)
    reason_codes = []
    for check in checks:
        if (
            check["status"] in {"failed", "unknown"}
            and check["reason_code"]
            and check["reason_code"] not in reason_codes
        ):
            reason_codes.append(check["reason_code"])
    if measurement_status != "valid" and not reason_codes:
        reason_codes.append("measurement_value_unavailable")

    return {
        "status": status,
        "measurement_state": "measured" if has_measurement else "not_measured",
        "reason_codes": reason_codes,
        "checks": checks,
        "recommendations": _recommendations(reason_codes),
        "verified_for_purchase_spec": status == "verified",
    }
