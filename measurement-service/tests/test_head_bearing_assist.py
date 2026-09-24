"""Assistive underface evidence on the accepted shank frame.

These analytical shape fixtures are unit tests only; the separately pinned
original photographs are the product-level validation set.
"""
import pathlib
import sys
import numpy as np
import cv2
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from head_bearing_assist import inspect_bearing_face
from thread_geometry import detect_threaded_shank, estimate_head_underface


def _fastener(fillet=0.0, conical=False):
    x=np.arange(0.0, 350.0, 0.25)
    r=np.full_like(x, 16.0)
    if conical:
        region=(x>300)&(x<324)
        r[region]=16 + (x[region]-300)
        r[x>=324]=40.0
    else:
        if fillet:
            region=(x>300)&(x<300+fillet)
            r[region]=(16+fillet-np.sqrt(np.maximum(
                0.0, fillet**2-(x[region]-300)**2)))
        r[x>=300+fillet]=40.0
    shape=np.vstack((np.column_stack((x,-r)),
                     np.column_stack((x[::-1],r[::-1]))))
    shape=np.rint(shape+[500,500]).astype(np.int32).reshape(-1,1,2)
    return shape


@pytest.mark.parametrize("fillet,plane",[(0,300),(4,304),(12,312)])
def test_independent_bearing_face_after_first_persistent_expansion(fillet,plane):
    profile=detect_threaded_shank(_fastener(fillet))
    assert profile is not None
    baseline=estimate_head_underface(profile)
    assert baseline is not None
    evidence=inspect_bearing_face(profile)
    assert evidence.first_expansion_s==baseline.s
    assert evidence.reason_code=="bearing_plane_observed", evidence
    assert evidence.bearing_plane_s is not None
    span=abs(evidence.bearing_plane_s-profile.tip_s)
    assert span==pytest.approx(plane, abs=3)
    if fillet==12:
        assert evidence.expansion_to_bearing_px is not None
        assert evidence.expansion_to_bearing_px>3


def test_gradual_conical_widening_is_not_invented_as_perpendicular_plane():
    profile=detect_threaded_shank(_fastener(conical=True))
    assert profile is not None
    evidence=inspect_bearing_face(profile)
    assert evidence.bearing_plane_s is None
    assert evidence.reason_code=="bearing_plane_unresolved"


def test_uniform_shank_does_not_create_bearing_face():
    shape=np.array([[0,-16],[340,-16],[340,16],[0,16]],np.int32)
    profile=detect_threaded_shank((shape+500).reshape(-1,1,2))
    assert profile is None
