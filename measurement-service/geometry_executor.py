from __future__ import annotations

import math
from typing import Any

import cv2
import numpy as np

from geometry import (
    _geometry_from_contour,
    _select_physical_object_candidate,
)
from edge_observation import measure_thread_major_diameter
from thread_geometry import (
    HeadUnderfaceEstimate,
    ThreadedShankProfile,
    detect_threaded_shank,
    estimate_head_underface,
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

def _filled_contour_points(contour: np.ndarray) -> np.ndarray:
    x, y, width, height = cv2.boundingRect(contour)
    if width <= 0 or height <= 0:
        return np.empty((0, 2), dtype=np.float64)

    mask = np.zeros((height + 2, width + 2), dtype=np.uint8)
    shifted = contour.astype(np.int32).copy()
    shifted[:, 0, 0] -= x - 1
    shifted[:, 0, 1] -= y - 1
    cv2.drawContours(mask, [shifted], -1, 255, thickness=-1)
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return np.empty((0, 2), dtype=np.float64)
    return np.column_stack((xs + x - 1, ys + y - 1)).astype(np.float64)


def _smooth_width_profile(widths: np.ndarray) -> np.ndarray:
    count = len(widths)
    if count < 3:
        return widths
    kernel = max(3, int(round(count * 0.03)))
    if kernel % 2 == 0:
        kernel += 1
    radius = kernel // 2
    padded = np.pad(widths, radius, mode="edge")
    return np.array([np.median(padded[index : index + kernel]) for index in range(count)], dtype=np.float64)


def _axial_landmarks(contour: np.ndarray) -> dict[str, tuple[float, float]] | None:
    center, axis, _, _, _, _ = _geometry_from_contour(contour)
    axis = np.asarray(axis, dtype=np.float64)
    axis_norm = float(np.linalg.norm(axis))
    if axis_norm < 1e-6:
        return None
    axis /= axis_norm
    normal = np.array([-axis[1], axis[0]], dtype=np.float64)

    points = _filled_contour_points(contour)
    if len(points) < 12:
        return None

    relative = points - center
    axial = relative @ axis
    cross = relative @ normal
    axial_min = float(np.min(axial))
    axial_max = float(np.max(axial))
    bin_count = max(3, int(math.ceil(axial_max - axial_min)) + 1)
    indices = np.clip(np.floor(axial - axial_min).astype(np.int32), 0, bin_count - 1)

    low = np.full(bin_count, np.inf, dtype=np.float64)
    high = np.full(bin_count, -np.inf, dtype=np.float64)
    np.minimum.at(low, indices, cross)
    np.maximum.at(high, indices, cross)
    widths = high - low
    valid = np.isfinite(widths)
    if int(np.count_nonzero(valid)) < 3:
        return None

    samples = np.arange(bin_count, dtype=np.float64)
    widths = np.interp(samples, samples[valid], widths[valid])
    widths = _smooth_width_profile(widths)

    window = max(4, int(round(bin_count * 0.06)))
    margin = max(window + 2, int(round(bin_count * 0.08)))
    best: tuple[float, int] | None = None
    for index in range(margin, bin_count - margin):
        left = float(np.median(widths[max(0, index - window) : index]))
        right = float(np.median(widths[index : min(bin_count, index + window)]))
        narrow = max(min(left, right), 1.0)
        wide = max(left, right)
        delta = wide - narrow
        ratio = wide / narrow
        if ratio < 1.25 or delta < max(2.0, 0.18 * narrow):
            continue
        score = delta * ratio
        if best is None or score > best[0]:
            best = (score, index)

    if best is None:
        return None

    transition_s = axial_min + float(best[1])
    distance_to_min = abs(transition_s - axial_min)
    distance_to_max = abs(axial_max - transition_s)
    tip_s = axial_min if distance_to_min >= distance_to_max else axial_max
    head_top_s = axial_max if tip_s == axial_min else axial_min
    transition_xy = center + axis * transition_s
    tip_xy = center + axis * tip_s
    head_top_xy = center + axis * head_top_s
    if abs(tip_s - transition_s) < 2.0 or abs(tip_s - head_top_s) < 2.0:
        return None

    transition_point = (float(transition_xy[0]), float(transition_xy[1]))
    return {
        "object_tip": (float(tip_xy[0]), float(tip_xy[1])),
        "width_transition": transition_point,
        "head_underface": transition_point,
        "head_top": (float(head_top_xy[0]), float(head_top_xy[1])),
    }


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
                if underface_estimate is None:
                    underface_estimate = estimate_head_underface(shank_profile)
                if underface_estimate is None:
                    results.append(_not_measured(step, "head_underface_not_found"))
                    continue
                if underface_axial is None:
                    underface_axial = _profile_underface_landmarks(
                        shank_profile,
                        underface_estimate,
                    )
                step_landmarks = underface_axial
                diagnostics = {
                    "shank_outer_px": _round(underface_estimate.shank_outer_px),
                    "head_stable_limit_px": _round(underface_estimate.stable_limit_px),
                    "head_expansion_threshold_px": _round(underface_estimate.expansion_threshold_px),
                    "head_expansion_persistence_px": float(underface_estimate.persistence_px),
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

        # D uses raw-image edge observations with per-side quality. Do not
        # silently fall back to the mask boundary when one physical edge is
        # unobservable. P and head-underface still use the unchanged legacy
        # contour profile in this D-only phase.
        if operation == "outer_width":
            observation = measure_thread_major_diameter(image_rgb, shank_profile)
            old_width = measure_outer_width_px(shank_profile)
            diagnostics = {
                "edge_upper_valid_samples": float(np.count_nonzero(observation.upper.valid)),
                "edge_lower_valid_samples": float(np.count_nonzero(observation.lower.valid)),
                "edge_upper_crest_count": float(observation.upper_crest_count),
                "edge_lower_crest_count": float(observation.lower_crest_count),
            }
            for name, track in (("upper", observation.upper), ("lower", observation.lower)):
                if np.any(track.valid):
                    diagnostics[f"edge_{name}_median_contrast"] = _round(float(np.median(track.contrast[track.valid])))
                    diagnostics[f"edge_{name}_median_blur_px"] = _round(float(np.median(track.blur_10_90_px[track.valid])))
                    diagnostics[f"edge_{name}_median_fit_uncertainty_px"] = _round(
                        float(np.median(track.uncertainty_px[track.valid]))
                    )
                    diagnostics[f"edge_{name}_median_relative_residual"] = _round(
                        float(np.median(track.relative_residual[track.valid]))
                    )
            if old_width is not None:
                diagnostics["contour_major_diameter_px"] = _round(old_width)
            if observation.upper_crest_px is not None:
                diagnostics["edge_upper_crest_px"] = _round(observation.upper_crest_px)
            if observation.lower_crest_px is not None:
                diagnostics["edge_lower_crest_px"] = _round(observation.lower_crest_px)
            if observation.positive_normal_relief_px is not None:
                diagnostics["edge_upper_crest_relief_px"] = _round(observation.positive_normal_relief_px)
            if observation.negative_normal_relief_px is not None:
                diagnostics["edge_lower_crest_relief_px"] = _round(observation.negative_normal_relief_px)
            # 0=no defensible D, 1=one trusted flank + separately observed
            # cylindrical axis, 2=two trusted physical flank envelopes.
            diagnostics["edge_diameter_mode_code"] = (
                2.0 if observation.measurement_mode == "two_side"
                else 1.0 if observation.measurement_mode.endswith("independent_axis")
                else 0.0
            )
            diagnostics["edge_axis_reference_samples"] = float(observation.axis_reference_samples)
            if observation.axis_residual_px is not None:
                diagnostics["edge_axis_residual_px"] = _round(observation.axis_residual_px)
            if observation.axis_uncertainty_px is not None:
                diagnostics["edge_axis_uncertainty_px"] = _round(observation.axis_uncertainty_px)
            if observation.axis_slope is not None:
                diagnostics["edge_axis_slope"] = _round(observation.axis_slope, 6)
            if observation.candidate_value_px is not None:
                diagnostics["edge_one_sided_candidate_px"] = _round(observation.candidate_value_px)
            if observation.candidate_uncertainty_px is not None:
                diagnostics["edge_one_sided_uncertainty_px"] = _round(observation.candidate_uncertainty_px)
            if observation.axis_crest_uncertainty_px is not None:
                diagnostics["edge_axis_at_crest_uncertainty_px"] = _round(observation.axis_crest_uncertainty_px)
            if observation.axis_extrapolation_px is not None:
                diagnostics["edge_axis_extrapolation_px"] = _round(observation.axis_extrapolation_px)
            if observation.uncertainty_px is not None:
                diagnostics["edge_diameter_uncertainty_px"] = _round(observation.uncertainty_px)
            if observation.value_px is None:
                results.append(_not_measured(
                    step, observation.reason or "edge_diameter_unreliable", diagnostics,
                ))
                continue
            value_mm = observation.value_px / px_per_cm * 10.0
            if observation.uncertainty_px is not None:
                diagnostics["edge_diameter_uncertainty_mm"] = _round(
                    observation.uncertainty_px / px_per_cm * 10.0,
                )
            results.append(
                {
                    "operation": operation,
                    "inputs": inputs,
                    "purpose": str(step.get("purpose", "")),
                    "status": "measured",
                    "value_px": _round(observation.value_px),
                    "value_mm": _round(value_mm, 2),
                    "derived_tpi": None,
                    "landmarks": _threaded_shank_landmarks(shank_profile),
                    "diagnostics": diagnostics,
                    "reason_codes": [],
                }
            )
            continue

        if outer_width_px is None:
            outer_width_px = measure_outer_width_px(shank_profile)
        if outer_width_px is None:
            results.append(_not_measured(step, "outer_width_unreliable"))
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
