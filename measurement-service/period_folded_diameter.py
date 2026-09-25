"""Period-folded major-diameter PoC for repetitive screw threads.

This module does not use nominal fastener size.  It uses an image-measured pitch
and repeated raw-image EdgeTrack observations.  The key idea is that symmetric
blur rounds individual crests but leaves the approximately linear thread flanks
usable; repeated cycles are folded together and the latent crest is recovered by
intersecting robust flank fits.  If one flank is optically unresolved, the clear
side's radial relief may be shared across sides because a rotational thread has
one radial profile, while each side keeps its independently observed baseline.
"""
from __future__ import annotations

from dataclasses import dataclass
import numpy as np


@dataclass(frozen=True)
class FoldedSideEstimate:
    baseline_px: float | None
    crest_px: float | None
    relief_px: float | None
    crest_phase_px: float | None
    flank_rms_px: float | None
    trend_rms_px: float | None
    valid_fraction: float
    median_blur_px: float | None
    cycle_count: int
    reliable: bool
    reason: str | None


@dataclass(frozen=True)
class PeriodFoldedDiameterEstimate:
    diameter_px: float | None
    uncertainty_px: float | None
    mode: str
    positive: FoldedSideEstimate
    negative: FoldedSideEstimate
    bootstrap_sigma_px: float | None
    bootstrap_valid_fraction: float
    cross_side_relief_delta_px: float | None
    reason: str | None


def _robust_line(x: np.ndarray, y: np.ndarray):
    keep = np.isfinite(x) & np.isfinite(y)
    if np.count_nonzero(keep) < 8:
        return None
    for _ in range(4):
        m, b = np.polyfit(x[keep], y[keep], 1)
        err = y - (m * x + b)
        med = float(np.median(err[keep]))
        mad = 1.4826 * float(np.median(np.abs(err[keep] - med)))
        next_keep = keep & (np.abs(err - med) <= max(0.55, 3.0 * mad))
        if np.count_nonzero(next_keep) < 8:
            break
        keep = next_keep
    m, b = np.polyfit(x[keep], y[keep], 1)
    err = y[keep] - (m * x[keep] + b)
    return float(m), float(b), float(np.sqrt(np.mean(err * err))), keep


def _harmonic_relief(
    s: np.ndarray,
    values: np.ndarray,
    pitch_px: float,
    edge_spread_px: float | None,
):
    """Jointly fit drift + fundamental, then undo image-derived blur attenuation."""
    if edge_spread_px is None or not np.isfinite(edge_spread_px):
        return None
    sigma = max(0.0, float(edge_spread_px) / 2.563)
    transfer = float(np.exp(-0.5 * (2.0 * np.pi * sigma / pitch_px) ** 2))
    omega = 2.0 * np.pi / pitch_px
    s0 = float(np.median(s))
    x = s - s0
    design = np.column_stack((
        np.ones(len(s)), x, np.cos(omega * s), np.sin(omega * s),
    ))
    keep = np.isfinite(values)
    if np.count_nonzero(keep) < 24:
        return None
    for _ in range(4):
        coeff, _, _, _ = np.linalg.lstsq(design[keep], values[keep], rcond=None)
        err = values - design @ coeff
        med = float(np.median(err[keep]))
        mad = 1.4826 * float(np.median(np.abs(err[keep] - med)))
        nxt = keep & (np.abs(err - med) <= max(0.65, 3.0 * mad))
        if np.count_nonzero(nxt) < 24:
            break
        keep = nxt
    coeff, _, _, _ = np.linalg.lstsq(design[keep], values[keep], rcond=None)
    err = values[keep] - design[keep] @ coeff
    rms = float(np.sqrt(np.mean(err * err)))
    amplitude = float(np.hypot(coeff[2], coeff[3]))
    cycles = max(1.0, float(np.ptp(s[keep])) / pitch_px)
    relief = None
    if transfer >= 0.30 and amplitude >= max(0.12, 2.5 * rms / np.sqrt(cycles)):
        candidate = float((np.pi ** 2 / 8.0) * amplitude / transfer)
        if np.isfinite(candidate) and 0.25 < candidate <= 0.90 * pitch_px:
            relief = candidate
    phase = float((np.arctan2(coeff[3], coeff[2]) / omega) % pitch_px)
    return {
        "baseline": float(coeff[0]),
        "slope": float(coeff[1]),
        "relief": relief,
        "phase": phase,
        "rms": rms,
        "transfer": transfer,
        "amplitude": amplitude,
        "s0": s0,
    }


