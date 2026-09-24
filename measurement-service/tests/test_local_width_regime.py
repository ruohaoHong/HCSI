"""Synthetic local width-regime tests. No catalog values enter estimation."""
import math
import pathlib
import sys
import cv2
import numpy as np
import pytest

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from thread_geometry import (
    _detect_threaded_shank_global,
    detect_local_shank_regime,
    detect_threaded_shank,
    decompose_head_body,
    measure_outer_width_px,
)


def short_wide_fastener(angle=0.0, reverse=False):
    # Deliberately make the crown wider than the whole fastener is long, so
    # whole-object PCA can point across the head instead of along the shaft.
    shaft_radius=43.0
    head_radius=130.0
    tip, shoulder, top=0.0, 126.0, 205.0
    x=np.arange(tip,shoulder+0.25,0.25)
    upper=np.column_stack((x,np.full_like(x,-shaft_radius)))
    lower=np.column_stack((x[::-1],np.full_like(x,shaft_radius)))
    outline=np.vstack((
        upper, [[shoulder,-head_radius],[top,-head_radius],
                [top,head_radius],[shoulder,head_radius]],lower,
    ))
    if reverse:
        outline[:,0]*=-1
    cs,sn=math.cos(angle),math.sin(angle)
    outline=outline @ np.array([[cs,-sn],[sn,cs]]).T
    outline+=np.array([600.0,600.0])
    return np.rint(outline).astype(np.int32).reshape(-1,1,2)


@pytest.mark.parametrize("angle,reverse",[
    (0.0,False),(0.0,True),(0.14,False),(-0.14,True),
])
def test_local_regime_recovers_short_wide_shank_without_global_pca(angle,reverse):
    contour=short_wide_fastener(angle,reverse)
    profile=detect_local_shank_regime(contour)
    assert profile is not None
    expected=np.array([math.cos(angle),math.sin(angle)])
    assert abs(np.dot(profile.axis,expected))>0.985
    assert abs(profile.tip_s-profile.transition_s)==pytest.approx(126,abs=9)
    width=measure_outer_width_px(profile)
    assert width is not None
    assert 83<=width<=90
    structure=decompose_head_body(profile)
    assert structure.transition_start_s is not None
    assert abs(structure.transition_start_s-structure.tip_s)==pytest.approx(126,abs=9)


def test_public_detector_recovers_head_shaft_axis_of_short_wide_screw():
    contour=short_wide_fastener()
    profile=detect_threaded_shank(contour)
    assert profile is not None
    assert abs(profile.axis[0])>0.985
    assert abs(profile.transition_s-profile.tip_s)==pytest.approx(126,abs=9)


def test_local_regime_does_not_invent_head_on_uniform_rod():
    contour=np.array([[0,-45],[230,-45],[230,45],[0,45]],np.int32)
    contour=(contour+500).reshape(-1,1,2)
    assert detect_local_shank_regime(contour) is None


def test_local_transition_is_not_an_automatic_length_datum():
    contour=short_wide_fastener()
    profile=detect_local_shank_regime(contour)
    assert profile is not None
    structure=decompose_head_body(profile)
    # Even on a square synthetic shoulder, the two concepts are separate.
    assert structure.transition_start_s is not None
    if structure.bearing_plane is not None:
        assert abs(structure.bearing_plane.s-structure.tip_s)==pytest.approx(126,abs=3)
