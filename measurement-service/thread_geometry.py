from __future__ import annotations

from dataclasses import dataclass
import math

import cv2
import numpy as np

from geometry import _geometry_from_contour


@dataclass(frozen=True)
class ThreadedShankProfile:
    center: np.ndarray
    axis: np.ndarray
    normal: np.ndarray
    s_values: np.ndarray
    low: np.ndarray
    high: np.ndarray
    widths: np.ndarray
    sample_mask: np.ndarray
    transition_s: float
    tip_s: float
    start_xy: tuple[float, float]
    end_xy: tuple[float, float]


@dataclass(frozen=True)
class HeadUnderfaceEstimate:
    """A bilateral, observed bearing plane, not the start of a neck fillet."""
    s: float
    shank_outer_px: float
    radial_support_px: float
    fit_residual_px: float
    side_disagreement_px: float


@dataclass(frozen=True)
class HeadBodyStructure:
    """Common axial structure; separating regions does not establish a datum.

    transition_start_s marks departure from the shaft envelope. bearing_plane
    is optional because a neck/fillet, cone or curved projection is not itself
    evidence of a perpendicular seating plane. All coordinates use the shank
    profile's frame. No head-style name or catalog dimension enters the fit.
    """
    tip_s: float
    head_top_s: float
    transition_start_s: float | None
    bearing_plane: HeadUnderfaceEstimate | None
    reason_code: str | None


@dataclass(frozen=True)
class PeriodicityEstimate:
    pitch_px: float | None
    left_pitch_px: float | None
    right_pitch_px: float | None
    left_score: float | None
    right_score: float | None
    reason_code: str | None
    left_autocorrelation_px: float | None = None
    right_autocorrelation_px: float | None = None
    left_frequency_px: float | None = None
    right_frequency_px: float | None = None
    left_peak_spacing_px: float | None = None
    right_peak_spacing_px: float | None = None
    width_pitch_px: float | None = None
    width_score: float | None = None
    width_autocorrelation_px: float | None = None
    width_frequency_px: float | None = None
    width_peak_spacing_px: float | None = None


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


def _median_smooth(values: np.ndarray, fraction: float = 0.03) -> np.ndarray:
    count = len(values)
    if count < 3:
        return values.copy()
    kernel = max(3, int(round(count * fraction)))
    if kernel % 2 == 0:
        kernel += 1
    radius = kernel // 2
    padded = np.pad(values, radius, mode="edge")
    return np.array(
        [np.median(padded[index : index + kernel]) for index in range(count)],
        dtype=np.float64,
    )


def _detect_threaded_shank_global(contour: np.ndarray) -> ThreadedShankProfile | None:
    """Resolve the narrow, long side of a bolt-like width transition.

    The wider side is treated as the head. The farther narrow side becomes the
    threaded-shank region. Small margins are removed at the tip and head so D
    and pitch are measured only on a stable interior section.
    """
    center, axis, _, _, _, _ = _geometry_from_contour(contour)
    axis = np.asarray(axis, dtype=np.float64)
    axis_norm = float(np.linalg.norm(axis))
    if axis_norm < 1e-6:
        return None
    axis /= axis_norm
    if axis[0] < 0 or (abs(axis[0]) < 1e-6 and axis[1] < 0):
        axis = -axis
    normal = np.array([-axis[1], axis[0]], dtype=np.float64)

    points = _filled_contour_points(contour)
    if len(points) < 20:
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
    valid = np.isfinite(low) & np.isfinite(high)
    if int(np.count_nonzero(valid)) < 12:
        return None

    samples = np.arange(bin_count, dtype=np.float64)
    low = np.interp(samples, samples[valid], low[valid])
    high = np.interp(samples, samples[valid], high[valid])
    widths = high - low
    smooth_widths = _median_smooth(widths)

    window = max(4, int(round(bin_count * 0.06)))
    margin = max(window + 2, int(round(bin_count * 0.08)))
    best: tuple[float, int] | None = None
    for index in range(margin, bin_count - margin):
        left = float(np.median(smooth_widths[max(0, index - window) : index]))
        right = float(np.median(smooth_widths[index : min(bin_count, index + window)]))
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
    span = abs(tip_s - transition_s)
    if span < 24.0:
        return None

    trim_tip = 0.08 * span
    trim_head = 0.12 * span
    if tip_s < transition_s:
        region_start = tip_s + trim_tip
        region_end = transition_s - trim_head
    else:
        region_start = transition_s + trim_head
        region_end = tip_s - trim_tip

    low_s = min(region_start, region_end)
    high_s = max(region_start, region_end)
    s_values = axial_min + samples
    sample_mask = (s_values >= low_s) & (s_values <= high_s)
    if int(np.count_nonzero(sample_mask)) < 20:
        return None

    start_xy = center + axis * region_start
    end_xy = center + axis * region_end
    return ThreadedShankProfile(
        center=center,
        axis=axis,
        normal=normal,
        s_values=s_values,
        low=low,
        high=high,
        widths=widths,
        sample_mask=sample_mask,
        transition_s=transition_s,
        tip_s=tip_s,
        start_xy=(float(start_xy[0]), float(start_xy[1])),
        end_xy=(float(end_xy[0]), float(end_xy[1])),
    )



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


