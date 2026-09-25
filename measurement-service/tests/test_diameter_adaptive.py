"""Image-level adaptive-D tests across head-independent geometries.

Synthetic raster scenes validate invariants and single-side routing. They are
not scored as real-world accuracy evidence; the separate real cases remain
the external benchmarks.
"""
import pathlib
import sys

import cv2
import numpy as np
import pytest

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from edge_observation import measure_thread_major_diameter  # noqa: E402
from thread_geometry import detect_threaded_shank  # noqa: E402


def _image(*, radius=16.0, period=13.0, smooth_length=205, damaged="top"):
    center_y = 190
    head_end = 170
    shaft_end = head_end + smooth_length
    tip = 715
    image = np.full((390, 790, 3), 245, dtype=np.uint8)
    cv2.rectangle(image, (105, 120), (head_end, 260), (28, 28, 28), -1)
    if smooth_length:
        cv2.rectangle(
            image,
            (head_end, int(center_y - radius)),
            (shaft_end, int(center_y + radius)),
            (28, 28, 28), -1,
        )
    x = np.arange(shaft_end, tip + 1, dtype=np.float64)
    r_upper = radius - 2.0 + 2.0 * np.cos(2 * np.pi * (x - shaft_end) / period)
    r_lower = radius - 2.0 + 2.0 * np.cos(2 * np.pi * (x - shaft_end) / period + 0.35)
    top = np.column_stack([x, center_y - r_upper]).astype(np.int32)
    bottom = np.column_stack([x[::-1], (center_y + r_lower)[::-1]]).astype(np.int32)
    cv2.fillPoly(image, [np.vstack([top, bottom])], (28, 28, 28))
    mask = (image[:, :, 0] < 120).astype(np.uint8) * 255
    # Deliberately bias segmentation relative to the raw physical image.
    mask = cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contour = max(contours, key=cv2.contourArea)

    # Damage only the *threaded* side; the unthreaded section retains an
    # independently observable, bilateral reference axis.
    if damaged is not None:
        blurred = cv2.GaussianBlur(image, (0, 0), sigmaX=3.1, sigmaY=3.1)
        x0 = shaft_end + 15
        if damaged == "top":
            image[:center_y - 1, x0:] = blurred[:center_y - 1, x0:]
        else:
            image[center_y + 1:, x0:] = blurred[center_y + 1:, x0:]
    return image, contour


@pytest.mark.parametrize("damaged", ["top", "bottom"])
@pytest.mark.parametrize("period", [12.0, 17.0])
def test_independent_axis_recovers_single_good_flank_across_pitches(damaged, period):
    image, contour = _image(damaged=damaged, period=period)
    profile = detect_threaded_shank(contour)
    assert profile is not None
    result = measure_thread_major_diameter(image, profile)
    assert result.reason is None, result.reason
    assert result.measurement_mode.endswith("independent_axis"), result.measurement_mode
    assert result.axis_reference_samples >= 36
    assert result.value_px is not None
    assert abs(result.value_px - 32.0) <= 3.0, result
    assert result.uncertainty_px is not None
    assert result.uncertainty_px > 0


def test_two_clear_sides_use_direct_geometry_not_axis_extrapolation():
    image, contour = _image(damaged=None)
    profile = detect_threaded_shank(contour)
    assert profile is not None
    result = measure_thread_major_diameter(image, profile)
    assert result.reason is None, result
    assert result.measurement_mode == "two_side"
    assert abs(result.value_px - 32.0) <= 2.0


def test_fully_threaded_single_good_side_does_not_fabricate_a_centerline():
    image, contour = _image(smooth_length=0, damaged="top")
    profile = detect_threaded_shank(contour)
    assert profile is not None
    result = measure_thread_major_diameter(image, profile)
    assert result.value_px is None
    assert result.measurement_mode == "none"
