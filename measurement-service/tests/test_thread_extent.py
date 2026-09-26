"""Generic B: full, partial, smooth, orientation and occlusion.

These images are programmatically constructed *unit-test geometry*, never
substitutes for frozen user-provided photos or real-case acceptance results.
"""
import pathlib
import sys

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from thread_geometry import detect_threaded_shank, estimate_head_underface
from thread_extent import infer_thread_extent


def _bolt(pitch=20.0, start=265, radius=16.0, signal=2.0, *, head=True):
    image = np.full((540, 860, 3), 245, dtype=np.uint8)
    if head:
        cv2.rectangle(image, (210, 280), (265, 420), (25, 25, 25), -1)
    xs = np.arange(265, 606)
    body = np.full(xs.shape, radius, dtype=np.float64)
    threaded = xs >= start
    body[threaded] = radius - signal + signal * np.cos(
        2 * np.pi * (xs[threaded] - start) / pitch
    )
    upper = np.column_stack([xs, np.rint(350 - body).astype(int)])
    lower = np.column_stack([xs[::-1], np.rint(350 + body[::-1]).astype(int)])
    cv2.fillPoly(image, [np.vstack([upper, lower]).astype(np.int32)], (25, 25, 25))
    return image


def _profile(image):
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    _, binary = cv2.threshold(gray, 110, 255, cv2.THRESH_BINARY_INV)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    profile = detect_threaded_shank(max(contours, key=cv2.contourArea))
    assert profile is not None, "Synthetic image must contain head + shank"
    bearing = estimate_head_underface(profile)
    assert bearing is not None, "Physical shoulder must be visible"
    return profile, bearing


def test_full_thread_B_from_actual_synthetic_pixels():
    image = _bolt(pitch=20.0, start=265)
    profile, bearing = _profile(image)
    extent = infer_thread_extent(image, profile, bearing, 20.0)
    assert extent.value_px is not None, extent
    assert abs(extent.value_px - 340.0) <= 10.0, extent
    assert extent.diagnostics["coverage"] == "head_to_tip_visible_full_thread"


def test_partial_thread_B_detects_smooth_to_periodic_boundary():
    for origin in (355, 395):
        image = _bolt(pitch=18.0, start=origin)
        profile, bearing = _profile(image)
        extent = infer_thread_extent(image, profile, bearing, 18.0)
        assert extent.value_px is not None, (origin, extent)
        assert abs(extent.value_px - (605 - origin)) < 27.0, (origin, extent)
        assert extent.diagnostics["coverage"] == "observed_smooth_to_thread_transition"


def test_pure_smooth_shank_refuses_B():
    image = _bolt(pitch=20.0, start=800)
    profile, bearing = _profile(image)
    extent = infer_thread_extent(image, profile, bearing, 20.0)
    assert extent.value_px is None
    assert extent.reason == "continuous_thread_relief_not_detected"


def test_mirror_orientation_invariance_of_full_thread_B():
    image = cv2.flip(_bolt(pitch=20.0), 1)
    profile, bearing = _profile(image)
    extent = infer_thread_extent(image, profile, bearing, 20.0)
    assert extent.value_px is not None, extent
    assert abs(extent.value_px - 340.0) <= 10.0


def test_hidden_head_side_is_not_fabricated():
    source = _bolt(pitch=20.0, start=265)
    profile, bearing = _profile(source)
    masked = source.copy()
    masked[325:380, 263:345] = 245
    extent = infer_thread_extent(masked, profile, bearing, 20.0)
    assert extent.value_px is None, extent
    assert extent.reason in (
        "thread_head_boundary_unresolved", "thread_start_transition_occluded",
        "continuous_thread_relief_not_detected", "thread_interval_not_continuous",
    )


def test_underresolved_pitch_refuses_B():
    image = _bolt()
    profile, bearing = _profile(image)
    extent = infer_thread_extent(image, profile, bearing, 2.0)
    assert extent.value_px is None
    assert extent.reason == "thread_pitch_unreliable_for_extent"


def test_local_thread_runs_bridge_unknown_not_observed_smooth():
    from thread_extent import _evidence_runs

    centers = np.arange(10, dtype=float) * 6.0
    # P=12 px: two unknown centres span 18 px (1.5 P) and are too far.
    one_blind = [False, True, True, None, True, True, False, False, False, False]
    runs = _evidence_runs(centers, one_blind, 12.0)
    assert [list(group) for group in runs] == [[1, 2, 4, 5]]
    observed_smooth = [False, True, True, False, True, True, False, False, False, False]
    runs = _evidence_runs(centers, observed_smooth, 12.0)
    assert [list(group) for group in runs] == [[1, 2], [4, 5]]
    long_blind = [True, True, None, None, None, None, True, True, False, False]
    runs = _evidence_runs(centers, long_blind, 12.0)
    assert [list(group) for group in runs] == [[0, 1], [6, 7]]


def test_short_raw_image_occlusion_does_not_invent_smooth_shank():
    image = _bolt(pitch=20.0)
    profile, bearing = _profile(image)
    with_missing_strip = image.copy()
    with_missing_strip[325:375, 430:435] = 245
    result = infer_thread_extent(with_missing_strip, profile, bearing, 20.0)
    assert result.value_px is not None, result
    assert abs(result.value_px - 340.0) <= 10.0