def detect_threaded_shank(contour: np.ndarray) -> ThreadedShankProfile | None:
    """Prefer proven shaft frames; recover short/wide parts from local regimes.

    A pre-existing global frame is retained when its own shaft/body transition
    is physically supported. When that assumption fails, independently infer
    a local frame instead of forcing the whole-object principal axis.
    """
    global_frame = _detect_threaded_shank_global(contour)
    if global_frame is not None:
        outer = measure_outer_width_px(global_frame)
        if outer is not None and _neck_start(global_frame, outer) is not None:
            return global_frame
    local_frame = detect_local_shank_regime(contour)
    return local_frame if local_frame is not None else global_frame

def _neck_start(profile: ThreadedShankProfile, outer: float) -> float | None:
    """Locate a region boundary only; this is explicitly NOT a length datum."""
    sample_indices = np.flatnonzero(profile.sample_mask)
    toward_head = 1 if profile.transition_s > profile.tip_s else -1
    edge = int(sample_indices[-1] if toward_head > 0 else sample_indices[0])
    end = len(profile.widths) - 1 if toward_head > 0 else 0
    ordered = np.arange(edge, end + toward_head, toward_head)
    smooth = _median_smooth(profile.widths, fraction=0.02)
    stable_limit = max(outer * 1.06, outer + 2.0)
    expansion = max(outer * 1.15, outer + 4.0)
    persistence = int(np.clip(round(outer * 0.08), 5, 24))
    for pos in range(1, len(ordered) - persistence + 1):
        window = smooth[ordered[pos:pos + persistence]]
        if np.median(window) < expansion or np.mean(window >= expansion) < 0.70:
            continue
        while pos > 0 and smooth[ordered[pos - 1]] > stable_limit:
            pos -= 1
        return float(profile.s_values[ordered[pos]])
    return None


def _radial_frontier(
    profile: ThreadedShankProfile, envelope: np.ndarray, root_radius: float,
    toward_head: int, outer: float,
) -> tuple[np.ndarray, np.ndarray]:
    """First head-facing silhouette intersection at each outward radius.

    Viewing the shoulder as axial position versus radius preserves a vertical
    bearing face, which a width-versus-axis change point cannot localize.
    Interpolation uses existing silhouette samples; it does not extrapolate a
    hidden plane through a fillet or assume a circular head cross-section.
    """
    indices = np.flatnonzero(profile.sample_mask)
    start = int(indices[-1] if toward_head > 0 else indices[0])
    end = len(envelope) - 1 if toward_head > 0 else 0
    ordered = np.arange(start, end + toward_head, toward_head)
    radial = envelope[ordered]
    axial = profile.s_values[ordered] * toward_head
    # Exclude thread crests and the outermost rasterized rim from plane fitting.
    radii = np.arange(root_radius + max(2.0, outer * 0.03),
                      float(np.max(radial)) - 1.0, 1.0)
    positions = []
    for radius in radii:
        hits = np.flatnonzero(radial >= radius)
        if not len(hits) or hits[0] == 0:
            return np.empty(0), np.empty(0)
        i = int(hits[0])
        fraction = (radius - radial[i - 1]) / (radial[i] - radial[i - 1])
        positions.append(axial[i - 1] + fraction * (axial[i] - axial[i - 1]))
    return radii, np.asarray(positions)


