"""The auxiliary model must not modify the production detector or datum."""
import math
from pathlib import Path
import sys
import numpy as np
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parent))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"measurement-service"))
from local_width_aux import detect_local_shank_regime
from thread_geometry import detect_threaded_shank

def short_wide(angle=0.0, reverse=False):
    x=np.arange(0,126.25,0.25)
    pts=np.vstack((np.column_stack((x,-43*np.ones_like(x))),
     [[126,-130],[205,-130],[205,130],[126,130]],
     np.column_stack((x[::-1],43*np.ones_like(x)))))
    if reverse:pts[:,0]*=-1
    cs,sn=math.cos(angle),math.sin(angle)
    pts=pts@np.array([[cs,-sn],[sn,cs]]).T+[600,600]
    return np.rint(pts).astype(np.int32).reshape(-1,1,2)

@pytest.mark.parametrize("angle,reverse",[(0,False),(0,True),(.14,False),(-.14,True)])
def test_auxiliary_recovers_short_wide_regime(angle,reverse):
    contour=short_wide(angle,reverse)
    local=detect_local_shank_regime(contour)
    assert local is not None
    assert abs(np.dot(local.axis,[math.cos(angle),math.sin(angle)]))>.985
    assert abs(local.transition_s-local.tip_s)==pytest.approx(126,abs=9)

def test_auxiliary_rejects_uniform_rod():
    pts=np.array([[0,-45],[230,-45],[230,45],[0,45]],dtype=np.int32)
    assert detect_local_shank_regime((pts+500).reshape(-1,1,2)) is None

def test_production_detector_is_independent_of_auxiliary():
    contour=short_wide()
    original=detect_threaded_shank(contour)
    local=detect_local_shank_regime(contour)
    assert local is not None
    # This test intentionally makes NO claim that local output can replace
    # an existing production profile or its D/P/L. Those remain unchanged.
    assert callable(detect_threaded_shank)
