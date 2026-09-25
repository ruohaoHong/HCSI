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
    s: float
    shank_outer_px: float
    stable_limit_px: float
    expansion_threshold_px: float
    persistence_px: int


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
    selected_side: str | None = None
    selection_mode: str | None = None
    negative_normal_quality: float | None = None
    positive_normal_quality: float | None = None
    negative_normal_valid_fraction: float | None = None
    positive_normal_valid_fraction: float | None = None
    negative_normal_edge_spread_px: float | None = None
    positive_normal_edge_spread_px: float | None = None
    negative_normal_uncertainty_px: float | None = None
    positive_normal_uncertainty_px: float | None = None
    negative_normal_crest_count: int = 0
    positive_normal_crest_count: int = 0
    negative_normal_crest_continuity: float | None = None
    positive_normal_crest_continuity: float | None = None
    negative_normal_reason: str | None = None
    positive_normal_reason: str | None = None
    selected_crest_count: int = 0
    selected_crest_spacing_px: float | None = None


@dataclass(frozen=True)
class _SidePeriodicityEvidence:
    pitch_px: float | None
    score: float | None
    autocorrelation_px: float | None
    frequency_px: float | None
    peak_spacing_px: float | None
    crest_spacing_px: float | None
    valid_fraction: float
    median_edge_spread_px: float | None
    median_uncertainty_px: float | None
    crest_count: int
    crest_continuity: float | None
    quality_score: float
    reliable: bool
    reason: str | None


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


def detect_threaded_shank(contour: np.ndarray) -> ThreadedShankProfile | None:
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