def _shoulder_segments(
    radii: np.ndarray, positions: np.ndarray, outer: float,
) -> list[tuple[float, float, float, float]]:
    """Radially extended, near-perpendicular faces, ordered from root outward.

    A valid segment has a small slope AND small residual over a finite span.
    Thus a locally smooth cone/curve cannot become a face just because it is
    noise-free. Pixel tolerances cover rasterization, not catalog error.
    """
    minimum_span = 3.0
    count = int(math.ceil(minimum_span)) + 1
    tolerance = max(1.0, 0.015 * outer)
    candidates = []
    for start in range(max(0, len(radii) - count + 1)):
        stop = start + count
        r, t = radii[start:stop], positions[start:stop]
        slope = float(np.polyfit(r, t, 1)[0])
        if abs(slope) > 0.15:
            continue
        fit = np.polyval(np.polyfit(r, t, 1), r)
        residual = float(np.max(np.abs(t - fit)))
        if residual > tolerance:
            continue
        # Extend the same plane, without incorporating the next head chamfer.
        while stop < len(radii):
            trial = positions[start:stop + 1]
            trial_r = radii[start:stop + 1]
            fit = np.polyfit(trial_r, trial, 1)
            if abs(fit[0]) > 0.15 or np.max(np.abs(trial - np.polyval(fit, trial_r))) > tolerance:
                break
            stop += 1
        t = positions[start:stop]
        r = radii[start:stop]
        residual = float(np.max(np.abs(t - np.polyval(np.polyfit(r, t, 1), r))))
        candidates.append((float(np.median(t)), float(radii[start]),
                           float(radii[stop - 1]), residual))
    return candidates


def decompose_head_body(profile: ThreadedShankProfile) -> HeadBodyStructure:
    """Resolve shaft, transition and head, then independently verify a datum.

    The first bilateral shoulder outside the shank envelope is the seating
    face. Later parallel steps are head features, not replacement datums.
    Insufficient, curved, conical or disagreeing boundaries remain unresolved.
    This assumes an approximately side-on image, like the existing pipeline.
    """
    direction = 1 if profile.transition_s > profile.tip_s else -1
    top = float(profile.s_values[-1] if direction > 0 else profile.s_values[0])
    outer = measure_outer_width_px(profile)
    if outer is None or np.count_nonzero(profile.sample_mask) < 12:
        return HeadBodyStructure(profile.tip_s, top, None, None, "head_body_structure_unresolved")
    neck = _neck_start(profile, outer)
    if neck is None:
        return HeadBodyStructure(profile.tip_s, top, None, None, "head_body_structure_unresolved")
    upper = _side_crest_envelope(profile.high[profile.sample_mask], 1.0)
    lower = _side_crest_envelope(profile.low[profile.sample_mask], -1.0)
    middle = (upper - lower) / 2.0
    sides = []
    for envelope in (profile.high - middle, middle - profile.low):
        radii, positions = _radial_frontier(profile, envelope, outer / 2.0, direction, outer)
        sides.append(_shoulder_segments(radii, positions, outer))
    tolerance = max(2.0, 0.04 * outer)
    # Joint evidence: both sides must expose the same plane over overlapping
    # radial ranges. A one-sided shadow/notch is not a physical bearing face.
    candidates = []
    for left in sides[0]:
        for right in sides[1]:
            overlap = min(left[2], right[2]) - max(left[1], right[1])
            delta = abs(left[0] - right[0])
            if overlap < 3.0 or delta > tolerance:
                continue
            t = (left[0] + right[0]) / 2.0
            if (t - direction * profile.tip_s < 12.0
                    or direction * top - t < 3.0
                    or t < direction * neck - tolerance):
                continue
            candidates.append((max(left[1], right[1]), -overlap, t,
                               max(left[3], right[3]), delta))
    if not candidates:
        return HeadBodyStructure(profile.tip_s, top, neck, None, "bearing_plane_unresolved")
    _, negative_span, t, residual, delta = min(candidates)
    if -negative_span < max(6.0, 0.20 * outer):
        # A small first shoulder cannot be replaced by a broader, later head
        # step merely because that step is easier to fit.
        return HeadBodyStructure(profile.tip_s, top, neck, None, "bearing_plane_support_insufficient")
    plane = HeadUnderfaceEstimate(t * direction, float(outer), -negative_span, residual, delta)
    return HeadBodyStructure(profile.tip_s, top, neck, plane, None)


