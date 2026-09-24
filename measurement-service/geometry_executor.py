from __future__ import annotations

from typing import Any

import numpy as np

from geometry import (
    _select_physical_object_candidate,
)
from thread_geometry import (
    HeadUnderfaceEstimate,
    HeadBodyStructure,
    ThreadedShankProfile,
    detect_threaded_shank,
    decompose_head_body,
    measure_outer_width_px,
    measure_periodicity_px,
)


GeometryStep = dict[str, Any]


def _round(value: float | None, digits: int = 3) -> float | None:
    return None if value is None else round(float(value), digits)


def _not_measured(
    step: GeometryStep,
    reason: str,
    diagnostics: dict[str, float] | None = None,
) -> dict[str, Any]:
    return {
        "operation": str(step.get("operation", "")),
        "inputs": [str(value) for value in step.get("inputs", [])],
        "purpose": str(step.get("purpose", "")),
        "status": "not_measured",
        "value_px": None,
        "value_mm": None,
        "derived_tpi": None,
        "landmarks": {},
        "diagnostics": diagnostics or {},
        "reason_codes": [reason],
    }


def unmeasured_geometry_steps(steps: list[GeometryStep], reason: str) -> list[dict[str, Any]]:
    return [_not_measured(step, reason) for step in steps]


def _select_object_contour(
    image_rgb: np.ndarray,
    ruler_mark_points_px: np.ndarray,
    px_per_cm: float,
    semantic_vision: dict | None = None,
) -> np.ndarray | None:
    selection = _select_physical_object_candidate(
        image_rgb,
        ruler_mark_points_px,
        px_per_cm,
        semantic_vision=semantic_vision,
    )
    return None if selection.candidate is None else selection.candidate.contour


def _axial_landmarks(contour: np.ndarray) -> dict[str, tuple[float, float]] | None:
    """Use the same axis, endpoints and shaft partition as D/P/under-head L."""
    profile = detect_threaded_shank(contour)
    if profile is None:
        return None
    direction = 1 if profile.transition_s > profile.tip_s else -1
    top = float(profile.s_values[-1] if direction > 0 else profile.s_values[0])
    positions = {"object_tip": profile.tip_s,
                 "width_transition": profile.transition_s, "head_top": top}
    return {name: tuple(float(v) for v in profile.center + profile.axis * s)
            for name, s in positions.items()}


def _profile_underface_landmarks(
    profile: ThreadedShankProfile,
    estimate: HeadUnderfaceEstimate,
) -> dict[str, tuple[float, float]]:
    tip_xy = profile.center + profile.axis * profile.tip_s
    underface_xy = profile.center + profile.axis * estimate.s

    toward_head = 1 if profile.transition_s > profile.tip_s else -1
    head_top_s = float(profile.s_values[-1] if toward_head > 0 else profile.s_values[0])
    head_top_xy = profile.center + profile.axis * head_top_s
    return {
        "object_tip": (float(tip_xy[0]), float(tip_xy[1])),
        "head_underface": (float(underface_xy[0]), float(underface_xy[1])),
        "head_top": (float(head_top_xy[0]), float(head_top_xy[1])),
    }


def _threaded_shank_landmarks(profile: ThreadedShankProfile) -> dict[str, dict[str, float | None]]:
    return {
        "threaded_shank_start": {
            "x_px": _round(profile.start_xy[0]),
            "y_px": _round(profile.start_xy[1]),
        },
        "threaded_shank_end": {
            "x_px": _round(profile.end_xy[0]),
            "y_px": _round(profile.end_xy[1]),
        },
    }


