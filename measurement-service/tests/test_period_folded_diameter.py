import pathlib
import sys

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from edge_observation import EdgeTrack  # noqa: E402
from period_folded_diameter import estimate_period_folded_diameter  # noqa: E402


def _triangle(s, pitch, phase=0.0):
    d = np.mod(s - phase + 0.5 * pitch, pitch) - 0.5 * pitch
    return 1.0 - 4.0 * np.abs(d) / pitch


def _track(
    values,
    *,
    pitch=16.0,
    blur_meta=3.0,
    uncertainty=0.22,
    valid=None,
):
    values = np.asarray(values, dtype=np.float64)
    n = len(values)
    if valid is None:
        valid = np.ones(n, dtype=bool)
    return EdgeTrack(
        s_px=np.arange(n, dtype=np.float64),
        outward_px=values,
        uncertainty_px=np.full(n, uncertainty, dtype=np.float64),
        contrast=np.full(n, 115.0, dtype=np.float64),
        blur_10_90_px=np.full(n, blur_meta, dtype=np.float64),
        relative_residual=np.full(n, 0.045, dtype=np.float64),
        valid=np.asarray(valid, dtype=bool),
        gradient_strength=np.full(n, 25.0, dtype=np.float64),
    )


def test_bilateral_folded_flanks_recover_major_diameter_without_nominal_size():
    pitch = 16.0
    s = np.arange(320, dtype=np.float64)
    relief = 4.0
    positive = _track(22.0 + 0.002 * s + relief * _triangle(s, pitch, 1.1))
    negative = _track(20.0 - 0.002 * s + relief * _triangle(s, pitch, 6.0))

    result = estimate_period_folded_diameter(
        positive, negative, pitch, bootstrap_repeats=32,
    )

    expected = 22.0 + 20.0 + 2.0 * relief
    assert result.reason is None, result
    assert result.mode == "bilateral_folded_flanks"
    assert result.diameter_px is not None
    assert abs(result.diameter_px - expected) < 1.0
    assert result.bootstrap_valid_fraction >= 0.75


def test_clear_side_can_recover_shared_thread_relief_when_opposite_crest_is_blurred():
    pitch = 16.0
    s = np.arange(352, dtype=np.float64)
    relief = 4.5
    clear = 20.0 + relief * _triangle(s, pitch, 2.0)
    blurred = 23.0 + relief * _triangle(s, pitch, 7.0)
    blurred = cv2.GaussianBlur(
        blurred.reshape(1, -1), (0, 0), sigmaX=3.0,
    ).ravel()

    positive = _track(blurred, blur_meta=9.0, uncertainty=0.65)
    negative = _track(clear, blur_meta=3.2, uncertainty=0.20)
    result = estimate_period_folded_diameter(
        positive, negative, pitch, bootstrap_repeats=32,
    )

    expected = 23.0 + 20.0 + 2.0 * relief
    assert result.reason is None, result
    assert result.mode == "shared_profile_negative"
    assert not result.positive.reliable
    assert result.negative.reliable
    assert result.diameter_px is not None
    assert abs(result.diameter_px - expected) < 1.2


def test_folded_diameter_rejects_when_neither_side_has_recoverable_flanks():
    pitch = 16.0
    s = np.arange(288, dtype=np.float64)
    base = 21.0 + 3.0 * _triangle(s, pitch)
    smooth = cv2.GaussianBlur(base.reshape(1, -1), (0, 0), sigmaX=5.0).ravel()

    positive = _track(smooth, blur_meta=13.0, uncertainty=1.2)
    negative = _track(smooth, blur_meta=13.0, uncertainty=1.2)
    result = estimate_period_folded_diameter(
        positive, negative, pitch, bootstrap_repeats=16,
    )

    assert result.diameter_px is None
    assert result.reason in {
        "trusted_folded_profile_unavailable",
        "cross_side_relief_disagrees",
    }


def test_cycle_bootstrap_detects_stable_repeated_geometry():
    pitch = 12.0
    s = np.arange(300, dtype=np.float64)
    rng = np.random.default_rng(4)
    relief = 3.2
    pos = 18.0 + relief * _triangle(s, pitch, 0.8) + rng.normal(0.0, 0.12, len(s))
    neg = 19.0 + relief * _triangle(s, pitch, 5.1) + rng.normal(0.0, 0.12, len(s))

    result = estimate_period_folded_diameter(
        _track(pos, pitch=pitch),
        _track(neg, pitch=pitch),
        pitch,
        bootstrap_repeats=48,
        random_seed=9,
    )

    assert result.reason is None, result
    assert result.bootstrap_sigma_px is not None
    assert result.bootstrap_sigma_px < 1.0
    assert result.bootstrap_valid_fraction >= 0.9
