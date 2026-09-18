from __future__ import annotations

import math
from typing import Any

import cv2
import numpy as np

from geometry import (
    _background_distance,
    _candidate_from_mask,
    _edge_mask,
    _geometry_from_contour,
    _ruler_exclusion_mask,
)
from thread_geometry import (
    ThreadedShankProfile,
    detect_threaded_shank,
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
) -> np.ndarray | None:
    height, width = image_rgb.shape[:2]
    distance, base_threshold = _background_distance(image_rgb)
    edge_mask = _edge_mask(image_rgb)
    exclusion, _ = _ruler_exclusion_mask(image_rgb, ruler_mark_points_px, px_per_cm)

    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    selected = []
    for factor in (0.82, 1.0, 1.22):
        color_mask = (distance > base_threshold * factor).astype(np.uint8) * 255
        color_mask[exclusion > 0] = 0
        color_mask = cv2.morphologyEx(color_mask, cv2.MORPH_CLOSE, close_kernel, iterations=2)
        color_mask = cv2.morphologyEx(color_mask, cv2.MORPH_OPEN, open_kernel, iterations=1)
        color_mask[:2, :] = 0
        color_mask[-2:, :] = 0
        color_mask[:, :2] = 0
        color_mask[:, -2:] = 0
        selected.append(_candidate_from_mask(color_mask, edge_mask, width, height))

    nominal = selected[1] or selected[0] or selected[2]

    edge_region = edge_mask.copy()
    edge_region[exclusion > 0] = 0
    edge_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    edge_region = cv2.morphologyEx(edge_region, cv2.MORPH_CLOSE, edge_close, iterations=2)
    edge_region[:2, :] = 0
    edge_region[-2:, :] = 0
    edge_region[:, :2] = 0
    edge_region[:, -2:] = 0
    edge_candidate = _candidate_from_mask(edge_region, edge_mask, width, height)

    if edge_candidate is not None:
        if nominal is None:
            nominal = edge_candidate
        elif nominal.edge_support < 0.12 and edge_candidate.edge_support >= max(0.12, nominal.edge_support * 1.6):
            nominal = edge_candidate
        elif edge_candidate.score > nominal.score * 1.35:
            nominal = edge_candidate

    return None if nominal is None else nominal.contour


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


def _axial_landmarks(contour: np.ndarray) -> tuple[dict[str, tuple[float, float]], float] | None:
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
    transition_xy = center + axis * transition_s
    tip_xy = center + axis * tip_s
    distance_px = abs(tip_s - transition_s)
    if distance_px < 2.0:
        return None

    return (
        {
            "object_tip": (float(tip_xy[0]), float(tip_xy[1])),
            "width_transition": (float(transition_xy[0]), float(transition_xy[1])),
        },
        float(distance_px),
    )


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
) -> list[dict[str, Any]]:
    if not steps:
        return []
    if not np.isfinite(px_per_cm) or px_per_cm <= 0:
        return unmeasured_geometry_steps(steps, "scale_unavailable")

    contour = _select_object_contour(image_rgb, ruler_mark_points_px, px_per_cm)
    if contour is None:
        return unmeasured_geometry_steps(steps, "object_contour_not_found")

    axial = None
    shank_profile: ThreadedShankProfile | None = None
    outer_width_px: float | None = None
    results: list[dict[str, Any]] = []

    for step in steps:
        operation = str(step.get("operation", ""))
        inputs = [str(value) for value in step.get("inputs", [])]

        if operation == "axial_distance":
            if set(inputs) != {"object_tip", "width_transition"} or len(inputs) != 2:
                results.append(_not_measured(step, "unsupported_landmark_combination"))
                continue
            if axial is None:
                axial = _axial_landmarks(contour)
            if axial is None:
                results.append(_not_measured(step, "width_transition_not_found"))
                continue

            landmarks, value_px = axial
            value_mm = value_px / px_per_cm * 10.0
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
                        for name, point in landmarks.items()
                    },
                    "diagnostics": {},
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
