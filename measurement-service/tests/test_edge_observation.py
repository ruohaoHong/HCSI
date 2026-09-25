import pathlib
import sys

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from edge_observation import (  # noqa: E402
    measure_thread_major_diameter,
    observe_edge,
    observe_edge_track,
    observe_thread_edges,
)
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


def _subpixel_step(
    *, edge_x: float = 64.35, sigma_px: float = 0.55, contrast: float = 190.0,
):
    x = np.arange(128, dtype=np.float64)
    object_occupancy = 1.0 / (
        1.0 + np.exp(np.clip((x - edge_x) / sigma_px, -30.0, 30.0))
    )
    row = 235.0 - contrast * object_occupancy
    return np.tile(row.astype(np.uint8), (96, 1))


def test_clear_step_edge_has_subpixel_position_near_physical_ground_truth():
    edge_x = 64.35
    observation = observe_edge(
        _subpixel_step(edge_x=edge_x),
        coarse_position_xy=(63.0, 48.0),
        outward_normal_xy=(1.0, 0.0),
    )

    assert observation.valid, observation
    assert abs(observation.position_xy[0] - edge_x) < 0.30
    assert abs(observation.offset_px - (edge_x - 63.0)) < 0.30
    assert observation.uncertainty_px < 0.25
    assert observation.gradient_strength > 20.0


def test_blur_preserves_position_but_increases_spread_and_uncertainty():
    sharp = observe_edge(
        _subpixel_step(sigma_px=0.55), (63.0, 48.0), (1.0, 0.0)
    )
    blurred = observe_edge(
        _subpixel_step(sigma_px=2.2), (63.0, 48.0), (1.0, 0.0)
    )

    assert sharp.valid and blurred.valid
    assert abs(sharp.position_xy[0] - blurred.position_xy[0]) < 0.35
    assert blurred.edge_spread_px > sharp.edge_spread_px * 2.0
    assert blurred.uncertainty_px > sharp.uncertainty_px
    assert blurred.gradient_strength < sharp.gradient_strength


def test_edge_with_insufficient_contrast_is_not_fabricated():
    high = observe_edge(
        _subpixel_step(contrast=190.0, sigma_px=1.0),
        (63.0, 48.0),
        (1.0, 0.0),
    )
    low = observe_edge(
        _subpixel_step(contrast=18.0, sigma_px=1.0),
        (63.0, 48.0),
        (1.0, 0.0),
    )

    assert high.valid
    assert not low.valid
    assert low.reason_code == "low_contrast"
    assert np.isinf(low.uncertainty_px)


def test_upper_and_lower_tracks_retain_asymmetric_optical_quality():
    height, width = 120, 128
    y = np.arange(height, dtype=np.float64)
    top_y, bottom_y = 35.4, 82.3
    top_occupancy = 1.0 / (
        1.0 + np.exp(np.clip((top_y - y) / 0.65, -30.0, 30.0))
    )
    bottom_occupancy = 1.0 / (
        1.0 + np.exp(np.clip((y - bottom_y) / 2.4, -30.0, 30.0))
    )
    row = 235.0 - 190.0 * top_occupancy * bottom_occupancy
    image = np.tile(row[:, None], (1, width)).astype(np.uint8)
    x = np.arange(24.0, 105.0, 10.0)
    upper_points = np.column_stack([x, np.full_like(x, 35.0)])
    lower_points = np.column_stack([x, np.full_like(x, 82.0)])

    upper = observe_edge_track(image, upper_points, (0.0, -1.0))
    lower = observe_edge_track(image, lower_points, (0.0, 1.0))

    assert upper.valid_fraction == 1.0
    assert lower.valid_fraction == 1.0
    assert lower.median_edge_spread_px > upper.median_edge_spread_px * 2.0
    assert lower.median_uncertainty_px > upper.median_uncertainty_px
    assert lower.median_gradient_strength < upper.median_gradient_strength
    assert upper.observations[0].edge_spread_px != lower.observations[0].edge_spread_px


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
    assert len(result.upper.observations) == len(result.upper.s_px)
    assert len(result.lower.observations) == len(result.lower.s_px)
    assert all(item.valid for item in result.upper.observations if item.reason_code is None)
    assert result.upper.valid_fraction > 0.9
    assert np.isfinite(result.upper.median_gradient_strength)


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