def estimate_head_underface(profile: ThreadedShankProfile) -> HeadUnderfaceEstimate | None:
    """Locate the physical bearing plane for a protruding fastener head.

    Length semantics are defined by the load-bearing underside of the head, not
    by the first place the shank begins to widen. Real fasteners commonly have
    a thread runout, neck or fillet before that plane. Those gradual transitions
    must not shorten L.

    Starting from the stable threaded shank and walking toward the head, first
    detect the earliest bilateral shoulder that establishes head ownership.
    Then continue only through that projected shoulder until its outward growth
    settles. The settled point is the image-space proxy for the bearing plane.
    This keeps runout/fillet pixels out of L without letting a later internal
    chamfer or dome transition steal the landmark.
    """
    outer = measure_outer_width_px(profile)
    if outer is None or outer <= 1.0:
        return None

    sample_indices = np.flatnonzero(profile.sample_mask)
    if len(sample_indices) < 12:
        return None

    toward_head = 1 if profile.transition_s > profile.tip_s else -1
    shank_edge_index = int(sample_indices[-1] if toward_head > 0 else sample_indices[0])
    head_edge_index = len(profile.widths) - 1 if toward_head > 0 else 0
    ordered = np.arange(
        shank_edge_index,
        head_edge_index + toward_head,
        toward_head,
        dtype=np.int32,
    )
    if len(ordered) < 8:
        return None

    # Keep smoothing narrow. L is sensitive to only a few pixels, so a broad
    # width filter can move the inferred plane enough to create a systematic
    # short-length bias.
    smooth_width = _median_smooth(profile.widths, fraction=0.008)
    smooth_low = _median_smooth(profile.low, fraction=0.008)
    smooth_high = _median_smooth(profile.high, fraction=0.008)

    stable_limit = max(outer * 1.08, outer + 2.0)
    expansion_threshold = max(outer * 1.30, outer + 6.0)
    persistence = int(np.clip(round(outer * 0.10), 5, 24))
    probe = int(np.clip(round(outer * 0.04), 2, 8))
    min_step = max(3.0, outer * 0.12)
    pre_head_limit = max(outer * 1.45, stable_limit + min_step * 1.5)

    minimum_span = max(persistence + probe + 2, probe * 2 + 3)
    if len(ordered) < minimum_span:
        return None

    candidate: tuple[int, float, float] | None = None
    max_pos = len(ordered) - max(probe, persistence)
    for pos in range(probe, max_pos + 1):
        before_indices = ordered[pos - probe : pos]
        after_indices = ordered[pos : pos + probe]
        persistence_indices = ordered[pos : pos + persistence]

        before_width = smooth_width[before_indices]
        after_width = smooth_width[after_indices]
        persistent_width = smooth_width[persistence_indices]
        if not (
            np.all(np.isfinite(before_width))
            and np.all(np.isfinite(after_width))
            and np.all(np.isfinite(persistent_width))
        ):
            continue

        pre_width = float(np.median(before_width))
        post_width = float(np.median(after_width))
        step = post_width - pre_width

        # Internal head geometry can contain an even stronger transition. It is
        # not the bearing plane if the profile is already clearly head-sized.
        if pre_width > pre_head_limit:
            continue
        if step < min_step or post_width < expansion_threshold:
            continue
        if (
            float(np.median(persistent_width)) < expansion_threshold
            or float(np.mean(persistent_width >= expansion_threshold)) < 0.75
        ):
            continue

        pre_low = float(np.median(smooth_low[before_indices]))
        post_low = float(np.median(smooth_low[after_indices]))
        pre_high = float(np.median(smooth_high[before_indices]))
        post_high = float(np.median(smooth_high[after_indices]))
        low_outward = pre_low - post_low
        high_outward = post_high - pre_high
        minimum_side = max(1.0, step * 0.15)

        # A physical head shoulder expands both silhouette sides. Requiring
        # bilateral support prevents a one-sided shadow or contour spur from
        # becoming the L anchor.
        if low_outward < minimum_side or high_outward < minimum_side:
            continue

        candidate = (pos, pre_width, post_width)
        break

    if candidate is None:
        return None

    candidate_pos, pre_width, post_width = candidate

    # A real bearing face can project as a finite-width shoulder when the
    # camera is not perfectly side-on. Anchoring L to the first outward pixel
    # therefore biases length short (Case D). Walk only far enough to find the
    # first head-sized region whose silhouette expansion has settled.
    settle_window = int(np.clip(round(outer * 0.06), 4, 12))
    max_settle_span = int(np.clip(round(outer * 0.60), 24, 60))
    settle_slope_limit = max(1.0, outer * 0.025)

    settled_pos: int | None = None
    last_settle_pos = min(
        len(ordered) - settle_window - 1,
        candidate_pos + max_settle_span,
    )
    for pos in range(candidate_pos, last_settle_pos + 1):
        settle_indices = ordered[pos : pos + settle_window + 1]
        settle_width = smooth_width[settle_indices]
        if not np.all(np.isfinite(settle_width)):
            continue
        if float(np.mean(settle_width >= expansion_threshold)) < 0.80:
            continue

        # Only outward growth matters here. A small local contraction after the
        # shoulder is compatible with a rounded head, but another outward jump
        # means the bearing shoulder has not finished yet.
        outward_slopes = np.maximum(np.diff(settle_width), 0.0)
        if len(outward_slopes) == 0:
            continue
        if float(np.max(outward_slopes)) <= settle_slope_limit:
            settled_pos = pos
            break

    # If the first owned head region never settles before another head feature,
    # the image does not expose a defensible bearing plane. Fail closed rather
    # than reverting to the known-short first-widening heuristic.
    if settled_pos is None:
        return None

    boundary_index = int(ordered[settled_pos])
    underface_s = float(profile.s_values[boundary_index])

    head_top_s = float(profile.s_values[-1] if toward_head > 0 else profile.s_values[0])
    if abs(head_top_s - underface_s) < max(3.0, persistence * 0.5):
        return None
    if abs(underface_s - profile.tip_s) < 12.0:
        return None

    return HeadUnderfaceEstimate(
        s=underface_s,
        shank_outer_px=float(outer),
        stable_limit_px=float(stable_limit),
        expansion_threshold_px=float(expansion_threshold),
        persistence_px=persistence,
    )

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


