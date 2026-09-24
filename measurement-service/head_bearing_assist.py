"""Optional bearing-face evidence on top of the accepted 124da shank frame.

This module NEVER chooses a contour, changes the shank axis, adjusts the
ruler, alters D/P, or substitutes nominal catalog length for image evidence.

The existing underface primitive finds the first persistent shaft expansion.
A separate planar-face hypothesis must be independently visible on both
silhouette sides before a bearing-plane estimate can be considered.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
import numpy as np

from thread_geometry import (
    ThreadedShankProfile,
    _median_smooth,
    _side_crest_envelope,
    estimate_head_underface,
    measure_outer_width_px,
)


@dataclass(frozen=True)
class BearingFaceEvidence:
    first_expansion_s: float | None
    bearing_plane_s: float | None
    shaft_outer_px: float | None
    radial_support_px: float | None
    fit_residual_px: float | None
    side_disagreement_px: float | None
    expansion_to_bearing_px: float | None
    reason_code: str


def _radial_frontier(
    profile: ThreadedShankProfile,
    outward_radius: np.ndarray,
    direction: int,
    shaft_outer: float,
) -> tuple[np.ndarray, np.ndarray]:
    """First head-facing intersection of each radius beyond the shaft crests."""
    sampled = np.flatnonzero(profile.sample_mask)
    if len(sampled) < 12:
        return np.empty(0), np.empty(0)
    start = int(sampled[-1] if direction == 1 else sampled[0])
    stop = len(outward_radius) - 1 if direction == 1 else 0
    idx = np.arange(start, stop + direction, direction)
    if len(idx) < 8:
        return np.empty(0), np.empty(0)

    # The original shank is kept unchanged; smoothing here only suppresses
    # the periodic 1–3 px surface teeth when detecting an *independent* face.
    radial = _median_smooth(outward_radius[idx], fraction=0.016)
    axial = direction * profile.s_values[idx]
    root = 0.5 * shaft_outer + max(2.0, 0.03 * shaft_outer)
    upper = float(np.max(radial)) - 1.0
    if upper - root < 6:
        return np.empty(0), np.empty(0)

    radii = np.arange(root, upper, 1.0)
    positions: list[float] = []
    retained: list[float] = []
    for r in radii:
        hits = np.flatnonzero(radial >= r)
        if len(hits) == 0 or hits[0] == 0:
            continue
        j = int(hits[0])
        dr = float(radial[j] - radial[j - 1])
        if dr <= 0:
            continue
        alpha = min(1.0, max(0.0, (r - radial[j - 1]) / dr))
        pos = float(axial[j - 1] + alpha * (axial[j] - axial[j - 1]))
        retained.append(float(r))
        positions.append(pos)
    return np.asarray(retained, dtype=np.float64), np.asarray(positions, dtype=np.float64)


def _planar_segments(
    radii: np.ndarray, axial: np.ndarray, shaft_outer: float
) -> list[tuple[float, float, float, float]]:
    """Radial intervals that directly reveal a near-perpendicular silhouette."""
    if len(radii) < 4:
        return []
    max_error = max(1.0, 0.015 * shaft_outer)
    result: list[tuple[float, float, float, float]] = []
    for first in range(len(radii) - 3):
        last = first + 4
        x = radii[first:last]
        y = axial[first:last]
        if np.max(np.diff(x)) > 1.1:
            continue
        fit = np.polyfit(x, y, 1)
        if abs(float(fit[0])) > 0.15:
            continue
        if float(np.max(np.abs(y - np.polyval(fit, x)))) > max_error:
            continue
        while last < len(radii) and radii[last] - radii[last - 1] < 1.1:
            x = radii[first : last + 1]
            y = axial[first : last + 1]
            fit = np.polyfit(x, y, 1)
            if abs(float(fit[0])) > 0.15:
                break
            if float(np.max(np.abs(y - np.polyval(fit, x)))) > max_error:
                break
            last += 1
        x = radii[first:last]
        y = axial[first:last]
        fit = np.polyfit(x, y, 1)
        residual = float(np.max(np.abs(y - np.polyval(fit, x))))
        result.append((float(np.median(y)), float(x[0]), float(x[-1]), residual))
    return result


def inspect_bearing_face(profile: ThreadedShankProfile) -> BearingFaceEvidence:
    """Return independently observed plane evidence, without changing base L.

    The shaft's stable local D anchors a radial regime. A curved transition
    may signal the head, but only coincident planar stretches on BOTH outward
    silhouette sides can confirm an under-head datum. No such stretch means
    unresolved, NOT a manufactured +px offset to the baseline measurement.
    """
    expansion = estimate_head_underface(profile)
    shaft_outer = measure_outer_width_px(profile)
    onset = None if expansion is None else expansion.s
    if expansion is None or shaft_outer is None:
        return BearingFaceEvidence(onset, None, shaft_outer, None, None, None, None,
                                   "local_shaft_or_transition_unresolved")

    direction = 1 if profile.transition_s > profile.tip_s else -1
    high = _side_crest_envelope(profile.high[profile.sample_mask], 1.0)
    low = _side_crest_envelope(profile.low[profile.sample_mask], -1.0)
    if high is None or low is None:
        return BearingFaceEvidence(onset, None, shaft_outer, None, None, None, None,
                                   "shaft_envelope_unresolved")
    shaft_middle = (high - low) * 0.5
    traces = (profile.high - shaft_middle, shaft_middle - profile.low)
    sides: list[list[tuple[float, float, float, float]]] = []
    for radius in traces:
        r, a = _radial_frontier(profile, radius, direction, shaft_outer)
        sides.append(_planar_segments(r, a, shaft_outer))

    tolerance = max(2.0, 0.04 * shaft_outer)
    min_span = max(6.0, 0.20 * shaft_outer)
    onset_out = direction * onset
    head_end_out = direction * float(
        profile.s_values[-1] if direction == 1 else profile.s_values[0]
    )
    planes: list[tuple[float, float, float, float, float]] = []
    for a in sides[0]:
        for b in sides[1]:
            overlap = min(a[2], b[2]) - max(a[1], b[1])
            delta = abs(a[0] - b[0])
            s = 0.5 * (a[0] + b[0])
            if overlap < min_span or delta > tolerance:
                continue
            # Only the first physical head region is relevant; a step or
            # chamfer deeper inside the crown cannot replace the bearing face.
            if s < onset_out - tolerance or s >= head_end_out - 3:
                continue
            planes.append((max(a[1], b[1]), s, overlap,
                           max(a[3], b[3]), delta))

    if not planes:
        return BearingFaceEvidence(onset, None, shaft_outer, None, None, None, None,
                                   "bearing_plane_unresolved")
    # If a narrow early ledge is followed by a large head feature, do not
    # silently replace it with the later plane.
    first_radius = min(item[0] for item in planes)
    near_first = [item for item in planes
                  if item[0] <= first_radius + max(2.0, 0.04 * shaft_outer)]
    plane = max(near_first, key=lambda x: x[2])
    s = plane[1]
    return BearingFaceEvidence(
        first_expansion_s=float(onset),
        bearing_plane_s=float(direction * s),
        shaft_outer_px=float(shaft_outer),
        radial_support_px=float(plane[2]),
        fit_residual_px=float(plane[3]),
        side_disagreement_px=float(plane[4]),
        expansion_to_bearing_px=float(s - onset_out),
        reason_code="bearing_plane_observed",
    )
