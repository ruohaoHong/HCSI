import pathlib
import sys

import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from diameter_axis import estimate_independent_axis  # noqa: E402
from edge_observation import EdgeTrack  # noqa: E402


def _tracks(*, smooth_samples=115, pitch_px=13.0, drift=0.002):
    """Geometry-only regression; does not count as real-image benchmark."""
    s = np.arange(380, dtype=np.float64)
    center = 1.5 + drift * s
    phase = 2.0 * np.pi * s / pitch_px
    upper_radius = np.where(s < smooth_samples, 16.0, 14.0 + 2.0 * np.cos(phase))
    lower_radius = np.where(s < smooth_samples, 16.0, 14.0 + 2.0 * np.cos(phase + 0.6))
    valid = np.ones(len(s), dtype=bool)
    def track(outward):
        return EdgeTrack(
            s_px=s,
            outward_px=outward,
            uncertainty_px=np.full_like(s, 0.28),
            contrast=np.full_like(s, 100.0),
            blur_10_90_px=np.full_like(s, 3.5),
            relative_residual=np.full_like(s, 0.04),
            valid=valid,
        )
    return track(center + upper_radius), track(-center + lower_radius)


def test_centerline_is_independent_of_threaded_crest_and_extrapolates():
    upper, lower = _tracks()
    axis = estimate_independent_axis(upper, lower)
    assert axis is not None
    assert axis.reference_samples >= 36
    assert axis.span_end_px < 135.0
    assert abs(float(axis.normal_coordinate(320.0)) - (1.5 + 0.002 * 320.0)) < 0.25
    assert axis.uncertainty(320.0) > axis.uncertainty(axis.s_origin_px)


def test_fully_threaded_one_side_does_not_create_an_unsupported_axis():
    upper, lower = _tracks(smooth_samples=0)
    axis = estimate_independent_axis(upper, lower)
    assert axis is None


def test_missing_bilateral_reference_rejects_axis_even_with_one_flat_side():
    upper, lower = _tracks()
    flags = lower.valid.copy()
    flags[:135] = False
    lower = EdgeTrack(
        lower.s_px, lower.outward_px, lower.uncertainty_px,
        lower.contrast, lower.blur_10_90_px, lower.relative_residual, flags,
    )
    assert estimate_independent_axis(upper, lower) is None


def test_centerline_uses_complementary_side_pixels_not_same_column_only():
    # The two optical edges can be observed at alternating axial samples;
    # rejecting them merely because they do not coexist at each x wastes real
    # bilateral geometric evidence.
    upper, lower = _tracks(smooth_samples=135)
    u_valid = upper.valid.copy()
    l_valid = lower.valid.copy()
    early = upper.s_px < 135
    u_valid[early] = (upper.s_px[early] % 3 != 0)
    l_valid[early] = (lower.s_px[early] % 3 == 0)
    assert not np.any(u_valid[early] & l_valid[early])
    upper = EdgeTrack(
        upper.s_px, upper.outward_px, upper.uncertainty_px,
        upper.contrast, upper.blur_10_90_px, upper.relative_residual, u_valid,
    )
    lower = EdgeTrack(
        lower.s_px, lower.outward_px, lower.uncertainty_px,
        lower.contrast, lower.blur_10_90_px, lower.relative_residual, l_valid,
    )
    axis = estimate_independent_axis(upper, lower)
    assert axis is not None
    assert axis.span_end_px < 155.0
    assert abs(float(axis.normal_coordinate(320.0)) - (1.5 + .002 * 320.0)) < .35
