import pathlib
import sys

import cv2
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


def _rasterized_head_with_biased_profile(*, erase_positive_edge: bool = False):
    """Build a symmetric physical head while corrupting one contour side.

    The image is the physical evidence. The ThreadedShankProfile deliberately
    mimics a segmentation contour whose +normal head edge collapses inward over
    the middle of the head.
    """
    height, width = 220, 360
    image = np.full((height, width, 3), 245, dtype=np.uint8)
    axis_y = 110
    # Shank extends left from the head.
    cv2.rectangle(image, (35, 100), (180, 120), (70, 70, 70), -1)
    # Physical head: broad, nearly cylindrical protruding envelope.
    cv2.rectangle(image, (180, 70), (250, 150), (92, 92, 92), -1)
    # Add internal texture so the raw edge observer must prefer the outer edge.
    for x in range(188, 248, 8):
        cv2.line(image, (x, 76), (x, 144), (135, 135, 135), 2)
    if erase_positive_edge:
        # Remove source-image evidence from the +normal outer boundary over a
        # long span. A correct primitive must not certify a bilateral profile.
        image[66:92, 194:238, :] = 245

    s = np.arange(-145.0, 71.0)
    widths = np.where(s < 0, 20.0, 80.0)
    centers = np.zeros_like(s)
    low = centers - widths * 0.5
    high = centers + widths * 0.5

    # Corrupt only +normal segmentation ownership in the middle of the head.
    bad = (s >= 16) & (s <= 52)
    high[bad] = 8.0
    profile = ThreadedShankProfile(
        center=np.array([180.0, float(axis_y)]),
        axis=np.array([1.0, 0.0]),
        normal=np.array([0.0, 1.0]),
        s_values=s,
        low=low,
        high=high,
        widths=high - low,
        sample_mask=(s < -8),
        transition_s=0.0,
        tip_s=-145.0,
        start_xy=(40.0, float(axis_y)),
        end_xy=(172.0, float(axis_y)),
    )
    underface = HeadUnderfaceEstimate(
        s=0.0,
        shank_outer_px=20.0,
        stable_limit_px=22.0,
        expansion_threshold_px=26.0,
        persistence_px=5,
    )
    return image, profile, underface


def test_raw_bilateral_edges_recover_one_sided_segmentation_collapse():
    image, profile, underface = _rasterized_head_with_biased_profile()
    contour_only = observe_head_profile(profile, underface)
    raw = observe_head_profile(profile, underface, image_rgb=image)

    assert contour_only.quality == "degraded"
    assert "head_profile_centerline_drift" in contour_only.reason_codes
    assert raw.status == "measured"
    assert raw.length_convention_evidence == "protruding"
    assert raw.centerline_drift_ratio is not None
    assert raw.centerline_drift_ratio < 0.10
    assert "head_bilateral_edge_support_insufficient" not in raw.reason_codes


def test_bilateral_head_edges_do_not_invent_missing_source_boundary():
    image, profile, underface = _rasterized_head_with_biased_profile(
        erase_positive_edge=True,
    )
    observation = observe_head_profile(profile, underface, image_rgb=image)

    assert observation.status == "measured"
    assert observation.quality == "degraded"
    assert any(
        code in observation.reason_codes
        for code in (
            "head_bilateral_edge_support_insufficient",
            "head_bilateral_edge_side_sparse",
            "head_profile_has_gaps",
        )
    )
