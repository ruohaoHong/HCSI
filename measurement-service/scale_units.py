from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Literal

import cv2
import numpy as np

ScaleSystem = Literal["metric", "imperial", "dual", "unknown"]


@dataclass(frozen=True)
class VisualScaleObservation:
    system: ScaleSystem
    confidence: float
    px_per_cm: float | None
    px_per_inch: float | None
    minor_tick_px: float | None
    reference_interval_cm: float | None
    reference_points_px: np.ndarray
    direction_xy: tuple[float, float] | None
    perspective_step_pct: float | None
    reason_codes: tuple[str, ...]


@dataclass(frozen=True)
class _Line:
    a: np.ndarray
    b: np.ndarray
    direction: np.ndarray
    midpoint: np.ndarray
    length: float


@dataclass(frozen=True)
class _TickPattern:
    system: Literal["metric", "imperial"]
    confidence: float
    px_per_cm: float
    px_per_inch: float | None
    minor_tick_px: float
    reference_interval_cm: float
    points_xy: np.ndarray
    perspective_step_pct: float
    repeat_period: int


def _unit(vector: np.ndarray) -> np.ndarray | None:
    norm = float(np.linalg.norm(vector))
    if not np.isfinite(norm) or norm < 1e-6:
        return None
    out = vector.astype(np.float64) / norm
    if out[0] < 0 or (abs(out[0]) < 1e-6 and out[1] < 0):
        out = -out
    return out


def _corr(values: np.ndarray, period: int) -> float:
    if len(values) <= period + 3:
        return -1.0
    a = values[:-period]
    b = values[period:]
    valid = np.isfinite(a) & np.isfinite(b)
    if int(np.count_nonzero(valid)) < 4:
        return -1.0
    a = a[valid]
    b = b[valid]
    if float(np.std(a)) < 1e-6 or float(np.std(b)) < 1e-6:
        return -1.0
    return float(np.corrcoef(a, b)[0, 1])