def estimate_head_underface(profile: ThreadedShankProfile) -> HeadUnderfaceEstimate | None:
    """Compatibility entry point; never substitute neck onset for a plane."""
    return decompose_head_body(profile).bearing_plane


def _side_crest_envelope(
    values: np.ndarray,
    outward_sign: float,
) -> float | None:
    """Estimate one side of the thread's outer crest envelope.

    The two silhouette sides are measured independently so their crests do not
    need to occur at the same axial coordinate.  Repeated local extrema are
    preferred; a robust one-sided quantile is the fallback for nearly smooth
    shanks.  This avoids isolated contour spikes without assuming a pitch.
    """
    raw = np.asarray(values, dtype=np.float64)
    raw = raw[np.isfinite(raw)]
    if len(raw) < 12:
        return None

    outward = raw * outward_sign
    smooth = cv2.GaussianBlur(outward.reshape(1, -1), (0, 0), sigmaX=0.8).ravel()

    peaks: list[float] = []
    for index in range(1, len(smooth) - 1):
        if smooth[index] >= smooth[index - 1] and smooth[index] >= smooth[index + 1]:
            peaks.append(float(smooth[index]))

    if len(peaks) >= 4:
        peak_values = np.asarray(peaks, dtype=np.float64)
        # Use the upper half of repeated crest candidates, then take its median.
        # This estimates the recurring outer envelope rather than the single
        # largest pixel excursion.
        floor = float(np.percentile(peak_values, 50))
        crest_values = peak_values[peak_values >= floor]
        if len(crest_values) >= 2:
            return float(np.median(crest_values))

    return float(np.percentile(outward, 95))


def measure_outer_width_px(profile: ThreadedShankProfile) -> float | None:
    """Return the physical thread major diameter from independent crest envelopes.

    A threaded silhouette is helical: upper and lower crests can be phase
    shifted, so same-x width systematically underestimates the true major
    diameter.  Estimate each side's recurring outer envelope independently and
    combine them only after the one-sided measurements are resolved.
    """
    high = profile.high[profile.sample_mask]
    low = profile.low[profile.sample_mask]
    high = high[np.isfinite(high)]
    low = low[np.isfinite(low)]
    if len(high) < 12 or len(low) < 12:
        return None

    upper_envelope = _side_crest_envelope(high, 1.0)
    lower_envelope_outward = _side_crest_envelope(low, -1.0)
    if upper_envelope is None or lower_envelope_outward is None:
        return None

    outer = upper_envelope + lower_envelope_outward
    same_x_widths = profile.widths[profile.sample_mask]
    same_x_widths = same_x_widths[np.isfinite(same_x_widths)]
    if len(same_x_widths) < 12:
        return None

    median_width = float(np.percentile(same_x_widths, 50))
    high_width = float(np.percentile(same_x_widths, 98))
    if median_width <= 1.0:
        return None

    # The independent crest envelope may exceed any same-x section because the
    # two thread sides can be phase shifted.  Reject only geometrically
    # implausible envelopes, not that expected phase difference.
    if outer < median_width * 0.95 or outer > max(high_width * 1.20, median_width * 1.35):
        return None
    return float(outer)


def _detrended_envelope(values: np.ndarray, max_period: int) -> np.ndarray:
    raw = np.asarray(values, dtype=np.float64)
    smooth = cv2.GaussianBlur(raw.reshape(1, -1), (0, 0), sigmaX=1.0).ravel()
    sigma = max(6.0, min(24.0, max_period / 2.0))
    trend = cv2.GaussianBlur(smooth.reshape(1, -1), (0, 0), sigmaX=sigma).ravel()
    signal = smooth - trend
    signal -= float(np.mean(signal))
    return signal