def _crest_continuity_evidence(
    values: np.ndarray,
    pitch_px: float | None,
    min_period: int,
    max_period: int,
) -> tuple[int, float | None, float | None]:
    """Count consecutive outward crests and quantify their spacing continuity."""
    signal = _detrended_envelope(values, max_period)
    if len(signal) < max_period + 8 or float(np.std(signal)) < 0.35:
        return 0, None, None
    prominence_floor = max(0.30 * float(np.std(signal)), 0.18)
    crests: list[int] = []
    for index in range(1, len(signal) - 1):
        if signal[index] < signal[index - 1] or signal[index] < signal[index + 1]:
            continue
        left = max(0, index - max_period)
        right = min(len(signal), index + max_period + 1)
        shoulder = max(
            float(np.min(signal[left:index])) if index > left else float(signal[index]),
            float(np.min(signal[index + 1:right])) if right > index + 1 else float(signal[index]),
        )
        if float(signal[index] - shoulder) >= prominence_floor:
            crests.append(index)
    if len(crests) < 2:
        return len(crests), None, None

    gaps = np.diff(np.asarray(crests, dtype=np.float64))
    reference = pitch_px
    if reference is None:
        legal = gaps[(gaps >= min_period * 0.80) & (gaps <= max_period * 1.20)]
        reference = float(np.median(legal)) if len(legal) else None
    if reference is None or reference <= 0:
        return len(crests), None, None
    inlier = np.abs(gaps - reference) <= max(1.0, reference * 0.20)
    inlier_gaps = gaps[inlier]
    if not len(inlier_gaps):
        return len(crests), 0.0, None
    spacing = float(np.median(inlier_gaps))
    relative_mad = float(np.median(np.abs(inlier_gaps - spacing))) / max(spacing, 1e-9)
    gap_support = float(np.count_nonzero(inlier)) / max(len(gaps), 1)
    consistency = max(0.0, 1.0 - relative_mad / 0.20)
    continuity = float(np.clip(gap_support * consistency, 0.0, 1.0))
    # Only crests joined by an inlier neighboring gap count as the continuous
    # train. Isolated optical spikes do not increase the support count.
    supported_crests = min(len(crests), int(np.count_nonzero(inlier)) + 1)
    return supported_crests, continuity, spacing


def _best_observed_span(valid: np.ndarray, maximum_gap: int = 2) -> tuple[int, int] | None:
    indices = np.flatnonzero(valid)
    if not len(indices):
        return None
    splits = np.flatnonzero(np.diff(indices) > maximum_gap + 1) + 1
    runs = np.split(indices, splits)
    run = max(runs, key=lambda part: int(part[-1] - part[0] + 1))
    start, end = int(run[0]), int(run[-1]) + 1
    if np.count_nonzero(valid[start:end]) < 0.72 * (end - start):
        return None
    return start, end