def _cluster_ticks(items: list[tuple[float, float, np.ndarray]], merge_px: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    if not items:
        return np.empty(0), np.empty(0), np.empty((0, 2))
    ordered = sorted(items, key=lambda item: item[0])
    groups: list[list[tuple[float, float, np.ndarray]]] = []
    for item in ordered:
        if not groups or item[0] - groups[-1][-1][0] > merge_px:
            groups.append([item])
        else:
            groups[-1].append(item)
    positions: list[float] = []
    lengths: list[float] = []
    points: list[np.ndarray] = []
    for group in groups:
        positions.append(float(np.mean([item[0] for item in group])))
        lengths.append(float(max(item[1] for item in group)))
        points.append(np.mean(np.stack([item[2] for item in group]), axis=0))
    return np.asarray(positions), np.asarray(lengths), np.stack(points)


def _estimate_minor_pitch(positions: np.ndarray) -> float | None:
    if len(positions) < 7:
        return None
    ordered = np.sort(positions.astype(np.float64))
    gaps = np.diff(ordered)
    gaps = gaps[np.isfinite(gaps) & (gaps >= 3.0)]
    if len(gaps) < 5:
        return None

    cutoff = float(np.percentile(gaps, 80))
    candidates = gaps[gaps <= cutoff]
    if len(candidates) == 0:
        return None

    best: tuple[float, float] | None = None
    for pitch in candidates:
        tolerance = max(2.5, float(pitch) * 0.18)
        support = 0
        residual_score = float("inf")
        for origin in ordered:
            indices = np.rint((ordered - origin) / pitch)
            residuals = np.abs(ordered - (origin + indices * pitch))
            good = residuals <= tolerance
            count = int(np.count_nonzero(good))
            mean_residual = float(np.mean(residuals[good])) if count else float("inf")
            if count > support or (count == support and mean_residual < residual_score):
                support = count
                residual_score = mean_residual
        score = support - min(residual_score / max(float(pitch), 1.0), 1.0)
        if best is None or score > best[0]:
            best = (score, float(pitch))

    if best is None or best[1] < 3.0:
        return None
    return best[1]


def _lattice_sequence(
    positions: np.ndarray,
    lengths: np.ndarray,
    points: np.ndarray,
    pitch: float,
) -> tuple[np.ndarray, np.ndarray, float] | None:
    best: tuple[int, float, np.ndarray, np.ndarray] | None = None
    tolerance = max(2.5, pitch * 0.18)
    for origin in positions[: min(8, len(positions))]:
        indices = np.rint((positions - origin) / pitch).astype(np.int32)
        residual = np.abs(positions - (origin + indices * pitch))
        good = residual <= tolerance
        score = int(np.count_nonzero(good))
        if best is None or score > best[0]:
            best = (score, float(origin), indices, good)
    if best is None or best[0] < 7:
        return None

    _, origin, indices, good = best
    min_index = int(np.min(indices[good]))
    max_index = int(np.max(indices[good]))
    sequence = np.full(max_index - min_index + 1, np.nan, dtype=np.float64)
    lattice_points = np.full((len(sequence), 2), np.nan, dtype=np.float64)
    for position, length, point, index, keep in zip(positions, lengths, points, indices, good):
        if not keep:
            continue
        slot = int(index - min_index)
        if np.isnan(sequence[slot]) or length > sequence[slot]:
            sequence[slot] = length
            lattice_points[slot] = point

    valid = np.isfinite(sequence)
    if int(np.count_nonzero(valid)) < 7:
        return None
    median_length = float(np.nanmedian(sequence))
    filled = np.where(valid, sequence, median_length)
    regularity = float(np.count_nonzero(good)) / max(len(positions), 1)
    return filled, lattice_points, regularity


def _infer_tick_pattern(
    positions: np.ndarray,
    lengths: np.ndarray,
    points: np.ndarray,
) -> _TickPattern | None:
    pitch = _estimate_minor_pitch(positions)
    if pitch is None:
        return None
    lattice = _lattice_sequence(positions, lengths, points, pitch)
    if lattice is None:
        return None
    sequence, lattice_points, regularity = lattice

    correlations = {period: _corr(sequence, period) for period in (2, 4, 5, 8, 10, 16)}
    imperial_score = max(correlations[2], correlations[4], correlations[8], correlations[16])
    metric_score = max(correlations[5], correlations[10])

    valid_points = lattice_points[np.isfinite(lattice_points[:, 0])]
    if len(valid_points) < 4:
        return None
    centered = valid_points - np.mean(valid_points, axis=0)
    covariance = np.cov(centered.T)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    axis = eigenvectors[:, int(np.argmax(eigenvalues))]
    scalar = centered @ axis
    if scalar[-1] < scalar[0]:
        scalar = -scalar
    sample_index = np.arange(len(scalar), dtype=np.float64)
    if len(scalar) >= 5:
        quadratic, linear, _ = np.polyfit(sample_index, scalar, 2)
        step_start = abs(linear + quadratic)
        step_end = abs(linear + quadratic * (2.0 * (len(scalar) - 1) + 1.0))
        low_step = min(step_start, step_end)
        high_step = max(step_start, step_end)
        perspective_pct = max(0.0, (high_step / max(low_step, 1e-6) - 1.0) * 100.0)
    else:
        perspective_pct = 0.0

    if imperial_score >= 0.55 and imperial_score >= metric_score + 0.18:
        base_scores = [(correlations[period], period) for period in (2, 4, 8)]
        base_score, quarter_period = max(base_scores)
        if base_score < 0.35:
            return None
        subdivisions_per_inch = 4 * quarter_period
        px_per_inch = pitch * subdivisions_per_inch
        px_per_cm = px_per_inch / 2.54
        confidence = min(0.99, max(0.0, 0.55 * imperial_score + 0.25 * regularity + 0.20 * min(base_score, 1.0)))
        return _TickPattern(
            system="imperial",
            confidence=confidence,
            px_per_cm=float(px_per_cm),
            px_per_inch=float(px_per_inch),
            minor_tick_px=float(pitch),
            reference_interval_cm=float(2.54 / subdivisions_per_inch),
            points_xy=valid_points.astype(np.float32),
            perspective_step_pct=perspective_pct,
            repeat_period=quarter_period,
        )

    if metric_score >= 0.55 and metric_score >= imperial_score + 0.18:
        half_cm_period = 5 if correlations[5] >= 0.45 else 10
        px_per_cm = pitch * (2 * half_cm_period if half_cm_period == 5 else half_cm_period)
        confidence = min(0.99, max(0.0, 0.65 * metric_score + 0.35 * regularity))
        return _TickPattern(
            system="metric",
            confidence=confidence,
            px_per_cm=float(px_per_cm),
            px_per_inch=float(px_per_cm * 2.54),
            minor_tick_px=float(pitch),
            reference_interval_cm=0.1,
            points_xy=valid_points.astype(np.float32),
            perspective_step_pct=perspective_pct,
            repeat_period=half_cm_period,
        )
    return None


def _long_lines(edges: np.ndarray) -> list[_Line]:
    height, width = edges.shape
    minimum = max(90, int(min(height, width) * 0.11))
    raw = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180.0,
        threshold=max(28, int(minimum * 0.30)),
        minLineLength=minimum,
        maxLineGap=max(20, int(minimum * 0.12)),
    )
    lines: list[_Line] = []
    if raw is None:
        return lines
    for x1, y1, x2, y2 in raw[:, 0, :]:
        a = np.array([float(x1), float(y1)])
        b = np.array([float(x2), float(y2)])
        direction = _unit(b - a)
        if direction is None:
            continue
        length = float(np.linalg.norm(b - a))
        lines.append(_Line(a, b, direction, (a + b) * 0.5, length))
    return lines