def _autocorrelation_period(
    values: np.ndarray,
    min_period: int,
    max_period: int,
) -> tuple[float | None, float | None]:
    if max_period <= min_period + 2 or len(values) < max_period + 8:
        return None, None

    signal = _detrended_envelope(values, max_period)
    if float(np.std(signal)) < 0.35:
        return None, None
    energy = float(np.dot(signal, signal))
    if energy < 1e-6:
        return None, None

    correlations: list[float] = []
    for lag in range(1, max_period + 1):
        overlap = signal[:-lag]
        shifted = signal[lag:]
        denominator = math.sqrt(
            float(np.dot(overlap, overlap)) * float(np.dot(shifted, shifted))
        )
        correlations.append(float(np.dot(overlap, shifted)) / max(denominator, 1e-9))
    correlation = np.asarray(correlations, dtype=np.float64)

    local_peaks: list[tuple[int, float]] = []
    for lag in range(max(min_period, 2), max_period):
        index = lag - 1
        if correlation[index] >= correlation[index - 1] and correlation[index] >= correlation[index + 1]:
            local_peaks.append((lag, float(correlation[index])))
    if not local_peaks:
        return None, None

    strongest = max(score for _, score in local_peaks)
    threshold = max(0.22, strongest * 0.75)
    eligible = [item for item in local_peaks if item[1] >= threshold]
    if not eligible:
        return None, None

    # Prefer the earliest strong local peak so repeated multiples (2P, 3P...)
    # do not replace the fundamental pitch.
    lag, score = min(eligible, key=lambda item: item[0])
    return float(lag), float(score)


def _frequency_period(
    values: np.ndarray,
    min_period: int,
    max_period: int,
) -> tuple[float | None, float | None]:
    """Estimate the fundamental period from the dominant spatial frequency."""
    signal = _detrended_envelope(values, max_period)
    count = len(signal)
    if count < max_period + 8 or float(np.std(signal)) < 0.35:
        return None, None

    window = np.hanning(count)
    spectrum = np.fft.rfft(signal * window)
    power = np.abs(spectrum) ** 2
    frequencies = np.fft.rfftfreq(count, d=1.0)

    min_frequency = 1.0 / max(float(max_period), 1.0)
    max_frequency = 1.0 / max(float(min_period), 1.0)
    valid = (
        (frequencies >= min_frequency)
        & (frequencies <= max_frequency)
        & (frequencies > 0)
    )
    indices = np.flatnonzero(valid)
    if len(indices) < 2:
        return None, None

    local_power = power[indices]
    peak_local = int(np.argmax(local_power))
    peak_index = int(indices[peak_local])
    peak_power = float(power[peak_index])
    baseline = float(np.median(local_power))
    if peak_power <= max(baseline * 3.0, 1e-6):
        return None, None

    # Parabolic interpolation reduces FFT-bin quantization without inventing a
    # new frequency outside the observed peak neighborhood.
    refined_index = float(peak_index)
    if 1 <= peak_index < len(power) - 1:
        y0 = math.log(max(float(power[peak_index - 1]), 1e-12))
        y1 = math.log(max(float(power[peak_index]), 1e-12))
        y2 = math.log(max(float(power[peak_index + 1]), 1e-12))
        denominator = y0 - 2.0 * y1 + y2
        if abs(denominator) > 1e-9:
            refined_index += float(np.clip(0.5 * (y0 - y2) / denominator, -0.5, 0.5))

    frequency = refined_index / float(count)
    if frequency <= 0:
        return None, None
    period = 1.0 / frequency
    if period < min_period * 0.90 or period > max_period * 1.10:
        return None, None

    score = min(1.0, peak_power / max(peak_power + baseline * 4.0, 1e-9))
    return float(period), float(score)


def _peak_spacing_period(
    values: np.ndarray,
    min_period: int,
    max_period: int,
) -> tuple[float | None, float | None]:
    """Estimate pitch from consecutive envelope extrema spacing."""
    signal = _detrended_envelope(values, max_period)
    if len(signal) < max_period + 8:
        return None, None
    std = float(np.std(signal))
    if std < 0.35:
        return None, None

    prominence_floor = max(0.30 * std, 0.18)

    def spacing_for(sign: float) -> tuple[float | None, float | None]:
        work = signal * sign
        candidates: list[int] = []
        for index in range(1, len(work) - 1):
            if work[index] < work[index - 1] or work[index] < work[index + 1]:
                continue
            local_left = max(0, index - max_period)
            local_right = min(len(work), index + max_period + 1)
            shoulder = max(
                float(np.min(work[local_left:index])) if index > local_left else float(work[index]),
                float(np.min(work[index + 1:local_right])) if local_right > index + 1 else float(work[index]),
            )
            if float(work[index] - shoulder) >= prominence_floor:
                candidates.append(index)

        if len(candidates) < 4:
            return None, None

        gaps = np.diff(np.asarray(candidates, dtype=np.float64))
        gaps = gaps[(gaps >= min_period * 0.80) & (gaps <= max_period * 1.20)]
        if len(gaps) < 3:
            return None, None
        median = float(np.median(gaps))
        mad = float(np.median(np.abs(gaps - median)))
        if median <= 0:
            return None, None
        relative_mad = mad / median
        if relative_mad > 0.20:
            return None, None
        score = max(0.0, min(1.0, 1.0 - relative_mad * 3.0))
        return median, score

    peak_period, peak_score = spacing_for(1.0)
    trough_period, trough_score = spacing_for(-1.0)
    available = [
        (period, score)
        for period, score in ((peak_period, peak_score), (trough_period, trough_score))
        if period is not None and score is not None
    ]
    if not available:
        return None, None
    return max(available, key=lambda item: item[1])


