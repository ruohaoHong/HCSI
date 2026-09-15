from __future__ import annotations

import math

import cv2
import numpy as np


def _unit(vector: np.ndarray) -> np.ndarray | None:
    norm = float(np.linalg.norm(vector))
    if not np.isfinite(norm) or norm < 1e-6:
        return None
    out = vector.astype(np.float64) / norm
    if out[0] < 0 or (abs(out[0]) < 1e-6 and out[1] < 0):
        out = -out
    return out


def _interval(a: np.ndarray, b: np.ndarray, origin: np.ndarray, axis: np.ndarray) -> tuple[float, float]:
    values = np.array([np.dot(a - origin, axis), np.dot(b - origin, axis)], dtype=np.float64)
    return float(np.min(values)), float(np.max(values))


def expand_reference_points_to_ruler_body(
    image_rgb: np.ndarray,
    reference_points_px: np.ndarray,
    direction_xy: tuple[float, float] | None,
    px_per_cm: float,
) -> np.ndarray:
    """Expand a local visual tick sequence to the visible ruler-body span.

    Visual imperial detection may only return a short run of reliable minor
    ticks. Geometry exclusion must not treat the first/last detected tick as
    the physical ruler ends.

    A plausible pair of long parallel body edges is still required as a guard,
    but the axial span comes from the longest edge anchored nearest the visual
    tick line. This matters when the opposite ruler edge is fragmented by text
    or crop artifacts: using only the overlap of the two edges would leave a
    ruler remnant outside the exclusion mask and that remnant can merge with the
    nearby hardware contour.

    If a trustworthy ruler structure cannot be found, the original points are
    returned unchanged so callers fail conservatively rather than inventing a
    larger exclusion region.
    """
    points = np.asarray(reference_points_px, dtype=np.float64)
    if (
        image_rgb.ndim != 3
        or image_rgb.shape[2] != 3
        or len(points) < 2
        or not np.isfinite(px_per_cm)
        or px_per_cm <= 0
    ):
        return points.astype(np.float32)

    axis = None
    if direction_xy is not None:
        axis = _unit(np.asarray(direction_xy, dtype=np.float64))
    if axis is None:
        axis = _unit(points[-1] - points[0])
    if axis is None:
        return points.astype(np.float32)

    normal = np.array([-axis[1], axis[0]], dtype=np.float64)
    origin = np.mean(points, axis=0)
    projections = (points - origin) @ axis
    mark_min = float(np.min(projections))
    mark_max = float(np.max(projections))
    mark_span = max(mark_max - mark_min, px_per_cm * 0.35)

    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 45, 135)
    raw_lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180.0,
        threshold=max(24, int(mark_span * 0.10)),
        minLineLength=max(70, int(mark_span * 0.45)),
        maxLineGap=max(18, int(px_per_cm * 0.30)),
    )
    if raw_lines is None:
        return points.astype(np.float32)

    height, width = gray.shape
    max_offset = min(float(min(height, width)) * 0.24, px_per_cm * 1.55)
    candidates: list[tuple[np.ndarray, np.ndarray, float, float, float, float]] = []
    for x1, y1, x2, y2 in raw_lines[:, 0, :]:
        a = np.array([float(x1), float(y1)])
        b = np.array([float(x2), float(y2)])
        direction = _unit(b - a)
        if direction is None:
            continue
        cosine = float(np.clip(abs(np.dot(direction, axis)), 0.0, 1.0))
        if math.degrees(math.acos(cosine)) > 7.0:
            continue

        midpoint = (a + b) * 0.5
        offset = float(np.dot(midpoint - origin, normal))
        if abs(offset) > max_offset:
            continue

        lo, hi = _interval(a, b, origin, axis)
        overlap = max(0.0, min(hi, mark_max) - max(lo, mark_min)) / max(mark_span, 1.0)
        if overlap < 0.35:
            continue
        length = float(np.linalg.norm(b - a))
        candidates.append((a, b, offset, lo, hi, length * (0.6 + overlap)))

    if len(candidates) < 2:
        return points.astype(np.float32)

    min_body_width = max(12.0, px_per_cm * 0.22)
    max_body_width = min(max_offset * 1.7, px_per_cm * 1.45)
    near_tick_tolerance = max(8.0, px_per_cm * 0.18)
    best_pair: tuple[tuple[np.ndarray, np.ndarray, float, float, float, float], tuple[np.ndarray, np.ndarray, float, float, float, float]] | None = None
    best_score = -1.0

    for index, first in enumerate(candidates):
        for second in candidates[index + 1 :]:
            off_a = first[2]
            off_b = second[2]
            body_width = abs(off_b - off_a)
            if body_width < min_body_width or body_width > max_body_width:
                continue

            low_offset, high_offset = sorted((off_a, off_b))
            distance_to_body = 0.0 if low_offset <= 0.0 <= high_offset else min(abs(low_offset), abs(high_offset))
            if distance_to_body > near_tick_tolerance:
                continue

            span_low = max(first[3], second[3])
            span_high = min(first[4], second[4])
            body_span = span_high - span_low
            if body_span < mark_span * 1.15:
                continue

            score = (first[5] + second[5]) * (1.0 + min(body_span / max(mark_span, 1.0), 3.0) * 0.2)
            if score > best_score:
                best_score = score
                best_pair = (first, second)

    if best_pair is None:
        return points.astype(np.float32)

    # The visual tick sequence is normally anchored close to one physical ruler
    # edge. Prefer the longest line nearest that tick/reference line for the
    # longitudinal extent. It is often more complete than the opposite edge.
    anchor_limit = max(6.0, px_per_cm * 0.14)
    anchored = [candidate for candidate in candidates if abs(candidate[2]) <= anchor_limit]
    if anchored:
        anchor = max(
            anchored,
            key=lambda candidate: candidate[5]
            * (1.0 + max(0.0, 1.0 - abs(candidate[2]) / anchor_limit)),
        )
        span_low = anchor[3]
        span_high = anchor[4]
    else:
        first, second = best_pair
        span_low = max(first[3], second[3])
        span_high = min(first[4], second[4])

    if span_high <= span_low:
        return points.astype(np.float32)

    body_start = origin + axis * span_low
    body_end = origin + axis * span_high
    expanded = np.vstack([points, body_start, body_end])
    order = np.argsort((expanded - origin) @ axis)
    return expanded[order].astype(np.float32)
