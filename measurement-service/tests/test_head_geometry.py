import pathlib
import sys

import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from head_geometry import observe_head_profile  # noqa: E402
from thread_geometry import HeadUnderfaceEstimate, ThreadedShankProfile  # noqa: E402


def _profile(kind: str, center_drift: float = 0.0) -> tuple[ThreadedShankProfile, HeadUnderfaceEstimate]:
    s = np.arange(-60.0, 61.0)
    head_t = np.clip(s, 0.0, 60.0) / 60.0
    if kind == "countersunk":
        widths = np.where(s < 0, 20.0, 22.0 + 28.0 * head_t)
    else:
        widths = np.where(s < 0, 20.0, 42.0 - 5.0 * head_t)
    centers = np.where(s < 0, 0.0, center_drift * head_t)
    low = centers - widths * 0.5
    high = centers + widths * 0.5
    profile = ThreadedShankProfile(
        center=np.array([0.0, 0.0]),
        axis=np.array([1.0, 0.0]),
        normal=np.array([0.0, 1.0]),
        s_values=s,
        low=low,
        high=high,
        widths=widths,
        sample_mask=s < -5,
        transition_s=0.0,
        tip_s=-60.0,
        start_xy=(-55.0, 0.0),
        end_xy=(-5.0, 0.0),
    )
    underface = HeadUnderfaceEstimate(
        s=0.0,
        shank_outer_px=20.0,
        stable_limit_px=22.0,
        expansion_threshold_px=26.0,
        persistence_px=5,
    )
    return profile, underface


def test_broad_bearing_profile_is_reliable_protruding_head_evidence():
    observation = observe_head_profile(*_profile("protruding"))
    assert observation.status == "measured"
    assert observation.quality == "reliable"
    assert observation.length_convention_evidence == "protruding"
    assert observation.bearing_width_ratio is not None
    assert observation.bearing_width_ratio > 0.85
    assert len(observation.profile_points) == 9


def test_expanding_profile_is_reliable_countersunk_head_evidence():
    observation = observe_head_profile(
        *_profile("countersunk"), boundary_source="coarse_transition"
    )
    assert observation.status == "measured"
    assert observation.quality == "reliable"
    assert observation.boundary_source == "coarse_transition"
    assert observation.length_convention_evidence == "countersunk"
    assert observation.bearing_width_ratio is not None
    assert observation.top_width_ratio is not None
    assert observation.top_width_ratio > observation.bearing_width_ratio


def test_coarse_transition_cannot_certify_a_protruding_bearing_plane():
    observation = observe_head_profile(
        *_profile("protruding"), boundary_source="coarse_transition"
    )
    assert observation.quality == "degraded"
    assert "head_bearing_plane_unresolved" in observation.reason_codes


def test_large_centerline_drift_is_retained_but_quality_gated():
    observation = observe_head_profile(*_profile("protruding", center_drift=14.0))
    assert observation.status == "measured"
    assert observation.quality == "degraded"
    assert "head_profile_centerline_drift" in observation.reason_codes
    assert observation.centerline_drift_ratio is not None
    assert observation.centerline_drift_ratio > 0.18
