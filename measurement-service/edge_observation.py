"""Raw-image edge observations for dimensional metrology.

A segmentation contour defines the search neighbourhood, not the physical edge.
Each side is observed separately in the source image.  The fit-based uncertainty
is an image-space quality proxy, not a calibrated statistical confidence interval.
This module intentionally has no knowledge of thread pitch or nominal fastener D.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from thread_geometry import ThreadedShankProfile


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


def _crest_envelope(track: EdgeTrack) -> tuple[float | None, float | None, int, float | None]:
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


def measure_thread_major_diameter(
    image_rgb: np.ndarray,
    profile: ThreadedShankProfile,
) -> DiameterObservation:
    upper, lower = observe_thread_edges(image_rgb, profile)
    up, up_unc, up_n, up_relief = _crest_envelope(upper)
    lo, lo_unc, lo_n, lo_relief = _crest_envelope(lower)
    reason = None
    value = None
    uncertainty = None
    if up is None or lo is None:
        reason = "edge_side_support_insufficient"
    else:
        value = up + lo
        uncertainty = float(np.hypot(up_unc, lo_unc))
        # An apparently excellent logistic fit can track a dark reflectance
        # band *inside* a shiny metal crest. Optical spread wider than the
        # observed crest relief means the physical crest is under-resolved;
        # tiny fit residuals alone must not produce false precision.
        for track, relief in ((upper, up_relief), (lower, lo_relief)):
            if relief is None:
                continue  # genuinely smooth shank; no tooth relief to resolve
            crest_blur = float(np.median(track.blur_10_90_px[track.valid]))
            if crest_blur > max(3.0, relief * 2.5):
                reason = "edge_crest_underresolved"
                value = None
                uncertainty = None  # Cannot bound model bias from a blurred crest.
                break
        if value is not None and uncertainty > max(2.5, 0.08 * value):
            reason = "edge_diameter_uncertain"
            value = None
            uncertainty = None
    return DiameterObservation(
        value, uncertainty, upper, lower, up_n, lo_n, up, lo, reason,
        up_relief, lo_relief,
    )
