"""Research-only local width-regime diagnostic. Not wired to production.

Uses the selected production contour as input, provides an independent head/
shaft region hypothesis. GT never enters the estimator; cannot override D/P/L.
"""
from __future__ import annotations
from dataclasses import dataclass
import math
import cv2
import numpy as np
from thread_geometry import ThreadedShankProfile, _filled_contour_points, _median_smooth

@dataclass(frozen=True)
class _LocalRegimeHypothesis:
    axis: np.ndarray
    tip_at_min: bool
    transition_s: float
    score: float
    shaft_width_px: float


def _width_profile_on_axis(
    boundary_xy: np.ndarray,
    center: np.ndarray,
    axis: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, float] | None:
    """Sample the silhouette along a candidate axis using boundary pixels.

    Candidate axes are independent of the whole-object PCA; the latter is
    merely one hypothesis. Physical widths are evaluated in that local frame.
    """
    normal = np.array([-axis[1], axis[0]])
    coords = boundary_xy - center
    along = coords @ axis
    across = coords @ normal
    minimum = float(np.min(along))
    n = int(math.ceil(float(np.max(along)) - minimum)) + 1
    if n < 45:
        return None
    bins = np.clip(np.floor(along - minimum).astype(np.int32), 0, n - 1)
    low = np.full(n, np.inf)
    high = np.full(n, -np.inf)
    np.minimum.at(low, bins, across)
    np.maximum.at(high, bins, across)
    valid = np.isfinite(low) & np.isfinite(high)
    if np.count_nonzero(valid) < n * 0.85:
        return None
    samples = np.arange(n, dtype=np.float64)
    low = np.interp(samples, samples[valid], low[valid])
    high = np.interp(samples, samples[valid], high[valid])
    return low, high, high - low, minimum


