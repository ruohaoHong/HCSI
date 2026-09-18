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


def measure_outer_width_px(profile: ThreadedShankProfile) -> float | None:
    """Return a robust major/outer diameter estimate for the shank envelope."""
    values = profile.widths[profile.sample_mask]
    values = values[np.isfinite(values)]
    if len(values) < 12:
        return None

    median = float(np.percentile(values, 50))
    outer = float(np.percentile(values, 90))
    high = float(np.percentile(values, 98))
    if median <= 1.0 or high / median > 1.35:
        return None
    return outer


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
        weights = np.asarray([max(first[1], 0.05), max(second[1], 0.05)], dtype=np.float64)
        fundamental = float(np.average([first[0], second[0]], weights=weights))
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
    """Estimate thread pitch independently from both visible side envelopes.

    The two side-envelope autocorrelation estimates must agree within 5%.
    Otherwise the measurement is rejected rather than averaged into a false
    pitch. This gives periodicity its own failure mode independent of D and L.
    """
    low = profile.low[profile.sample_mask]
    high = profile.high[profile.sample_mask]
    count = len(low)

    min_period = max(3, int(round(outer_width_px * 0.06)))
    max_period = min(
        max(min_period + 3, int(round(outer_width_px * 0.75))),
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

    if left_pitch is None or right_pitch is None:
        return PeriodicityEstimate(
            None,
            left_pitch,
            right_pitch,
            left_score,
            right_score,
            "periodicity_signal_weak",
            left_autocorrelation,
            right_autocorrelation,
            left_frequency,
            right_frequency,
            left_peak_spacing,
            right_peak_spacing,
        )

    relative_delta = abs(left_pitch - right_pitch) / max(left_pitch, right_pitch)
    if relative_delta > 0.05:
        return PeriodicityEstimate(
            None,
            left_pitch,
            right_pitch,
            left_score,
            right_score,
            "periodicity_methods_disagree",
            left_autocorrelation,
            right_autocorrelation,
            left_frequency,
            right_frequency,
            left_peak_spacing,
            right_peak_spacing,
        )

    pitch = (left_pitch + right_pitch) * 0.5
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
    )