def _short_lines(edges: np.ndarray) -> list[_Line]:
    raw = cv2.HoughLinesP(edges, 1, np.pi / 180.0, threshold=18, minLineLength=10, maxLineGap=4)
    lines: list[_Line] = []
    if raw is None:
        return lines
    for x1, y1, x2, y2 in raw[:, 0, :]:
        a = np.array([float(x1), float(y1)])
        b = np.array([float(x2), float(y2)])
        direction = _unit(b - a)
        if direction is None:
            continue
        length = float(np.linalg.norm(b - a))
        lines.append(_Line(a, b, direction, (a + b) * 0.5, length))
    return lines


def _interval(line: _Line, origin: np.ndarray, axis: np.ndarray) -> tuple[float, float]:
    values = np.array([np.dot(line.a - origin, axis), np.dot(line.b - origin, axis)])
    return float(np.min(values)), float(np.max(values))


def _patterns_for_pair(
    first: _Line,
    second: _Line,
    short_lines: list[_Line],
) -> tuple[list[_TickPattern], float] | None:
    axis = first.direction.copy()
    if float(np.dot(axis, second.direction)) < 0:
        axis = -axis
    normal = np.array([-axis[1], axis[0]], dtype=np.float64)
    origin = (first.midpoint + second.midpoint) * 0.5
    edge_a = float(np.dot(first.midpoint - origin, normal))
    edge_b = float(np.dot(second.midpoint - origin, normal))
    body_low, body_high = sorted((edge_a, edge_b))
    body_width = body_high - body_low
    if body_width < 18.0:
        return None

    a0, a1 = _interval(first, origin, axis)
    b0, b1 = _interval(second, origin, axis)
    span_low = max(a0, b0)
    span_high = min(a1, b1)
    overlap = span_high - span_low
    if overlap < max(90.0, body_width * 1.2):
        return None

    tolerance = max(4.0, body_width * 0.07)
    side_items: list[list[tuple[float, float, np.ndarray]]] = [[], []]
    for line in short_lines:
        if abs(float(np.dot(line.direction, axis))) > math.sin(math.radians(13.0)):
            continue
        position = float(np.dot(line.midpoint - origin, axis))
        if position < span_low - 8.0 or position > span_high + 8.0:
            continue
        offsets = np.array([
            np.dot(line.a - origin, normal),
            np.dot(line.b - origin, normal),
        ])
        for side_index, edge in enumerate((edge_a, edge_b)):
            distances = np.abs(offsets - edge)
            endpoint_index = int(np.argmin(distances))
            if float(distances[endpoint_index]) > tolerance:
                continue
            other = float(offsets[1 - endpoint_index])
            if body_low - tolerance <= other <= body_high + tolerance:
                anchor = line.a if endpoint_index == 0 else line.b
                side_items[side_index].append((position, line.length, anchor))
                break

    patterns: list[_TickPattern] = []
    for items in side_items:
        positions, lengths, points = _cluster_ticks(items, max(4.0, body_width * 0.07))
        pattern = _infer_tick_pattern(positions, lengths, points)
        if pattern is not None:
            patterns.append(pattern)
    return patterns, overlap


def _scan_tick_extent(
    gray: np.ndarray,
    position: float,
    baseline: float,
    vertical: bool,
    inward_sign: int,
) -> float:
    """Measure a tick from its shared baseline, tolerating antialiasing/gaps."""
    h, w = gray.shape
    max_len = int(round(min(h, w) * 0.16))
    samples: list[float] = []
    for offset in range(-2, 3):
        values: list[float] = []
        for step in range(0, max_len + 1):
            if vertical:
                x = int(round(position + offset))
                y = int(round(baseline + inward_sign * step))
            else:
                x = int(round(baseline + inward_sign * step))
                y = int(round(position + offset))
            if not (0 <= x < w and 0 <= y < h):
                break
            values.append(float(gray[y, x]))
        if not values:
            continue
        dark = np.flatnonzero(np.asarray(values) < 185.0)
        if len(dark) == 0 or int(dark[0]) > 12:
            continue
        end = int(dark[0])
        for value in dark[1:]:
            if int(value) - end > 5:
                break
            end = int(value)
        samples.append(float(end))
    return max(samples) if samples else 0.0


