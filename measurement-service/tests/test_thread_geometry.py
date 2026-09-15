import pathlib
import sys

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from thread_geometry import (  # noqa: E402
    detect_threaded_shank,
    measure_outer_width_px,
    measure_periodicity_px,
)


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