def _relative_delta(a: float, b: float) -> float:
    return abs(a - b) / max(abs(a), abs(b), 1e-9)


def _matches_integer_multiple(value: float, fundamental: float, tolerance: float = 0.12) -> bool:
    ratio = value / max(fundamental, 1e-9)
    multiple = max(1, int(round(ratio)))
    if multiple > 4:
        return False
    return abs(ratio - multiple) / multiple <= tolerance


def _resolve_fundamental_period(
    values: np.ndarray,
    min_period: int,
    max_period: int,
) -> tuple[
    float | None,
    float | None,
    float | None,
    float | None,
    float | None,
]:
    """Fuse autocorrelation, FFT and extrema spacing into one fundamental pitch."""
    autocorrelation, autocorrelation_score = _autocorrelation_period(values, min_period, max_period)
    frequency, frequency_score = _frequency_period(values, min_period, max_period)
    peak_spacing, peak_score = _peak_spacing_period(values, min_period, max_period)

    anchors = [
        (period, score)
        for period, score in ((frequency, frequency_score), (peak_spacing, peak_score))
        if period is not None and score is not None
    ]
    if not anchors:
        return None, None, autocorrelation, frequency, peak_spacing

    if len(anchors) == 2:
        first, second = anchors
        if _relative_delta(first[0], second[0]) > 0.15:
            return None, None, autocorrelation, frequency, peak_spacing
        # Peak spacing directly measures neighboring visible teeth, so once the
        # frequency estimate independently confirms it, keep that physical
        # spacing instead of averaging the two estimates into a fractional drift.
        if peak_spacing is not None and peak_score is not None:
            fundamental = float(peak_spacing)
        else:
            fundamental = float(first[0])
        support_score = float(np.mean([first[1], second[1]]))
    else:
        fundamental, support_score = anchors[0]

    if autocorrelation is not None:
        if not _matches_integer_multiple(autocorrelation, fundamental):
            return None, None, autocorrelation, frequency, peak_spacing
        support_score = min(1.0, 0.75 * support_score + 0.25 * max(autocorrelation_score or 0.0, 0.0))

    if fundamental < min_period * 0.90 or fundamental > max_period * 1.10:
        return None, None, autocorrelation, frequency, peak_spacing
    return float(fundamental), float(support_score), autocorrelation, frequency, peak_spacing