def _periodicity_from_edge_track(
    track,
    min_period: int,
    max_period: int,
) -> _SidePeriodicityEvidence:
    count = len(track.s_px)
    finite_edge = np.isfinite(track.outward_px)
    observed = np.asarray(track.valid, dtype=bool) & finite_edge
    valid_fraction = float(np.mean(observed)) if count else 0.0

    def median(values: np.ndarray) -> float | None:
        data = np.asarray(values, dtype=np.float64)
        use = observed & np.isfinite(data) if len(data) == count else np.zeros(count, dtype=bool)
        return float(np.median(data[use])) if np.any(use) else None

    spread = median(track.blur_10_90_px)
    uncertainty = median(track.uncertainty_px)
    residual = median(track.relative_residual)
    contrast = median(track.contrast)
    quality_valid = observed.copy()
    if len(track.blur_10_90_px) == count:
        quality_valid &= np.isfinite(track.blur_10_90_px) & (track.blur_10_90_px <= 12.0)
    if len(track.uncertainty_px) == count:
        quality_valid &= np.isfinite(track.uncertainty_px) & (track.uncertainty_px <= 2.0)
    if len(track.relative_residual) == count:
        quality_valid &= np.isfinite(track.relative_residual) & (track.relative_residual <= 0.30)
    if len(track.contrast) == count:
        quality_valid &= np.isfinite(track.contrast) & (track.contrast >= 20.0)

    span = _best_observed_span(quality_valid)
    if span is None:
        return _SidePeriodicityEvidence(
            None, None, None, None, None, None,
            valid_fraction, spread, uncertainty,
            0, None, 0.0, False, "continuous_edge_support_insufficient",
        )
    start, end = span
    if end - start < max(36, min_period * 5):
        return _SidePeriodicityEvidence(
            None, None, None, None, None, None,
            valid_fraction, spread, uncertainty,
            0, None, 0.0, False, "continuous_edge_support_insufficient",
        )
    span_valid = quality_valid[start:end]
    span_values = np.asarray(track.outward_px[start:end], dtype=np.float64)
    local = np.arange(len(span_values), dtype=np.float64)
    usable = np.flatnonzero(span_valid)
    values = np.interp(local, local[usable], span_values[usable])
    pitch, score, autocorrelation, frequency, peak_spacing = _resolve_fundamental_period(
        values, min_period, max_period,
    )
    crest_count, crest_continuity, crest_spacing = _crest_continuity_evidence(
        values, pitch, min_period, max_period,
    )

    reason: str | None = None
    if pitch is None:
        reason = (
            "periodicity_methods_disagree"
            if frequency is not None or peak_spacing is not None
            else "periodicity_signal_weak"
        )
    elif valid_fraction < 0.55:
        reason = "valid_observation_fraction_low"
    elif spread is None or spread > max(3.5, 0.55 * pitch):
        reason = "edge_spread_too_wide"
    elif uncertainty is None or uncertainty > max(0.80, 0.12 * pitch):
        reason = "edge_uncertainty_high"
    elif residual is None or residual > 0.20:
        reason = "edge_fit_residual_high"
    elif contrast is None or contrast < 28.0:
        reason = "edge_contrast_low"
    elif frequency is None or peak_spacing is None:
        reason = "independent_period_evidence_insufficient"
    elif _relative_delta(frequency, peak_spacing) > 0.12:
        reason = "periodicity_methods_disagree"
    elif crest_count < 5:
        reason = "continuous_crest_count_insufficient"
    elif crest_continuity is None or crest_continuity < 0.50:
        reason = "crest_spacing_discontinuous"
    elif len(values) / pitch < 4.0:
        reason = "periodicity_cycles_insufficient"

    spread_score = (
        min(1.0, max(3.5, 0.55 * pitch) / max(spread, 1e-6))
        if pitch is not None and spread is not None else 0.0
    )
    uncertainty_score = (
        min(1.0, max(0.80, 0.12 * pitch) / max(uncertainty, 1e-6))
        if pitch is not None and uncertainty is not None else 0.0
    )
    quality_score = float(np.mean([
        min(1.0, valid_fraction / 0.80),
        spread_score,
        uncertainty_score,
        crest_continuity or 0.0,
        min(1.0, crest_count / 7.0),
        score or 0.0,
    ]))
    reliable = reason is None and quality_score >= 0.65
    if reason is None and not reliable:
        reason = "edge_quality_score_low"
    return _SidePeriodicityEvidence(
        pitch, score, autocorrelation, frequency, peak_spacing, crest_spacing,
        valid_fraction, spread, uncertainty, crest_count, crest_continuity,
        quality_score, reliable, reason,
    )


