"""Raw-image edge observations for dimensional metrology.

A segmentation contour defines the search neighbourhood, not the physical edge.
Each side is observed separately in the source image.  The fit-based uncertainty
is an image-space quality proxy, not a calibrated statistical confidence interval.
This module intentionally has no knowledge of thread pitch or nominal fastener D.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

import cv2
import numpy as np

from thread_geometry import ThreadedShankProfile
from diameter_axis import estimate_independent_axis


@dataclass(frozen=True)
class EdgeTrack:
    s_px: np.ndarray
    outward_px: np.ndarray
    uncertainty_px: np.ndarray
    contrast: np.ndarray
    blur_10_90_px: np.ndarray
    relative_residual: np.ndarray
    valid: np.ndarray


@dataclass(frozen=True)
class DiameterObservation:
    value_px: float | None
    uncertainty_px: float | None
    upper: EdgeTrack  # +profile.normal (not necessarily image top)
    lower: EdgeTrack  # -profile.normal (not necessarily image bottom)
    upper_crest_count: int
    lower_crest_count: int
    upper_crest_px: float | None
    lower_crest_px: float | None
    reason: str | None
    positive_normal_relief_px: float | None = None
    negative_normal_relief_px: float | None = None
    measurement_mode: str = "none"
    axis_reference_samples: int = 0
    axis_residual_px: float | None = None
    axis_uncertainty_px: float | None = None
    axis_slope: float | None = None
    candidate_value_px: float | None = None
    candidate_uncertainty_px: float | None = None
    axis_crest_uncertainty_px: float | None = None
    axis_extrapolation_px: float | None = None


def _edge_track(
    image_rgb: np.ndarray,
    profile: ThreadedShankProfile,
    coarse_offsets: np.ndarray,
    outward_sign: float,
) -> EdgeTrack:
    """Observe a transverse step in raw grayscale along every coarse edge normal.

    u>0 is outside the fastener on either side. The contour is only a prior:
    the fitted half-contrast point can move on either side of that prior.
    """
    s = profile.s_values[profile.sample_mask].astype(np.float64)
    coarse = coarse_offsets[profile.sample_mask].astype(np.float64)
    n = len(s)
    missing = np.full(n, np.nan, dtype=np.float64)
    if n == 0:
        return EdgeTrack(s, missing, missing, missing, missing, missing, np.zeros(0, dtype=bool))

    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    u = np.arange(-10.0, 10.01, 0.25, dtype=np.float64)
    normals = coarse[:, None] + outward_sign * u[None, :]
    origin = profile.center[None, None, :] + profile.axis[None, None, :] * s[:, None, None]
    xy = origin + profile.normal[None, None, :] * normals[:, :, None]
    xx = xy[:, :, 0]
    yy = xy[:, :, 1]
    inside_image = (
        (xx[:, 0] >= 1) & (xx[:, -1] < gray.shape[1] - 1)
        & (yy.min(axis=1) >= 1) & (yy.max(axis=1) < gray.shape[0] - 1)
    )
    # xx endpoints can be reversed on the lower side; check both extrema.
    inside_image &= (xx.min(axis=1) >= 1) & (xx.max(axis=1) < gray.shape[1] - 1)
    profiles = cv2.remap(
        gray, xx.astype(np.float32), yy.astype(np.float32),
        cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0,
    ).astype(np.float64)

    result_offset = missing.copy()
    uncertainty = missing.copy()
    contrast_values = missing.copy()
    blur_values = missing.copy()
    residual_values = missing.copy()
    valid = np.zeros(n, dtype=bool)

    fg_region = (u >= -9.0) & (u <= -5.5)
    bg_region = (u >= 6.0) & (u <= 9.5)
    mid_region = (u >= -6.0) & (u <= 7.0)
    mid_u = u[mid_region]

    # A small physically interpretable family of optical edge-spread widths.
    sigmas = (0.55, 0.85, 1.25, 1.8, 2.5, 3.4)
    centers = np.arange(-5.5, 6.51, 0.5)
    templates = []
    for sigma in sigmas:
        for mu in centers:
            occupancy = 1.0 / (1.0 + np.exp(np.clip((mid_u - mu) / sigma, -30, 30)))
            templates.append((mu, sigma, occupancy))
    model_occ = np.stack([p[2] for p in templates])
    model_centers = np.array([p[0] for p in templates])
    model_sigma = np.array([p[1] for p in templates])

    for index in np.flatnonzero(inside_image & np.isfinite(coarse)):
        samples = profiles[index]
        foreground = float(np.median(samples[fg_region]))
        background = float(np.median(samples[bg_region]))
        contrast = background - foreground
        if contrast < 20.0:
            continue

        # The raw image, rather than a binary segmentation threshold, selects
        # the physical 50%-contrast edge.  Fit only within the search corridor;
        # specular texture deeper in the screw is not another contour candidate.
        observed = samples[mid_region]
        predicted = background + (foreground - background) * model_occ
        residuals = observed[None, :] - predicted
        # Cap the influence of isolated metal highlights and JPEG ringing.
        clipped = np.clip(residuals, -contrast * 0.65, contrast * 0.65)
        losses = np.mean(clipped * clipped, axis=1)
        losses += 0.15 * model_centers * model_centers
        best = int(np.argmin(losses))
        mu, sigma = float(model_centers[best]), float(model_sigma[best])
        fit = predicted[best]
        local = np.abs(mid_u - mu) <= max(2.5, 1.8 * sigma)
        rmse = float(np.sqrt(np.mean((observed[local] - fit[local]) ** 2)))
        relative = rmse / contrast
        blur = 4.394 * sigma  # Logistic 10-90% transition width.
        if relative > 0.30 or blur > 12.0:
            continue

        # Check that the fitted edge is a real dark-to-light transition.
        derivative = np.gradient(samples, u)
        near_edge = np.abs(u - mu) <= max(1.0, sigma)
        if float(np.max(derivative[near_edge])) < max(3.0, contrast * 0.07):
            continue
        result_offset[index] = outward_sign * (coarse[index] + outward_sign * mu)
        # Proxy includes fit noise and optical spread; not a calibrated CI.
        uncertainty[index] = 0.15 + sigma * max(rmse, 2.0) / contrast
        contrast_values[index] = contrast
        blur_values[index] = blur
        residual_values[index] = relative
        valid[index] = True

    return EdgeTrack(s, result_offset, uncertainty, contrast_values, blur_values, residual_values, valid)


def observe_thread_edges(
    image_rgb: np.ndarray, profile: ThreadedShankProfile
) -> tuple[EdgeTrack, EdgeTrack]:
    """Shared raw-image primitive; P and head geometry may consume it later."""
    upper = _edge_track(image_rgb, profile, profile.high, 1.0)
    lower = _edge_track(image_rgb, profile, profile.low, -1.0)
    return upper, lower


def _crest_envelope(
    track: EdgeTrack, *, allow_smooth: bool = True,
) -> tuple[float | None, float | None, int, float | None]:
    """Use repeatedly observed, trustworthy *outward* crests, not a blur-biased mask."""
    if int(np.count_nonzero(track.valid)) < 20:
        return None, None, 0, None
    s = track.s_px
    values = track.outward_px
    valid = track.valid
    # Interpolation is for locating local extrema only; reject peaks adjacent
    # to missing observations so interpolation cannot invent a crest.
    indices = np.flatnonzero(valid)
    filled = np.interp(s, s[indices], values[indices])
    smooth = cv2.GaussianBlur(filled.reshape(1, -1), (0, 0), sigmaX=0.6).ravel()

    peak_indices: list[int] = []
    peak_prominences: list[float] = []
    for i in range(8, len(smooth) - 8):
        if not np.all(valid[i - 2 : i + 3]):
            continue
        if smooth[i] < smooth[i - 1] or smooth[i] < smooth[i + 1]:
            continue
        if smooth[i] < np.max(smooth[i - 3 : i + 4]) - 0.10:
            continue
        left_min = float(np.min(smooth[i - 7 : i - 1]))
        right_min = float(np.min(smooth[i + 2 : i + 8]))
        prominence = smooth[i] - max(left_min, right_min)
        if prominence < max(0.60, 1.2 * float(track.uncertainty_px[i])):
            continue
        if peak_indices and i - peak_indices[-1] < 3:
            if smooth[i] > smooth[peak_indices[-1]]:
                peak_indices[-1] = i
                peak_prominences[-1] = float(prominence)
            continue
        peak_indices.append(i)
        peak_prominences.append(float(prominence))

    if len(peak_indices) < 4:
        if not allow_smooth:
            return None, None, len(peak_indices), None
        # Smooth non-threaded shanks are still measurable. A single stable
        # physical surface on both sides is sufficient for cylindrical D.
        stable = values[valid]
        median_stable = float(np.median(stable))
        spread = float(np.percentile(stable, 75) - np.percentile(stable, 25))
        if spread <= 1.0 and int(np.count_nonzero(valid)) >= 20:
            return median_stable, max(
                float(np.median(track.uncertainty_px[valid])),
                1.4826 * float(np.median(np.abs(stable - median_stable))),
            ), int(np.count_nonzero(valid)), None
        return None, None, len(peak_indices), None
    peaks = np.array([float(smooth[i]) for i in peak_indices])
    errors = np.array([float(track.uncertainty_px[i]) for i in peak_indices])
    relief = np.asarray(peak_prominences, dtype=np.float64)

    # Major D is the repeated outer crest envelope, not the inner root or
    # smooth shank.  Reject isolated high glints/spikes by requiring a cluster.
    threshold = float(np.percentile(peaks, 65))
    chosen = peaks >= threshold
    if int(np.count_nonzero(chosen)) < 4:
        chosen[np.argsort(peaks)[-4:]] = True
    heights = peaks[chosen]
    uncertainties = errors[chosen]
    relief = relief[chosen]
    median = float(np.median(heights))
    mad = float(np.median(np.abs(heights - median)))
    coherent = np.abs(heights - median) <= max(2.0, 3.0 * mad)
    if int(np.count_nonzero(coherent)) < 4:
        return None, None, int(np.count_nonzero(coherent)), None
    heights = heights[coherent]
    uncertainties = uncertainties[coherent]
    relief = relief[coherent]
    estimate = float(np.median(heights))
    # The 1.4826*MAD term is observed tooth-to-tooth variation, not a fitted
    # edge's statistical error. Keep both to avoid false precision.
    dispersion = 1.4826 * float(np.median(np.abs(heights - estimate)))
    uncertainty = max(float(np.median(uncertainties)), dispersion)
    if uncertainty > max(2.0, 0.14 * abs(estimate)):
        return None, uncertainty, len(heights), float(np.median(relief))
    return estimate, uncertainty, len(heights), float(np.median(relief))


def _trusted_crest(
    track: EdgeTrack,
    envelope: float | None,
    relief: float | None,
) -> bool:
    if envelope is None:
        return False
    if relief is None:
        # A smooth cylindrical shank has a valid surface but cannot on its own
        # serve as the one-sided thread-major crest observation.
        return True
    if not np.any(track.valid):
        return False
    median_blur = float(np.median(track.blur_10_90_px[track.valid]))
    return median_blur <= max(3.0, relief * 2.5)


def measure_thread_major_diameter(
    image_rgb: np.ndarray,
    profile: ThreadedShankProfile,
) -> DiameterObservation:
    """Adaptive D: two trusted crests, or one crest + independent centerline.

    Crucially, the independent axis is determined *without* the selected
    threaded flank: it must be grounded in a separate bilateral cylindrical
    image region. We never double a single edge against an assumed center or
    use catalog D to select an estimator. P and L consume their old inputs.
    """
    upper, lower = observe_thread_edges(image_rgb, profile)
    up, up_unc, up_n, up_relief = _crest_envelope(upper)
    lo, lo_unc, lo_n, lo_relief = _crest_envelope(lower)
    trusted_up = _trusted_crest(upper, up, up_relief)
    trusted_lo = _trusted_crest(lower, lo, lo_relief)
    # An unresolved threaded flank can look like a smooth silhouette after
    # blur. Never combine its root/baseline with the opposite side's actual
    # thread crests and call the sum a physical major diameter.
    if up_relief is None and lo_relief is not None:
        trusted_up = False
    if lo_relief is None and up_relief is not None:
        trusted_lo = False

    def result(
        value: float | None, uncertainty: float | None,
        reason: str | None, mode: str, axis=None,
        final_up: float | None = up, final_lo: float | None = lo,
        final_up_n: int = up_n, final_lo_n: int = lo_n,
        candidate_value: float | None = None,
        candidate_uncertainty: float | None = None,
        axis_crest_uncertainty: float | None = None,
        axis_extrapolation: float | None = None,
    ) -> DiameterObservation:
        return DiameterObservation(
            value_px=value,
            uncertainty_px=uncertainty,
            upper=upper,
            lower=lower,
            upper_crest_count=final_up_n,
            lower_crest_count=final_lo_n,
            upper_crest_px=final_up,
            lower_crest_px=final_lo,
            reason=reason,
            positive_normal_relief_px=up_relief,
            negative_normal_relief_px=lo_relief,
            measurement_mode=mode,
            axis_reference_samples=axis.reference_samples if axis is not None else 0,
            axis_residual_px=axis.residual_px if axis is not None else None,
            axis_uncertainty_px=axis.uncertainty_at_origin_px if axis is not None else None,
            axis_slope=axis.normal_slope if axis is not None else None,
            candidate_value_px=candidate_value,
            candidate_uncertainty_px=candidate_uncertainty,
            axis_crest_uncertainty_px=axis_crest_uncertainty,
            axis_extrapolation_px=axis_extrapolation,
        )

    if trusted_up and trusted_lo:
        value = float(up + lo)
        uncertainty = float(np.hypot(up_unc, lo_unc))
        if uncertainty <= max(2.5, 0.08 * value):
            return result(value, uncertainty, None, "two_side")
        # Both physical surfaces visible, but tooth-to-tooth dispersion is too
        # large to support a numeric major diameter.
        return result(None, None, "edge_diameter_uncertain", "none")

    if not trusted_up and not trusted_lo:
        reason = (
            "edge_side_support_insufficient"
            if up is None or lo is None
            else "edge_crest_underresolved"
        )
        return result(None, None, reason, "none")

    # The *other* side must establish a truly independent axis, i.e. an
    # observable bilateral smooth region, not a guessed symmetric offset of
    # the selected thread crests.
    axis = estimate_independent_axis(upper, lower)
    if axis is None:
        reason = (
            "edge_side_support_insufficient"
            if up is None or lo is None
            else "independent_axis_unavailable"
        )
        return result(None, None, reason, "none")

    sign, track = (1.0, upper) if trusted_up else (-1.0, lower)
    # The axis reference segment cannot also count as the crests used to
    # estimate thread major D. This prevents a smooth partial shank from
    # masquerading as the threaded surface being measured.
    separate = (
        (track.s_px < axis.span_start_px - 8.0)
        | (track.s_px > axis.span_end_px + 8.0)
    )
    candidate = replace(
        track,
        outward_px=track.outward_px - sign * axis.normal_coordinate(track.s_px),
        valid=track.valid & separate,
    )
    radius, radius_unc, crest_count, relief = _crest_envelope(
        candidate, allow_smooth=False,
    )
    if radius is None or radius_unc is None or relief is None:
        return result(
            None, None, "one_sided_crest_insufficient", "none", axis=axis,
        )

    # The selected side must remain physically resolved after excluding the
    # smooth reference section. Check its own optical blur vs crest relief,
    # not the unusable opposite flank's blur.
    trusted = track.valid & separate
    if not np.any(trusted):
        return result(None, None, "one_sided_crest_insufficient", "none", axis=axis)
    median_blur = float(np.median(track.blur_10_90_px[trusted]))
    if median_blur > max(3.0, relief * 2.5):
        return result(None, None, "one_sided_crest_underresolved", "none", axis=axis)

    crest_s = float(np.median(track.s_px[trusted]))
    center_uncertainty = axis.uncertainty(crest_s)
    extrapolation = max(
        axis.span_start_px - crest_s, crest_s - axis.span_end_px, 0.0
    )
    value = float(radius * 2.0)
    uncertainty = float(2.0 * np.hypot(radius_unc, center_uncertainty))
    if (
        radius <= 2.0
        or uncertainty > max(4.0, 0.12 * value)
        or not np.isfinite(value)
    ):
        return result(
            None, None, "one_sided_diameter_uncertain", "none", axis=axis,
            candidate_value=value,
            candidate_uncertainty=uncertainty,
            axis_crest_uncertainty=center_uncertainty,
            axis_extrapolation=extrapolation,
        )
    return result(
        value, uncertainty, None,
        "positive_normal_plus_independent_axis"
        if sign > 0 else "negative_normal_plus_independent_axis",
        axis=axis,
        final_up=radius if sign > 0 else up,
        final_lo=radius if sign < 0 else lo,
        final_up_n=crest_count if sign > 0 else up_n,
        final_lo_n=crest_count if sign < 0 else lo_n,
        candidate_value=value, candidate_uncertainty=uncertainty,
        axis_crest_uncertainty=center_uncertainty,
        axis_extrapolation=extrapolation,
    )
