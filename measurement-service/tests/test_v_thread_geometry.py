import pathlib
import sys

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from v_thread_geometry import (  # noqa: E402
    estimate_major_from_pitch_diameter,
    major_minus_pitch_factor,
)


def test_basic_60_degree_factor_matches_iso_unified_geometry():
    factor = major_minus_pitch_factor(60.0)
    assert abs(factor - 0.6495190528) < 1e-9


def test_major_reconstruction_uses_only_proxy_and_measured_pitch():
    estimate = estimate_major_from_pitch_diameter(
        43.259, 8.0, proxy_uncertainty_px=0.6, pitch_uncertainty_px=0.05,
    )
    assert estimate.reliable
    assert estimate.major_diameter_px is not None
    assert abs(estimate.major_diameter_px - 48.4551524224) < 1e-9
    assert estimate.uncertainty_px is not None
    assert estimate.uncertainty_px > 0.6


def test_invalid_proxy_fails_closed():
    estimate = estimate_major_from_pitch_diameter(0.0, 8.0)
    assert not estimate.reliable
    assert estimate.major_diameter_px is None
    assert estimate.reason == "invalid_pitch_diameter_proxy"