def _standalone_tick_pattern(
    gray: np.ndarray,
    short_lines: list[_Line],
) -> _TickPattern | None:
    """Infer scale from a free-standing tick ladder without a ruler body.

    This models the physical information directly: a regular minor-tick lattice
    plus a repeated major-tick hierarchy.  10 minor intervals per major interval
    identifies metric centimetres; 4/8/16/32 identifies common inch rulers.
    """
    h, w = gray.shape
    candidates: list[_TickPattern] = []
    for vertical in (True, False):
        family = []
        for line in short_lines:
            dx, dy = abs(float(line.direction[0])), abs(float(line.direction[1]))
            aligned = dy >= 0.96 if vertical else dx >= 0.96
            if not aligned or line.length > min(h, w) * 0.18:
                continue
            family.append(line)
        if len(family) < 8:
            continue

        for baseline_side in (1, -1):
            anchors = []
            for line in family:
                pts = (line.a, line.b)
                coord = (lambda p: p[1]) if vertical else (lambda p: p[0])
                anchor = max(pts, key=coord) if baseline_side == 1 else min(pts, key=coord)
                baseline = float(coord(anchor))
                position = float(line.midpoint[0] if vertical else line.midpoint[1])
                anchors.append((baseline, position, line.length, anchor))

            ordered = sorted(anchors, key=lambda x: x[0])
            groups: list[list[tuple[float, float, float, np.ndarray]]] = []
            tolerance = max(7.0, min(h, w) * 0.009)
            for item in ordered:
                if not groups or item[0] - groups[-1][-1][0] > tolerance:
                    groups.append([item])
                else:
                    groups[-1].append(item)

            for group in groups:
                if len(group) < 8:
                    continue
                baseline = float(np.median([x[0] for x in group]))
                raw_items = [
                    (x[1], x[2], np.asarray(x[3], dtype=np.float64))
                    for x in group
                    if abs(x[0] - baseline) <= tolerance
                ]
                positions, _, points = _cluster_ticks(raw_items, max(5.0, min(h, w) * 0.008))
                pitch = _estimate_minor_pitch(positions)
                if pitch is None or len(positions) < 8:
                    continue

                inward_sign = -baseline_side
                lengths = np.asarray([
                    _scan_tick_extent(gray, p, baseline, vertical, inward_sign)
                    for p in positions
                ], dtype=np.float64)
                usable = lengths[lengths > 0]
                if len(usable) < 8:
                    continue
                median_len = float(np.median(usable))
                max_len = float(np.max(usable))
                if max_len < median_len * 1.22:
                    continue
                major = positions[lengths >= median_len + 0.55 * (max_len - median_len)]
                if len(major) < 2:
                    continue
                ratios = np.diff(np.sort(major)) / pitch
                ratio = float(np.median(ratios))
                regularity = min(1.0, len(positions) / 16.0)

                system = None
                subdivisions = None
                for target in (4, 8, 16, 32):
                    if abs(ratio - target) <= max(0.7, target * 0.08):
                        system = "imperial"
                        subdivisions = target
                        break
                if system is None and abs(ratio - 10.0) <= 0.8:
                    system = "metric"

                if system == "imperial" and subdivisions is not None:
                    px_per_inch = float(pitch * subdivisions)
                    candidates.append(_TickPattern(
                        system="imperial",
                        confidence=min(0.96, 0.72 + 0.20 * regularity),
                        px_per_cm=px_per_inch / 2.54,
                        px_per_inch=px_per_inch,
                        minor_tick_px=float(pitch),
                        reference_interval_cm=float(2.54 / subdivisions),
                        points_xy=points.astype(np.float32),
                        perspective_step_pct=0.0,
                        repeat_period=int(subdivisions),
                    ))
                elif system == "metric":
                    px_per_cm = float(pitch * 10.0)
                    candidates.append(_TickPattern(
                        system="metric",
                        confidence=min(0.96, 0.72 + 0.20 * regularity),
                        px_per_cm=px_per_cm,
                        px_per_inch=px_per_cm * 2.54,
                        minor_tick_px=float(pitch),
                        reference_interval_cm=0.1,
                        points_xy=points.astype(np.float32),
                        perspective_step_pct=0.0,
                        repeat_period=10,
                    ))
    return max(candidates, key=lambda p: p.confidence) if candidates else None