def execute_geometry_steps(
    image_rgb: np.ndarray,
    ruler_mark_points_px: np.ndarray,
    px_per_cm: float,
    steps: list[GeometryStep],
    semantic_vision: dict | None = None,
) -> list[dict[str, Any]]:
    if not steps:
        return []
    if not np.isfinite(px_per_cm) or px_per_cm <= 0:
        return unmeasured_geometry_steps(steps, "scale_unavailable")

    contour = _select_object_contour(
        image_rgb,
        ruler_mark_points_px,
        px_per_cm,
        semantic_vision=semantic_vision,
    )
    if contour is None:
        return unmeasured_geometry_steps(steps, "object_contour_not_found")

    axial = None
    structure: HeadBodyStructure | None = None
    underface_axial: dict[str, tuple[float, float]] | None = None
    underface_estimate: HeadUnderfaceEstimate | None = None
    shank_profile: ThreadedShankProfile | None = None
    outer_width_px: float | None = None
    results: list[dict[str, Any]] = []

    for step in steps:
        operation = str(step.get("operation", ""))
        inputs = [str(value) for value in step.get("inputs", [])]

        if operation == "axial_distance":
            supported_pairs = {
                frozenset(("object_tip", "width_transition")),
                frozenset(("object_tip", "head_underface")),
                frozenset(("object_tip", "head_top")),
            }
            if len(inputs) != 2 or frozenset(inputs) not in supported_pairs:
                results.append(_not_measured(step, "unsupported_landmark_combination"))
                continue
            diagnostics: dict[str, float] = {}
            if "head_underface" in inputs:
                if shank_profile is None:
                    shank_profile = detect_threaded_shank(contour)
                if shank_profile is None:
                    results.append(_not_measured(step, "head_underface_not_found"))
                    continue
                if structure is None:
                    structure = decompose_head_body(shank_profile)
                underface_estimate = structure.bearing_plane
                if underface_estimate is None:
                    results.append(_not_measured(step, structure.reason_code or "bearing_plane_unresolved"))
                    continue
                if underface_axial is None:
                    underface_axial = _profile_underface_landmarks(
                        shank_profile,
                        underface_estimate,
                    )
                step_landmarks = underface_axial
                diagnostics = {
                    "shank_outer_px": _round(underface_estimate.shank_outer_px),
                    "bearing_radial_support_px": _round(underface_estimate.radial_support_px),
                    "bearing_fit_residual_px": _round(underface_estimate.fit_residual_px),
                    "bearing_side_disagreement_px": _round(underface_estimate.side_disagreement_px),
                    "neck_to_bearing_px": _round(abs(underface_estimate.s - structure.transition_start_s)),
                }
            else:
                if axial is None:
                    axial = _axial_landmarks(contour)
                if axial is None:
                    reason = (
                        "width_transition_not_found"
                        if "width_transition" in inputs
                        else "fastener_axial_landmarks_not_found"
                    )
                    results.append(_not_measured(step, reason))
                    continue
                step_landmarks = axial

            first = step_landmarks.get(inputs[0])
            second = step_landmarks.get(inputs[1])
            if first is None or second is None:
                results.append(_not_measured(step, "requested_landmark_not_found"))
                continue
            value_px = float(np.linalg.norm(np.asarray(first) - np.asarray(second)))
            if value_px < 2.0:
                results.append(_not_measured(step, "axial_distance_too_small"))
                continue
            value_mm = value_px / px_per_cm * 10.0
            selected_landmarks = {name: step_landmarks[name] for name in inputs}
            results.append(
                {
                    "operation": operation,
                    "inputs": inputs,
                    "purpose": str(step.get("purpose", "")),
                    "status": "measured",
                    "value_px": _round(value_px),
                    "value_mm": _round(value_mm, 2),
                    "derived_tpi": None,
                    "landmarks": {
                        name: {"x_px": _round(point[0]), "y_px": _round(point[1])}
                        for name, point in selected_landmarks.items()
                    },
                    "diagnostics": diagnostics,
                    "reason_codes": [],
                }
            )
            continue

        if operation not in {"outer_width", "periodicity"}:
            results.append(_not_measured(step, "operation_not_implemented"))
            continue
        if inputs != ["threaded_shank"]:
            results.append(_not_measured(step, "unsupported_region_combination"))
            continue

        if shank_profile is None:
            shank_profile = detect_threaded_shank(contour)
        if shank_profile is None:
            results.append(_not_measured(step, "threaded_shank_not_found"))
            continue

        if outer_width_px is None:
            outer_width_px = measure_outer_width_px(shank_profile)
        if outer_width_px is None:
            results.append(_not_measured(step, "outer_width_unreliable"))
            continue

        if operation == "outer_width":
            value_mm = outer_width_px / px_per_cm * 10.0
            results.append(
                {
                    "operation": operation,
                    "inputs": inputs,
                    "purpose": str(step.get("purpose", "")),
                    "status": "measured",
                    "value_px": _round(outer_width_px),
                    "value_mm": _round(value_mm, 2),
                    "derived_tpi": None,
                    "landmarks": _threaded_shank_landmarks(shank_profile),
                    "diagnostics": {},
                    "reason_codes": [],
                }
            )
            continue

        periodicity = measure_periodicity_px(shank_profile, outer_width_px)
        diagnostics = {
            key: value
            for key, value in {
                "left_pitch_px": _round(periodicity.left_pitch_px),
                "right_pitch_px": _round(periodicity.right_pitch_px),
                "left_periodicity_score": _round(periodicity.left_score),
                "right_periodicity_score": _round(periodicity.right_score),
                "left_autocorrelation_px": _round(periodicity.left_autocorrelation_px),
                "right_autocorrelation_px": _round(periodicity.right_autocorrelation_px),
                "left_frequency_px": _round(periodicity.left_frequency_px),
                "right_frequency_px": _round(periodicity.right_frequency_px),
                "left_peak_spacing_px": _round(periodicity.left_peak_spacing_px),
                "right_peak_spacing_px": _round(periodicity.right_peak_spacing_px),
                "width_pitch_px": _round(periodicity.width_pitch_px),
                "width_periodicity_score": _round(periodicity.width_score),
                "width_autocorrelation_px": _round(periodicity.width_autocorrelation_px),
                "width_frequency_px": _round(periodicity.width_frequency_px),
                "width_peak_spacing_px": _round(periodicity.width_peak_spacing_px),
            }.items()
            if value is not None
        }
        if periodicity.pitch_px is None:
            results.append(
                _not_measured(
                    step,
                    periodicity.reason_code or "periodicity_unreliable",
                    diagnostics,
                )
            )
            continue

        pitch_mm = periodicity.pitch_px / px_per_cm * 10.0
        derived_tpi = 25.4 / pitch_mm
        results.append(
            {
                "operation": operation,
                "inputs": inputs,
                "purpose": str(step.get("purpose", "")),
                "status": "measured",
                "value_px": _round(periodicity.pitch_px),
                "value_mm": _round(pitch_mm, 3),
                "derived_tpi": _round(derived_tpi, 2),
                "landmarks": _threaded_shank_landmarks(shank_profile),
                "diagnostics": diagnostics,
                "reason_codes": [],
            }
        )

    return results