def measure_periodicity_px(
    profile: ThreadedShankProfile,
    outer_width_px: float,
) -> PeriodicityEstimate:
    """Estimate the fundamental thread pitch from contour periodicity.

    Each visible side fuses autocorrelation, spatial frequency and neighboring
    extrema spacing. Matching sides are accepted directly. If one side is
    harmonic/noisy, a conservative fallback requires the total shank-width
    signal to confirm the fundamental and the opposite-side evidence to be an
    integer multiple. Otherwise the measurement is rejected.
    """
    low = profile.low[profile.sample_mask]
    high = profile.high[profile.sample_mask]
    count = len(low)

    # Pitch is an independent observable.  Use the robust local shank width
    # only as a broad image-scale prior; do not let the final major-diameter
    # estimator change the periodicity search window.
    width_scale_values = profile.widths[profile.sample_mask]
    width_scale_values = width_scale_values[np.isfinite(width_scale_values)]
    if len(width_scale_values) < 12:
        return PeriodicityEstimate(
            None,
            None,
            None,
            None,
            None,
            "threaded_shank_too_short_for_periodicity",
        )
    shank_scale_px = float(np.percentile(width_scale_values, 50))
    min_period = max(3, int(round(shank_scale_px * 0.06)))
    max_period = min(
        max(min_period + 3, int(round(shank_scale_px * 0.75))),
        max(min_period + 3, count // 3),
    )
    if count < max(36, min_period * 5):
        return PeriodicityEstimate(
            None,
            None,
            None,
            None,
            None,
            "threaded_shank_too_short_for_periodicity",
        )

    (
        left_pitch,
        left_score,
        left_autocorrelation,
        left_frequency,
        left_peak_spacing,
    ) = _resolve_fundamental_period(low, min_period, max_period)
    (
        right_pitch,
        right_score,
        right_autocorrelation,
        right_frequency,
        right_peak_spacing,
    ) = _resolve_fundamental_period(high, min_period, max_period)

    width_values = (profile.high - profile.low)[profile.sample_mask]
    (
        width_pitch,
        width_score,
        width_autocorrelation,
        width_frequency,
        width_peak_spacing,
    ) = _resolve_fundamental_period(width_values, min_period, max_period)

    pitch: float | None = None
    if left_pitch is not None and right_pitch is not None:
        relative_delta = abs(left_pitch - right_pitch) / max(left_pitch, right_pitch)
        if relative_delta <= 0.05:
            pitch = (left_pitch + right_pitch) * 0.5

    # Conservative harmonic fallback for real contours: accept one side's
    # fundamental only when the total shank-width signal independently agrees
    # and the opposite side's raw autocorrelation is an integer multiple of it.
    # This resolves 2P/3P ambiguity without reducing the measurement to a
    # single-side guess.
    if pitch is None and width_pitch is not None:
        side_candidates = [
            (left_pitch, left_score, right_pitch, right_autocorrelation),
            (right_pitch, right_score, left_pitch, left_autocorrelation),
        ]
        accepted: list[tuple[float, float]] = []
        for side_pitch, side_score, opposite_pitch, opposite_autocorrelation in side_candidates:
            if side_pitch is None or side_score is None:
                continue
            if _relative_delta(side_pitch, width_pitch) > 0.08:
                continue
            opposite_evidence = opposite_autocorrelation
            if opposite_evidence is None:
                opposite_evidence = opposite_pitch
            if opposite_evidence is None or not _matches_integer_multiple(opposite_evidence, side_pitch):
                continue
            if opposite_pitch is not None and not (
                _relative_delta(opposite_pitch, side_pitch) <= 0.05
                or _matches_integer_multiple(opposite_pitch, side_pitch)
            ):
                continue
            accepted.append((float(side_pitch), float(side_score)))
        if accepted:
            pitch = max(accepted, key=lambda item: item[1])[0]

    if pitch is None:
        reason = (
            "periodicity_signal_weak"
            if left_pitch is None or right_pitch is None
            else "periodicity_methods_disagree"
        )
        return PeriodicityEstimate(
            None,
            left_pitch,
            right_pitch,
            left_score,
            right_score,
            reason,
            left_autocorrelation,
            right_autocorrelation,
            left_frequency,
            right_frequency,
            left_peak_spacing,
            right_peak_spacing,
            width_pitch,
            width_score,
            width_autocorrelation,
            width_frequency,
            width_peak_spacing,
        )
    if count / pitch < 4.0:
        return PeriodicityEstimate(
            None,
            left_pitch,
            right_pitch,
            left_score,
            right_score,
            "periodicity_cycles_insufficient",
            left_autocorrelation,
            right_autocorrelation,
            left_frequency,
            right_frequency,
            left_peak_spacing,
            right_peak_spacing,
            width_pitch,
            width_score,
            width_autocorrelation,
            width_frequency,
            width_peak_spacing,
        )

    return PeriodicityEstimate(
        float(pitch),
        left_pitch,
        right_pitch,
        left_score,
        right_score,
        None,
        left_autocorrelation,
        right_autocorrelation,
        left_frequency,
        right_frequency,
        left_peak_spacing,
        right_peak_spacing,
        width_pitch,
        width_score,
        width_autocorrelation,
        width_frequency,
        width_peak_spacing,
    )