def _measure_edge_track_periodicity(
    profile: ThreadedShankProfile,
    edge_tracks: tuple[object, object],
    min_period: int,
    max_period: int,
) -> PeriodicityEstimate:
    positive_track, negative_track = edge_tracks
    negative = _periodicity_from_edge_track(negative_track, min_period, max_period)
    positive = _periodicity_from_edge_track(positive_track, min_period, max_period)

    width_values = (profile.high - profile.low)[profile.sample_mask]
    (
        width_pitch, width_score, width_autocorrelation,
        width_frequency, width_peak_spacing,
    ) = _resolve_fundamental_period(width_values, min_period, max_period)

    pitch: float | None = None
    selected_side: str | None = None
    selection_mode: str | None = None
    selected_crest_count = 0
    selected_crest_spacing: float | None = None
    reason: str | None = None
    reliable = [
        ("negative_normal", negative),
        ("positive_normal", positive),
    ]
    reliable = [(name, evidence) for name, evidence in reliable if evidence.reliable]
    if len(reliable) == 2:
        first, second = reliable
        assert first[1].pitch_px is not None and second[1].pitch_px is not None
        if _relative_delta(first[1].pitch_px, second[1].pitch_px) <= 0.05:
            total_quality = first[1].quality_score + second[1].quality_score
            pitch = float(
                (first[1].pitch_px * first[1].quality_score
                 + second[1].pitch_px * second[1].quality_score)
                / max(total_quality, 1e-9)
            )
            selected_side = "bilateral"
            selection_mode = "quality_weighted_bilateral"
            selected_crest_count = first[1].crest_count + second[1].crest_count
            spacings = [
                value for value in (
                    first[1].crest_spacing_px, second[1].crest_spacing_px,
                ) if value is not None
            ]
            selected_crest_spacing = float(np.mean(spacings)) if spacings else None
        else:
            harmonic = (
                _matches_integer_multiple(first[1].pitch_px, second[1].pitch_px)
                or _matches_integer_multiple(second[1].pitch_px, first[1].pitch_px)
            )
            reason = (
                "periodicity_harmonic_ambiguous"
                if harmonic else "periodicity_methods_disagree"
            )
    elif len(reliable) == 1:
        selected_side, evidence = reliable[0]
        pitch = evidence.pitch_px
        selection_mode = "quality_gated_single_side"
        selected_crest_count = evidence.crest_count
        selected_crest_spacing = evidence.crest_spacing_px
    else:
        reason = (
            "periodicity_edge_quality_insufficient"
            if negative.pitch_px is not None or positive.pitch_px is not None
            else "periodicity_signal_weak"
        )

    if pitch is not None and len(profile.s_values[profile.sample_mask]) / pitch < 4.0:
        pitch = None
        selected_side = None
        selection_mode = None
        reason = "periodicity_cycles_insufficient"

    return PeriodicityEstimate(
        pitch_px=pitch,
        left_pitch_px=negative.pitch_px,
        right_pitch_px=positive.pitch_px,
        left_score=negative.score,
        right_score=positive.score,
        reason_code=reason,
        left_autocorrelation_px=negative.autocorrelation_px,
        right_autocorrelation_px=positive.autocorrelation_px,
        left_frequency_px=negative.frequency_px,
        right_frequency_px=positive.frequency_px,
        left_peak_spacing_px=negative.peak_spacing_px,
        right_peak_spacing_px=positive.peak_spacing_px,
        width_pitch_px=width_pitch,
        width_score=width_score,
        width_autocorrelation_px=width_autocorrelation,
        width_frequency_px=width_frequency,
        width_peak_spacing_px=width_peak_spacing,
        selected_side=selected_side,
        selection_mode=selection_mode,
        negative_normal_quality=negative.quality_score,
        positive_normal_quality=positive.quality_score,
        negative_normal_valid_fraction=negative.valid_fraction,
        positive_normal_valid_fraction=positive.valid_fraction,
        negative_normal_edge_spread_px=negative.median_edge_spread_px,
        positive_normal_edge_spread_px=positive.median_edge_spread_px,
        negative_normal_uncertainty_px=negative.median_uncertainty_px,
        positive_normal_uncertainty_px=positive.median_uncertainty_px,
        negative_normal_crest_count=negative.crest_count,
        positive_normal_crest_count=positive.crest_count,
        negative_normal_crest_continuity=negative.crest_continuity,
        positive_normal_crest_continuity=positive.crest_continuity,
        negative_normal_reason=negative.reason,
        positive_normal_reason=positive.reason,
        selected_crest_count=selected_crest_count,
        selected_crest_spacing_px=selected_crest_spacing,
    )


def measure_periodicity_px(
    profile: ThreadedShankProfile,
    outer_width_px: float,
    edge_tracks: tuple[object, object] | None = None,
) -> PeriodicityEstimate:
    """Estimate fundamental thread pitch, preferring raw-image edge tracks.

    With edge tracks, each side must independently pass optical-quality,
    continuous-crest, frequency, and neighboring-spacing gates. One reliable
    side may supply P; two reliable but incompatible sides remain ambiguous.
    Calls without tracks retain the legacy contour resolver for compatibility.
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

    if edge_tracks is not None:
        return _measure_edge_track_periodicity(
            profile, edge_tracks, min_period, max_period,
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