def _local_regime_hypotheses(
    boundary_xy: np.ndarray,
    center: np.ndarray,
    axis: np.ndarray,
) -> list[_LocalRegimeHypothesis]:
    projected = _width_profile_on_axis(boundary_xy, center, axis)
    if projected is None:
        return []
    low, high, widths, origin = projected
    n = len(widths)
    smooth = _median_smooth(widths, fraction=0.025)
    midpoints = _median_smooth((low + high) / 2.0, fraction=0.025)
    out: list[_LocalRegimeHypothesis] = []
    for tip_at_min in (True, False):
        w = smooth if tip_at_min else smooth[::-1]
        centers = midpoints if tip_at_min else midpoints[::-1]
        # Search for a local width regime, not the largest global width jump.
        # A region may be only ~one shaft diameter long, unlike the former
        # long/narrow overall silhouette assumption.
        start_k = max(34, int(n * 0.24))
        stop_k = min(n - 20, int(n * 0.83))
        for k in range(start_k, stop_k, max(2, n // 90)):
            start = max(4, int(k * 0.10))
            stop = max(start + 1, int(k * 0.87))
            shaft = w[start:stop]
            if len(shaft) < 23:
                continue
            d = float(np.median(shaft))
            if d < 5.0 or k < d * 0.85:
                continue
            spread = float(np.percentile(shaft, 90) - np.percentile(shaft, 10)) / d
            if spread > 0.25:
                continue
            drift = float(np.percentile(centers[start:stop], 90) -
                          np.percentile(centers[start:stop], 10)) / d
            if drift > 0.18:
                continue
            head_end = min(n - 2, k + max(15, int(0.8 * (n - k))))
            head = w[k + 3:head_end]
            if len(head) < 9:
                continue
            h = float(np.percentile(head, 75))
            if h < d * 1.28 or h - d < 6.0:
                continue
            persistence = w[k + 3:min(n - 2, k + max(12, int(0.3 * (n-k))))]
            if len(persistence) < 6 or np.median(persistence) < d * 1.15:
                continue
            # The segmentation datum is the FIRST sustained departure from
            # this shaft's own width envelope, not whichever later split
            # happens to maximize the head/shaft ratio.
            persistence_n=max(6,min(18,int(round(0.08*d))))
            onset=None
            for p in range(max(12,int(0.2*k)),min(n-persistence_n,k+max(16,int(0.18*n)))):
                trial=w[p:p+persistence_n]
                if (np.median(trial)>=d*1.15
                        and np.mean(trial>=d*1.10)>=0.75):
                    onset=p
                    while onset>0 and w[onset-1]>d*1.06:
                        onset-=1
                    break
            if onset is None:
                continue
            # A candidate that crosses the first onset too late is not a new
            # physical head/body event; it belongs to the same transition.
            k=int(onset)
            shaft_center = float(np.median(centers[start:stop]))
            head_center = float(np.median(centers[k + 3:head_end]))
            if abs(head_center - shaft_center) > d * 0.43:
                continue
            # Penalize axis tilt, head-to-shaft offset and poor width plateau.
            # Do not reward a single bright edge or a single outlier width.
            score = (
                min(2.0, h / d - 1.0)
                * (1.0 - spread / 0.30)
                * (1.0 - drift / 0.22)
                * (1.0 - abs(head_center-shaft_center)/(0.50*d))
                * min(1.0, k/(1.25*d))
                * min(1.0, (n-k)/max(15.0, 0.30*d))
            )
            if score <= 0.04:
                continue
            transition = origin + (k if tip_at_min else n - 1 - k)
            out.append(_LocalRegimeHypothesis(axis, tip_at_min, float(transition), float(score), d))
    return out


def detect_local_shank_regime(contour: np.ndarray) -> ThreadedShankProfile | None:
    """Infer head/shaft from persistent local width change, without global PCA.

    The full contour is projected only after a boundary-level axis hypothesis
    has passed stable shaft width, centerline continuity and wider head tests.
    First expansion defines a region boundary, NEVER the bearing-plane datum.
    Ambiguous/no-regime shapes return None rather than inventing a shank.
    """
    x, y, w, h = cv2.boundingRect(contour)
    if w < 15 or h < 6:
        return None
    outline = np.zeros((h+4, w+4), dtype=np.uint8)
    shifted = contour.astype(np.int32).copy()
    shifted[:,0,0] -= x-2
    shifted[:,0,1] -= y-2
    cv2.drawContours(outline, [shifted], -1, 255, 1)
    yy, xx = np.nonzero(outline)
    if len(xx) < 24:
        return None
    boundary = np.column_stack((xx + x-2, yy + y-2)).astype(np.float64)
    center = np.mean(boundary, axis=0)

    # Orientation is a hypothesis; even when a broad head rotates global PCA,
    # a local width plateau is allowed to select the shaft's own frame.
    theta = np.deg2rad(np.arange(0, 180, 8, dtype=np.float64))
    candidates: list[_LocalRegimeHypothesis] = []
    for angle in theta:
        axis = np.array([math.cos(angle), math.sin(angle)])
        candidates.extend(_local_regime_hypotheses(boundary, center, axis))
    if not candidates:
        return None
    best = max(candidates, key=lambda item:item.score)

    # Reconstruct full-resolution silhouette ONLY in the chosen local frame.
    points = _filled_contour_points(contour)
    projected = _width_profile_on_axis(points, center, best.axis)
    if projected is None:
        return None
    low, high, widths, origin = projected
    s_values = origin + np.arange(len(widths), dtype=np.float64)
    direction = 1 if best.tip_at_min else -1
    tip_s = float(s_values[0] if direction > 0 else s_values[-1])
    transition_s = best.transition_s
    shaft_span = abs(transition_s-tip_s)
    trim_tip = min(0.08 * shaft_span, 0.12 * best.shaft_width_px)
    trim_head = min(0.12 * shaft_span, 0.12 * best.shaft_width_px)
    region_start = tip_s + direction*trim_tip
    region_end = transition_s - direction*trim_head
    sample_mask=(s_values >= min(region_start,region_end)) & (
        s_values <= max(region_start,region_end))
    if np.count_nonzero(sample_mask) < 20:
        return None
    normal=np.array([-best.axis[1],best.axis[0]])
    a=center+best.axis*region_start
    b=center+best.axis*region_end
    return ThreadedShankProfile(
        center, best.axis, normal, s_values, low, high, widths, sample_mask,
        transition_s, tip_s, (float(a[0]),float(a[1])),
        (float(b[0]),float(b[1])),
    )


