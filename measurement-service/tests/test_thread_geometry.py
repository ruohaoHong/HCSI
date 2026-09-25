import pathlib
import sys
from dataclasses import replace

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from thread_geometry import (  # noqa: E402
    _autocorrelation_period,
    _resolve_fundamental_period,
    detect_threaded_shank,
    measure_outer_width_px,
    measure_periodicity_px,
)
from edge_observation import EdgeTrack  # noqa: E402


def _threaded_bolt(period_px: float = 20.0, outer_radius_px: float = 16.0):
    image = np.full((520, 820, 3), 245, dtype=np.uint8)
    cv2.rectangle(image, (220, 290), (270, 410), (25, 25, 25), -1)

    xs = np.arange(270, 561)
    radius = (outer_radius_px - 2.0) + 2.0 * np.cos(2.0 * np.pi * (xs - 270) / period_px)
    top = np.column_stack([xs, 350.0 - radius]).astype(np.int32)
    bottom = np.column_stack([xs[::-1], (350.0 + radius)[::-1]]).astype(np.int32)
    cv2.fillPoly(image, [np.vstack([top, bottom])], (25, 25, 25))

    mask = (image[:, :, 0] < 100).astype(np.uint8) * 255
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contour = max(contours, key=cv2.contourArea)
    return contour


def _quality_track(
    s: np.ndarray,
    values: np.ndarray,
    *,
    blur_px: float = 3.0,
    uncertainty_px: float = 0.25,
    valid: np.ndarray | None = None,
) -> EdgeTrack:
    if valid is None:
        valid = np.ones(len(s), dtype=bool)
    return EdgeTrack(
        s_px=s,
        outward_px=np.asarray(values, dtype=np.float64),
        uncertainty_px=np.full(len(s), uncertainty_px, dtype=np.float64),
        contrast=np.full(len(s), 110.0, dtype=np.float64),
        blur_10_90_px=np.full(len(s), blur_px, dtype=np.float64),
        relative_residual=np.full(len(s), 0.04, dtype=np.float64),
        valid=np.asarray(valid, dtype=bool),
        gradient_strength=np.full(len(s), 24.0, dtype=np.float64),
    )


def _wide_profile_for_periodicity():
    profile = detect_threaded_shank(_threaded_bolt(period_px=16.0))
    assert profile is not None
    s = profile.s_values
    low = -40.0 - 2.0 * np.cos(2.0 * np.pi * s / 16.0)
    high = 40.0 + 2.0 * np.cos(2.0 * np.pi * s / 16.0 + 0.4)
    return replace(profile, low=low, high=high, widths=high - low)


def test_detects_threaded_shank_and_outer_width():
    contour = _threaded_bolt()
    profile = detect_threaded_shank(contour)
    assert profile is not None

    width = measure_outer_width_px(profile)
    assert width is not None
    assert 29.0 <= width <= 33.0
    assert profile.start_xy[0] > 270.0
    assert profile.end_xy[0] < 560.0


def test_periodicity_requires_two_side_envelopes_to_agree():
    contour = _threaded_bolt(period_px=20.0)
    profile = detect_threaded_shank(contour)
    assert profile is not None
    width = measure_outer_width_px(profile)
    assert width is not None

    estimate = measure_periodicity_px(profile, width)

    assert estimate.reason_code is None, estimate
    assert estimate.pitch_px is not None
    assert 19.0 <= estimate.pitch_px <= 21.0
    assert estimate.left_pitch_px is not None
    assert estimate.right_pitch_px is not None
    assert abs(estimate.left_pitch_px - estimate.right_pitch_px) / estimate.pitch_px <= 0.05
    assert estimate.left_score is not None and estimate.left_score > 0.5
    assert estimate.right_score is not None and estimate.right_score > 0.5