def _side(track, pitch_px: float, extra_mask: np.ndarray | None = None):
    s = np.asarray(track.s_px, dtype=np.float64)
    y = np.asarray(track.outward_px, dtype=np.float64)
    n = len(s)
    observed = np.asarray(track.valid, dtype=bool) & np.isfinite(s) & np.isfinite(y)
    if extra_mask is not None:
        observed &= np.asarray(extra_mask, dtype=bool)
    valid_fraction = float(np.mean(observed)) if n else 0.0

    def med(values):
        a = np.asarray(values, dtype=np.float64)
        use = observed & np.isfinite(a) if len(a) == n else np.zeros(n, dtype=bool)
        return float(np.median(a[use])) if np.any(use) else None

    blur = med(track.blur_10_90_px)
    if np.count_nonzero(observed) < max(24, int(round(4.0 * pitch_px))):
        return FoldedSideEstimate(None, None, None, None, None, None,
                                  valid_fraction, blur, 0, False,
                                  "edge_support_insufficient")

    sv, yv = s[observed], y[observed]
    s0 = float(np.median(sv))
    trend = _robust_line(sv - s0, yv)
    if trend is None:
        return FoldedSideEstimate(None, None, None, None, None, None,
                                  valid_fraction, blur, 0, False,
                                  "baseline_fit_failed")
    slope, intercept, trend_rms, _ = trend
    residual = yv - (slope * (sv - s0) + intercept)
    residual_center = float(np.median(residual))
    baseline = float(intercept + residual_center)
    residual = residual - residual_center

    harmonic = _harmonic_relief(sv, yv, pitch_px, blur)
    if harmonic is not None:
        # Joint fitting prevents an imbalanced set of thread phases from leaking
        # periodic amplitude into the linear baseline.
        baseline = float(harmonic["baseline"])
        slope = float(harmonic["slope"])
        residual = yv - (baseline + slope * (sv - float(harmonic["s0"])))

    phase = np.mod(sv, pitch_px)
    bins = max(8, min(32, int(round(pitch_px * 2.0))))
    edges = np.linspace(0.0, pitch_px, bins + 1)
    centers = 0.5 * (edges[:-1] + edges[1:])
    folded = np.full(bins, np.nan)
    for i in range(bins):
        use = (phase >= edges[i]) & (phase < edges[i + 1])
        if np.count_nonzero(use) >= 2:
            folded[i] = float(np.median(residual[use]))
    finite = np.isfinite(folded)
    if np.count_nonzero(finite) < max(6, bins // 3):
        return FoldedSideEstimate(baseline, None, None, None, None, trend_rms,
                                  valid_fraction, blur, 0, False,
                                  "phase_support_insufficient")
    crest_phase = float(centers[np.nanargmax(folded)])
    d = np.mod(phase - crest_phase + 0.5 * pitch_px, pitch_px) - 0.5 * pitch_px

    left = (d >= -0.46 * pitch_px) & (d <= -0.16 * pitch_px)
    right = (d >= 0.16 * pitch_px) & (d <= 0.46 * pitch_px)
    lf = _robust_line(d[left], residual[left])
    rf = _robust_line(d[right], residual[right])
    flank_ok = lf is not None and rf is not None
    apex_d = float("nan")
    apex = float("nan")
    flank_rms = float("inf")
    if flank_ok:
        lm, lb, lrms, _ = lf
        rm, rb, rrms, _ = rf
        denom = lm - rm
        flank_rms = float(max(lrms, rrms))
        flank_ok = lm > 0.03 and rm < -0.03 and abs(denom) >= 0.08
        if flank_ok:
            apex_d = float((rb - lb) / denom)
            apex = float(lm * apex_d + lb)
            flank_ok = abs(apex_d) <= 0.22 * pitch_px and apex > 0.25

    use_harmonic = (
        harmonic is not None
        and harmonic["relief"] is not None
        and (not flank_ok or (blur is not None and blur > 0.30 * pitch_px))
    )
    if use_harmonic:
        relief = float(harmonic["relief"])
        crest_phase = float(harmonic["phase"])
        flank_rms = float(harmonic["rms"])
        apex_d = 0.0
    elif flank_ok:
        relief = apex
    else:
        reason = "flank_geometry_invalid" if lf is not None and rf is not None else "flank_fit_insufficient"
        return FoldedSideEstimate(baseline, None, None, crest_phase,
                                  None if not np.isfinite(flank_rms) else flank_rms,
                                  trend_rms, valid_fraction, blur, 0, False, reason)

    cycles = np.floor((sv - float(np.min(sv))) / pitch_px).astype(np.int32)
    cycle_count = int(len(np.unique(cycles)))
    reason = None
    if relief <= 0.35:
        reason = "thread_relief_too_small"
    elif cycle_count < 8:
        reason = "thread_cycles_insufficient"
    elif flank_rms > max(1.2, 0.35 * relief):
        reason = "flank_fit_residual_high"
    elif blur is not None and blur > 0.75 * pitch_px:
        reason = "edge_spread_too_wide_for_flank_recovery"

    return FoldedSideEstimate(
        baseline, baseline + relief, relief, crest_phase, flank_rms, trend_rms,
        valid_fraction, blur, cycle_count, reason is None, reason,
    )


def _diameter_from_sides(pos, neg, preferred_mode: str | None = None):
    if pos.baseline_px is None or neg.baseline_px is None:
        return None, "baseline_support_insufficient", "none"
    if preferred_mode == "bilateral" or (preferred_mode is None and pos.reliable and neg.reliable):
        if not (pos.reliable and neg.reliable):
            return None, "bilateral_fold_unavailable", "none"
        return float(pos.crest_px + neg.crest_px), None, "bilateral_folded_flanks"
    trusted = None
    if preferred_mode == "positive":
        trusted = pos if pos.reliable else None
    elif preferred_mode == "negative":
        trusted = neg if neg.reliable else None
    elif pos.reliable ^ neg.reliable:
        trusted = pos if pos.reliable else neg
    if trusted is None or trusted.relief_px is None:
        return None, "trusted_folded_profile_unavailable", "none"
    value = float(pos.baseline_px + neg.baseline_px + 2.0 * trusted.relief_px)
    mode = "shared_profile_positive" if trusted is pos else "shared_profile_negative"
    return value, None, mode


def estimate_period_folded_diameter(
    positive_track,
    negative_track,
    pitch_px: float,
    *,
    bootstrap_repeats: int = 64,
    random_seed: int = 0,
) -> PeriodFoldedDiameterEstimate:
    """Estimate thread major D from repeated cycles without catalog/GT input."""
    if not np.isfinite(pitch_px) or pitch_px < 3.0:
        empty = FoldedSideEstimate(None, None, None, None, None, None, 0.0,
                                   None, 0, False, "invalid_pitch")
        return PeriodFoldedDiameterEstimate(None, None, "none", empty, empty,
                                            None, 0.0, None, "invalid_pitch")
    pos = _side(positive_track, float(pitch_px))
    neg = _side(negative_track, float(pitch_px))
    relief_delta = (
        abs(float(pos.relief_px - neg.relief_px))
        if pos.relief_px is not None and neg.relief_px is not None else None
    )
    value, reason, mode = _diameter_from_sides(pos, neg)
    if value is None:
        return PeriodFoldedDiameterEstimate(None, None, mode, pos, neg, None,
                                            0.0, relief_delta, reason)

    if mode == "bilateral_folded_flanks":
        mean_relief = 0.5 * (pos.relief_px + neg.relief_px)
        if relief_delta > max(1.5, 0.35 * mean_relief):
            return PeriodFoldedDiameterEstimate(
                None, None, "none", pos, neg, None, 0.0, relief_delta,
                "cross_side_relief_disagrees",
            )
        preferred = "bilateral"
    else:
        preferred = "positive" if mode.endswith("positive") else "negative"

    s = np.asarray(positive_track.s_px, dtype=np.float64)
    cycles = np.floor((s - float(np.nanmin(s))) / pitch_px).astype(np.int32)
    unique = np.unique(cycles)
    rng = np.random.default_rng(random_seed)
    boot = []
    if len(unique) >= 8:
        take = max(8, int(round(0.68 * len(unique))))
        for _ in range(max(0, int(bootstrap_repeats))):
            chosen = rng.choice(unique, size=min(take, len(unique)), replace=False)
            mask = np.isin(cycles, chosen)
            bp = _side(positive_track, pitch_px, mask)
            bn = _side(negative_track, pitch_px, mask)
            candidate, _, _ = _diameter_from_sides(bp, bn, preferred)
            if candidate is not None and np.isfinite(candidate):
                boot.append(float(candidate))
    valid_fraction = len(boot) / max(int(bootstrap_repeats), 1)
    if len(boot) >= 8:
        arr = np.asarray(boot)
        center = float(np.median(arr))
        sigma = 1.4826 * float(np.median(np.abs(arr - center)))
    else:
        sigma = None

    fit_floor = max(
        x for x in (
            pos.flank_rms_px or 0.0, neg.flank_rms_px or 0.0,
            0.5 * ((pos.trend_rms_px or 0.0) + (neg.trend_rms_px or 0.0)),
        )
    )
    uncertainty = max(float(sigma or 0.0), float(fit_floor))
    final_reason = None
    if valid_fraction < 0.75:
        final_reason = "bootstrap_support_insufficient"
    elif sigma is None or sigma > max(2.0, 0.06 * value):
        final_reason = "bootstrap_diameter_unstable"

    return PeriodFoldedDiameterEstimate(
        value if final_reason is None else None,
        uncertainty if final_reason is None else None,
        mode if final_reason is None else "none",
        pos, neg, sigma, valid_fraction, relief_delta, final_reason,
    )
