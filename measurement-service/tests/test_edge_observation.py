import pathlib
import sys

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from edge_observation import measure_thread_major_diameter, observe_thread_edges  # noqa: E402
from thread_geometry import detect_threaded_shank, measure_outer_width_px  # noqa: E402


def _synthetic_thread(*, blur_px: float = 0.0):
    """A real rasterization of a 32 px major-D part; contour is deliberately biased."""
    image = np.full((340, 760, 3), 245, dtype=np.uint8)
    cv2.rectangle(image, (100, 110), (150, 230), (25, 25, 25), -1)
    xs = np.arange(150, 621)
    radius = 14.0 + 2.0 * np.cos(2.0 * np.pi * (xs - 150) / 12.0)
    top = np.column_stack([xs, 170.0 - radius]).astype(np.int32)
    bottom = np.column_stack([xs[::-1], (170.0 + radius)[::-1]]).astype(np.int32)
    cv2.fillPoly(image, [np.vstack([top, bottom])], (25, 25, 25))
    if blur_px:
        image = cv2.GaussianBlur(image, (0, 0), sigmaX=blur_px, sigmaY=blur_px)
    return image


def _eroded_contour(image, inward_px: int = 2):
    dark = (image[:, :, 0] < 120).astype(np.uint8) * 255
    if inward_px:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * inward_px + 1, 2 * inward_px + 1))
        dark = cv2.erode(dark, kernel)
    contours, _ = cv2.findContours(dark, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    return max(contours, key=cv2.contourArea)


def test_raw_edge_recovers_diameter_from_inward_biased_coarse_mask():
    image = _synthetic_thread(blur_px=0.75)
    contour = _eroded_contour(image, inward_px=2)
    profile = detect_threaded_shank(contour)
    assert profile is not None

    biased = measure_outer_width_px(profile)
    assert biased is not None
    assert biased < 30.0

    result = measure_thread_major_diameter(image, profile)

    assert result.reason is None, result
    assert result.value_px is not None
    assert 30.0 <= result.value_px <= 34.0
    assert result.value_px > biased + 1.5
    assert result.uncertainty_px is not None
    assert result.upper_crest_count >= 4
    assert result.lower_crest_count >= 4
    assert np.all(np.isfinite(result.upper.outward_px[result.upper.valid]))
    assert np.all(np.isfinite(result.lower.outward_px[result.lower.valid]))


def test_missing_lower_raw_edge_fails_closed_instead_of_guessing_diameter():
    image = _synthetic_thread(blur_px=0.6)
    contour = _eroded_contour(image, inward_px=1)
    profile = detect_threaded_shank(contour)
    assert profile is not None

    obscured = image.copy()
    obscured[170:, :, :] = 245  # all information about the lower edge is removed
    upper, lower = observe_thread_edges(obscured, profile)
    result = measure_thread_major_diameter(obscured, profile)

    # profile.normal points toward increasing image y for this geometry.
    # Therefore +normal is the obscured (lower image) side.
    assert int(np.count_nonzero(lower.valid)) >= 20
    assert int(np.count_nonzero(upper.valid)) < 20
    assert result.value_px is None
    assert result.reason == "edge_side_support_insufficient"
