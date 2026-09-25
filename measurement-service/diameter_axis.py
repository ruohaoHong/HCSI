"""Estimate an independent screw axis from bilateral *smooth* raw-image edges.

This is geometric evidence, not a fastener-catalog prior: one reliable thread
flank alone cannot identify both a radius and an axis.  This module searches
for a contiguous cylindrical section supported by two physical edge tracks,
checks that the sides are locally straight and parallel, and then models its
centerline.  A partially threaded screw may have such a section; a fully
threaded screw may not.  In the latter case no one-sided D is invented.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class IndependentAxis:
    s_origin_px: float
    normal_at_origin_px: float
    normal_slope: float
    span_start_px: float
    span_end_px: float
    reference_samples: int
    residual_px: float
    uncertainty_at_origin_px: float
    slope_uncertainty: float

    def normal_coordinate(self, s_px: np.ndarray | float) -> np.ndarray:
        s = np.asarray(s_px, dtype=np.float64)
        return self.normal_at_origin_px + self.normal_slope * (s - self.s_origin_px)

    def uncertainty(self, s_px: float) -> float:
        distance = abs(float(s_px) - self.s_origin_px)
        return float(np.hypot(
            self.uncertainty_at_origin_px,
            self.slope_uncertainty * distance,
        ))


def _estimate_paired_axis(upper, lower) -> IndependentAxis | None:
    """Find an observable straight, bilateral non-crest cylindrical segment.

    upper and lower are independent raw-image EdgeTracks. Their outward values
    use opposite signed normal coordinates.  The center coordinate is
    (upper.outward - lower.outward)/2; outer width is their sum.

    Every accepted window must have good optical fits on *both* sides and be
    locally straight, mutually parallel, and nearly constant-width. A
    contiguous, sufficiently long segment must survive. The axis never comes
    from a diameter specification or the selected one-sided thread crests.
    """
    s = upper.s_px
    if len(s) < 48 or len(lower.s_px) != len(s):
        return None

    paired = (
        upper.valid & lower.valid
        & np.isfinite(upper.outward_px) & np.isfinite(lower.outward_px)
        & (upper.contrast >= 28.0) & (lower.contrast >= 28.0)
        & (upper.relative_residual <= 0.18)
        & (lower.relative_residual <= 0.18)
        & (upper.blur_10_90_px <= 9.0)
        & (lower.blur_10_90_px <= 9.0)
        & (upper.uncertainty_px <= 1.0)
        & (lower.uncertainty_px <= 1.0)
    )
    if np.count_nonzero(paired) < 36:
        return None

    plus = upper.outward_px
    minus = lower.outward_px
    nominal_width = float(np.median(plus[paired] + minus[paired]))
    if nominal_width < 7.0:
        return None

    # A width-invariant segment shorter than its own diameter is weak evidence
    # for a physical axis, particularly on a series of similarly sized teeth.
    min_run = max(36, int(round(nominal_width * 0.85)))
    half_window = 13
    smooth = np.zeros(len(s), dtype=bool)
    for i in range(half_window, len(s) - half_window):
        indices = np.arange(i - half_window, i + half_window + 1)
        keep = indices[paired[indices]]
        if len(keep) < len(indices) * 0.92 or not paired[i]:
            continue

        x = s[keep] - s[i]
        up_slope, up_center = np.polyfit(x, plus[keep], 1)
        lo_slope, lo_center = np.polyfit(x, minus[keep], 1)
        up_residual = plus[keep] - (up_slope * x + up_center)
        lo_residual = minus[keep] - (lo_slope * x + lo_center)
        up_rms = float(np.sqrt(np.mean(up_residual ** 2)))
        lo_rms = float(np.sqrt(np.mean(lo_residual ** 2)))
        # With opposite outward coordinates, a real straight shaft has
        # opposing side slopes. Their sum is the width slope.
        width_slope = abs(float(up_slope + lo_slope))
        if up_rms > 0.75 or lo_rms > 0.75 or width_slope > 0.023:
            continue
        smooth[i] = True

    # Split at gaps; do not aggregate scattered small flat portions of a
    # thread into an imaginary long smooth shaft.
    indices = np.flatnonzero(smooth)
    if not len(indices):
        return None
    splits = np.flatnonzero(np.diff(indices) != 1) + 1
    runs = np.split(indices, splits)
    runs = [
        run for run in runs
        if len(run) >= min_run
        and float(s[run[-1]] - s[run[0]]) >= min_run - 1
    ]
    if not runs:
        return None

    # Choose the longest geometrically supported segment, not the candidate
    # that makes a later diameter closest to a known standard size.
    run = max(runs, key=lambda r: len(r))
    start = max(0, int(run[0]) - half_window // 2)
    end = min(len(s), int(run[-1]) + half_window // 2 + 1)
    idx = np.arange(start, end)
    idx = idx[paired[idx]]
    if len(idx) < min_run:
        return None
    origin = float(np.median(s[idx]))
    centered_s = s[idx] - origin
    width = plus[idx] + minus[idx]

    # Re-check the complete segment: locally straight pieces do not imply a
    # globally straight cylindrical reference (e.g., a curved taper).
    m_up, b_up = np.polyfit(centered_s, plus[idx], 1)
    m_lo, b_lo = np.polyfit(centered_s, minus[idx], 1)
    up_error = plus[idx] - (m_up * centered_s + b_up)
    lo_error = minus[idx] - (m_lo * centered_s + b_lo)
    if (
        float(np.sqrt(np.mean(up_error ** 2))) > 0.85
        or float(np.sqrt(np.mean(lo_error ** 2))) > 0.85
        or abs(float(m_up + m_lo)) > 0.018
        or float(np.percentile(width, 90) - np.percentile(width, 10)) > 2.0
    ):
        return None

    center = 0.5 * (plus[idx] - minus[idx])
    # Robust line fit prevents isolated polished-metal reflections from
    # controlling the extrapolated centerline.
    slope, intercept = np.polyfit(centered_s, center, 1)
    residual = center - (slope * centered_s + intercept)
    mad = 1.4826 * float(np.median(np.abs(residual - np.median(residual))))
    inlier = np.abs(residual) <= max(0.8, 3.0 * mad)
    if np.count_nonzero(inlier) < min_run:
        return None
    slope, intercept = np.polyfit(centered_s[inlier], center[inlier], 1)
    residual = center[inlier] - (slope * centered_s[inlier] + intercept)
    rms = float(np.sqrt(np.mean(residual ** 2)))
    if rms > 0.7:
        return None

    # These are conservative *image-space proxies*, not calibrated confidence
    # intervals. Extrapolation increases uncertainty with axial distance.
    fit_quality = float(np.median(np.hypot(
        upper.uncertainty_px[idx[inlier]],
        lower.uncertainty_px[idx[inlier]],
    ))) * 0.5
    sigma_origin = max(0.35, fit_quality, rms)
    half_span = 0.5 * (float(s[idx[-1]]) - float(s[idx[0]]))
    slope_sigma = max(0.0005, 2.0 * rms / max(half_span, 1.0))
    return IndependentAxis(
        s_origin_px=origin,
        normal_at_origin_px=float(intercept),
        normal_slope=float(slope),
        span_start_px=float(s[idx[0]]),
        span_end_px=float(s[idx[-1]]),
        reference_samples=int(len(idx)),
        residual_px=rms,
        uncertainty_at_origin_px=sigma_origin,
        slope_uncertainty=slope_sigma,
    )


def _fit_side_line(
    s: np.ndarray, edge: np.ndarray,
) -> tuple[float, float, float, np.ndarray] | None:
    """Robust line for a raw physical edge; never infer the other side here."""
    if len(s) < 16 or float(np.ptp(s)) < 35.0:
        return None
    origin = float(np.median(s))
    x = s - origin
    slope, at_origin = np.polyfit(x, edge, 1)
    for _ in range(3):
        err = edge - (slope * x + at_origin)
        mad = 1.4826 * float(np.median(np.abs(err - np.median(err))))
        keep = np.abs(err) <= max(0.8, 2.8 * mad)
        if np.count_nonzero(keep) < max(16, 0.70 * len(s)):
            return None
        slope, at_origin = np.polyfit(x[keep], edge[keep], 1)
    err = edge - (slope * x + at_origin)
    keep = np.abs(err) <= max(0.8, 2.8 * np.median(np.abs(err)))
    if np.count_nonzero(keep) < max(16, 0.70 * len(s)):
        return None
    rms = float(np.sqrt(np.mean(err[keep] ** 2)))
    if rms > 0.75 or float(np.ptp(s[keep])) < 0.65 * float(np.ptp(s)):
        return None
    # Convert intercept to s=0. The caller will re-anchor its centerline.
    return float(slope), float(at_origin - slope * origin), rms, keep


def _estimate_disjoint_side_axis(upper, lower) -> IndependentAxis | None:
    """Two clear *straight sides* need not occur at identical axial pixels.

    Reflections or texture may intermittently hide alternating sides of a
    smooth cylinder. In a shared axial interval, fit each raw-image surface
    independently, validate long-span parallelism and low residual, then take
    the mean geometric centerline. Do not require paired observations at every
    x, and do not substitute a contour-only axis.
    """
    s = upper.s_px
    if len(s) < 64 or len(lower.s_px) != len(s):
        return None
    def good(t):
        return (
            t.valid & np.isfinite(t.outward_px)
            & (t.contrast >= 28.0)
            & (t.relative_residual <= 0.20)
            & (t.blur_10_90_px <= 10.0)
            & (t.uncertainty_px <= 1.0)
        )
    valid_up = good(upper)
    valid_lo = good(lower)
    if np.count_nonzero(valid_up) < 20 or np.count_nonzero(valid_lo) < 20:
        return None

    best = None
    for span in (64, 96, 128, 160, 192):
        if span > len(s):
            continue
        for left in range(0, len(s) - span + 1, max(8, span // 7)):
            right = left + span
            u = np.flatnonzero(valid_up[left:right]) + left
            l = np.flatnonzero(valid_lo[left:right]) + left
            min_samples = max(16, int(round(0.30 * span)))
            if len(u) < min_samples or len(l) < min_samples:
                continue
            if float(np.ptp(s[u])) < 0.65 * span or float(np.ptp(s[l])) < 0.65 * span:
                continue
            u_fit = _fit_side_line(s[u], upper.outward_px[u])
            l_fit = _fit_side_line(s[l], lower.outward_px[l])
            if u_fit is None or l_fit is None:
                continue
            um, ub, urms, u_keep = u_fit
            lm, lb, lrms, l_keep = l_fit
            if abs(um + lm) > 0.018:
                continue
            # The observable spans must overlap: parallel fragments on
            # completely different physical sections cannot certify a shaft.
            us = s[u[u_keep]]
            ls = s[l[l_keep]]
            overlap_start = max(float(us.min()), float(ls.min()))
            overlap_end = min(float(us.max()), float(ls.max()))
            if overlap_end - overlap_start < max(35.0, span * 0.55):
                continue
            # Reject a pair that only looks straight locally but carries an
            # unstable diameter in their actual simultaneously seen pixels.
            both = valid_up[left:right] & valid_lo[left:right]
            if np.count_nonzero(both) >= 8:
                k = np.flatnonzero(both) + left
                model_width = (um + lm) * s[k] + ub + lb
                discrepancies = upper.outward_px[k] + lower.outward_px[k] - model_width
                if float(np.percentile(np.abs(discrepancies), 80)) > 1.5:
                    continue
            support = int(np.count_nonzero(u_keep) + np.count_nonzero(l_keep))
            # Prefer long, well-supported bilateral sections, not a favorable
            # nominal D or a benchmark-specific position in the photo.
            score = (overlap_end - overlap_start) * min(len(u),len(l)) / (
                1.0 + urms + lrms
            )
            if best is None or score > best[0]:
                best = (
                    score, overlap_start, overlap_end, um, ub, urms,
                    lm, lb, lrms, support,
                )
    if best is None:
        return None
    _, start, end, um, ub, urms, lm, lb, lrms, support = best
    center_s = (start + end) * 0.5
    center_slope = 0.5 * (um - lm)
    center_zero = 0.5 * (ub - lb)
    # Unlike simultaneous pairs, the two sides are fitted separately, so
    # account for the weaker side's regression residual and extrapolation.
    rms = float(np.hypot(urms, lrms) * 0.5)
    uncertainty = max(0.7, 0.5 * (urms + lrms), rms)
    slope_uncertainty = max(
        0.001, 2.0 * max(urms, lrms, 0.25) / max((end - start) * 0.5, 1.0)
    )
    return IndependentAxis(
        s_origin_px=float(center_s),
        normal_at_origin_px=float(center_zero + center_slope * center_s),
        normal_slope=float(center_slope),
        span_start_px=float(start),
        span_end_px=float(end),
        reference_samples=support,
        residual_px=rms,
        uncertainty_at_origin_px=uncertainty,
        slope_uncertainty=slope_uncertainty,
    )


def estimate_independent_axis(upper, lower) -> IndependentAxis | None:
    """Select a geometric two-side axis without using thread crest identity."""
    paired = _estimate_paired_axis(upper, lower)
    if paired is not None:
        return paired
    return _estimate_disjoint_side_axis(upper, lower)
