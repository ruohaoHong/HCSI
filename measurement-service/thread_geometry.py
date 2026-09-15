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

    left_pitch, left_score = _autocorrelation_period(low, min_period, max_period)
    right_pitch, right_score = _autocorrelation_period(high, min_period, max_period)
    if left_pitch is None or right_pitch is None:
        return PeriodicityEstimate(
            None,
            left_pitch,
            right_pitch,
            left_score,
            right_score,
            "periodicity_signal_weak",
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
        )

    return PeriodicityEstimate(
        float(pitch),
        left_pitch,
        right_pitch,
        left_score,
        right_score,
        None,
    )