def infer_visual_scale(image_rgb: np.ndarray) -> VisualScaleObservation:
    if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
        return VisualScaleObservation("unknown", 0.0, None, None, None, None, np.empty((0, 2), dtype=np.float32), None, None, ("invalid_image_shape",))

    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 45, 135)
    long_lines = _long_lines(edges)
    short_lines = _short_lines(edges)
    if not short_lines:
        return VisualScaleObservation("unknown", 0.0, None, None, None, None, np.empty((0, 2), dtype=np.float32), None, None, ("ruler_tick_pattern_not_found",))

    height, width = gray.shape
    max_body_width = min(height, width) * 0.28
    candidates: list[tuple[float, list[_TickPattern], _Line, _Line]] = []
    for index, first in enumerate(long_lines):
        for second in long_lines[index + 1 :]:
            parallel = abs(float(np.dot(first.direction, second.direction)))
            if parallel < math.cos(math.radians(6.0)):
                continue
            axis = first.direction
            normal = np.array([-axis[1], axis[0]], dtype=np.float64)
            separation = abs(float(np.dot(second.midpoint - first.midpoint, normal)))
            if separation < 18.0 or separation > max_body_width:
                continue
            inferred = _patterns_for_pair(first, second, short_lines)
            if inferred is None:
                continue
            patterns, overlap = inferred
            if not patterns:
                continue
            confidence = max(pattern.confidence for pattern in patterns)
            support = max(len(pattern.points_xy) for pattern in patterns)
            score = confidence * (1.0 + min(overlap / 300.0, 1.0)) * (1.0 + min(support / 20.0, 1.0))
            candidates.append((score, patterns, first, second))

    if not candidates:
        standalone = _standalone_tick_pattern(gray, short_lines)
        if standalone is None:
            return VisualScaleObservation("unknown", 0.0, None, None, None, None, np.empty((0, 2), dtype=np.float32), None, None, ("ruler_tick_pattern_not_found",))
        return VisualScaleObservation(
            system=standalone.system,
            confidence=float(standalone.confidence),
            px_per_cm=float(standalone.px_per_cm),
            px_per_inch=None if standalone.px_per_inch is None else float(standalone.px_per_inch),
            minor_tick_px=float(standalone.minor_tick_px),
            reference_interval_cm=float(standalone.reference_interval_cm),
            reference_points_px=standalone.points_xy.astype(np.float32),
            direction_xy=(1.0, 0.0) if np.ptp(standalone.points_xy[:, 0]) >= np.ptp(standalone.points_xy[:, 1]) else (0.0, 1.0),
            perspective_step_pct=float(standalone.perspective_step_pct),
            reason_codes=(),
        )

    _, patterns, first, second = max(candidates, key=lambda item: item[0])
    systems = {pattern.system for pattern in patterns}
    if {"metric", "imperial"}.issubset(systems):
        system: ScaleSystem = "dual"
        metric = max((p for p in patterns if p.system == "metric"), key=lambda p: p.confidence)
        imperial = max((p for p in patterns if p.system == "imperial"), key=lambda p: p.confidence)
        relative_delta = abs(metric.px_per_cm - imperial.px_per_cm) / max(metric.px_per_cm, imperial.px_per_cm)
        if relative_delta > 0.08:
            return VisualScaleObservation("unknown", min(metric.confidence, imperial.confidence), None, None, None, None, np.empty((0, 2), dtype=np.float32), None, max(metric.perspective_step_pct, imperial.perspective_step_pct), ("dual_scale_disagreement",))
        chosen = metric
        px_per_cm = float((metric.px_per_cm + imperial.px_per_cm) * 0.5)
        px_per_inch = px_per_cm * 2.54
        confidence = min(metric.confidence, imperial.confidence)
    else:
        chosen = max(patterns, key=lambda pattern: pattern.confidence)
        system = chosen.system
        px_per_cm = chosen.px_per_cm
        px_per_inch = chosen.px_per_inch
        confidence = chosen.confidence

    axis = first.direction.copy()
    if axis[0] < 0:
        axis = -axis
    return VisualScaleObservation(
        system=system,
        confidence=float(confidence),
        px_per_cm=float(px_per_cm),
        px_per_inch=None if px_per_inch is None else float(px_per_inch),
        minor_tick_px=float(chosen.minor_tick_px),
        reference_interval_cm=float(chosen.reference_interval_cm),
        reference_points_px=chosen.points_xy.astype(np.float32),
        direction_xy=(float(axis[0]), float(axis[1])),
        perspective_step_pct=float(chosen.perspective_step_pct),
        reason_codes=(),
    )