def test_frequency_and_peak_spacing_resolve_autocorrelation_harmonic():
    # Alternating tooth amplitude makes 2P correlate much more strongly than P:
    # this recreates the real-photo failure mode where autocorrelation alone
    # reports 32 px although the actual neighboring-tooth pitch is 16 px.
    x = np.arange(320, dtype=np.float64)
    period = 16.0
    alternating = 1.0 + 2.0 * ((x // period).astype(np.int32) % 2)
    signal = alternating * np.cos(2.0 * np.pi * x / period)

    autocorrelation, _ = _autocorrelation_period(signal, 5, 60)
    resolved, score, raw_autocorrelation, frequency, peak_spacing = _resolve_fundamental_period(
        signal,
        5,
        60,
    )

    assert autocorrelation is not None
    assert 31.0 <= autocorrelation <= 33.0
    assert raw_autocorrelation == autocorrelation
    assert resolved is not None
    assert 15.0 <= resolved <= 17.0
    assert frequency is not None and 15.0 <= frequency <= 17.0
    assert peak_spacing is not None and 15.0 <= peak_spacing <= 17.0
    assert score is not None and score > 0.5


def test_width_signal_confirms_one_side_when_other_side_is_harmonic():
    contour = _threaded_bolt(period_px=16.0)
    profile = detect_threaded_shank(contour)
    assert profile is not None

    s = profile.s_values
    low = -40.0 - 2.0 * np.cos(2.0 * np.pi * s / 16.0)
    high = 40.0 + 0.7 * np.cos(2.0 * np.pi * s / 48.0)
    profile = replace(profile, low=low, high=high, widths=high - low)

    # A larger shank makes 3P=48 px a legal harmonic candidate, matching the
    # real-photo scale where D is about 120 px and the noisy side reported 49 px.
    estimate = measure_periodicity_px(profile, 80.0)

    assert estimate.reason_code is None, estimate
    assert estimate.pitch_px is not None
    assert 15.0 <= estimate.pitch_px <= 17.0
    assert estimate.left_pitch_px is not None and 15.0 <= estimate.left_pitch_px <= 17.0
    assert estimate.right_pitch_px is not None and 47.0 <= estimate.right_pitch_px <= 49.0
    assert estimate.width_pitch_px is not None and 15.0 <= estimate.width_pitch_px <= 17.0


def test_smooth_shank_does_not_invent_thread_pitch():
    image = np.full((520, 820, 3), 245, dtype=np.uint8)
    cv2.rectangle(image, (220, 290), (270, 410), (25, 25, 25), -1)
    cv2.rectangle(image, (270, 334), (560, 366), (25, 25, 25), -1)
    mask = (image[:, :, 0] < 100).astype(np.uint8) * 255
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    profile = detect_threaded_shank(max(contours, key=cv2.contourArea))
    assert profile is not None
    width = measure_outer_width_px(profile)
    assert width is not None

    estimate = measure_periodicity_px(profile, width)

    assert estimate.pitch_px is None
    assert estimate.reason_code == "periodicity_signal_weak"


def test_single_clear_edge_track_survives_blurred_opposite_side():
    profile = _wide_profile_for_periodicity()
    s = profile.s_values[profile.sample_mask]
    negative = _quality_track(s, 40.0 + 2.0 * np.cos(2.0 * np.pi * s / 16.0))
    positive = _quality_track(
        s,
        40.0 + 2.0 * np.cos(2.0 * np.pi * s / 48.0),
        blur_px=8.0,
        uncertainty_px=0.9,
    )

    estimate = measure_periodicity_px(
        profile, 80.0, edge_tracks=(positive, negative),
    )

    assert estimate.reason_code is None, estimate
    assert estimate.pitch_px is not None and 15.0 <= estimate.pitch_px <= 17.0
    assert estimate.selected_side == "negative_normal"
    assert estimate.selection_mode == "quality_gated_single_side"
    assert estimate.negative_normal_crest_count >= 5
    assert estimate.positive_normal_reason is not None


def test_two_clear_edge_tracks_produce_bilateral_pitch_evidence():
    profile = _wide_profile_for_periodicity()
    s = profile.s_values[profile.sample_mask]
    negative = _quality_track(s, 40.0 + 2.0 * np.cos(2.0 * np.pi * s / 16.0))
    positive = _quality_track(
        s, 40.0 + 2.0 * np.cos(2.0 * np.pi * s / 16.0 + 0.7),
    )

    estimate = measure_periodicity_px(
        profile, 80.0, edge_tracks=(positive, negative),
    )

    assert estimate.reason_code is None, estimate
    assert estimate.pitch_px is not None and 15.0 <= estimate.pitch_px <= 17.0
    assert estimate.selected_side == "bilateral"
    assert estimate.selection_mode == "quality_weighted_bilateral"
    assert estimate.selected_crest_count >= 10


def test_two_unreliable_edge_tracks_refuse_pitch():
    profile = _wide_profile_for_periodicity()
    s = profile.s_values[profile.sample_mask]
    sparse = np.zeros(len(s), dtype=bool)
    sparse[::4] = True
    negative = _quality_track(
        s, 40.0 + 2.0 * np.cos(2.0 * np.pi * s / 16.0),
        blur_px=9.0, uncertainty_px=1.4, valid=sparse,
    )
    positive = _quality_track(
        s, 40.0 + 2.0 * np.cos(2.0 * np.pi * s / 16.0 + 0.5),
        blur_px=9.0, uncertainty_px=1.4, valid=sparse,
    )

    estimate = measure_periodicity_px(
        profile, 80.0, edge_tracks=(positive, negative),
    )

    assert estimate.pitch_px is None
    assert estimate.reason_code in {
        "periodicity_signal_weak", "periodicity_edge_quality_insufficient",
    }
    assert estimate.negative_normal_reason == "continuous_edge_support_insufficient"
    assert estimate.positive_normal_reason == "continuous_edge_support_insufficient"


def test_single_clear_track_resolves_autocorrelation_harmonic_from_crests():
    profile = _wide_profile_for_periodicity()
    s = profile.s_values[profile.sample_mask]
    local = np.arange(len(s), dtype=np.float64)
    period = 10.0
    alternating = 1.0 + 2.0 * ((local // period).astype(np.int32) % 2)
    negative = _quality_track(
        s, 40.0 + alternating * np.cos(2.0 * np.pi * local / period),
    )
    positive = _quality_track(
        s, 40.0 + 1.5 * np.cos(2.0 * np.pi * local / 20.0),
        blur_px=13.0, uncertainty_px=1.2,
    )

    estimate = measure_periodicity_px(
        profile, 80.0, edge_tracks=(positive, negative),
    )

    assert estimate.reason_code is None, estimate
    assert estimate.pitch_px is not None and 9.0 <= estimate.pitch_px <= 11.0
    assert estimate.left_autocorrelation_px is not None
    assert 19.0 <= estimate.left_autocorrelation_px <= 21.0
    assert estimate.left_frequency_px is not None
    assert estimate.left_peak_spacing_px is not None
    assert estimate.selected_side == "negative_normal"
