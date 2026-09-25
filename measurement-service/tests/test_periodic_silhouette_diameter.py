import pathlib
import sys

import cv2
import numpy as np

SERVICE=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(SERVICE))

from periodic_silhouette_diameter import estimate_periodic_silhouette_diameter  # noqa: E402
from thread_geometry import detect_threaded_shank  # noqa: E402


def _synthetic_vthread(*, top_sigma=1.0, bottom_sigma=None):
    h,w=180,720
    center=90
    pitch=8.0
    major_r=24.0
    xs=np.arange(120,661,dtype=float)
    phase=np.mod(xs-120+0.5*pitch,pitch)-0.5*pitch
    radius=major_r-0.613434*pitch*(np.abs(phase)/(0.5*pitch))
    mask=np.zeros((h,w),dtype=np.uint8)
    cv2.rectangle(mask,(60,50),(120,130),255,-1)
    top=np.column_stack([xs,center-radius]).astype(np.int32)
    bottom=np.column_stack([xs[::-1],(center+radius)[::-1]]).astype(np.int32)
    cv2.fillPoly(mask,[np.vstack([top,bottom])],255)
    if bottom_sigma is None:
        bottom_sigma=top_sigma
    btop=cv2.GaussianBlur(mask,(0,0),sigmaX=top_sigma,sigmaY=top_sigma)
    bbot=cv2.GaussianBlur(mask,(0,0),sigmaX=bottom_sigma,sigmaY=bottom_sigma)
    mixed=bbot.copy()
    mixed[:center,:]=btop[:center,:]
    binary=(mixed>=128).astype(np.uint8)*255
    contours,_=cv2.findContours(binary,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
    profile=detect_threaded_shank(max(contours,key=cv2.contourArea))
    assert profile is not None
    rgb=np.repeat((255-mixed)[:,:,None],3,axis=2)
    return rgb,profile,pitch


def test_periodic_raw_silhouette_recovers_blurred_vthread_major_diameter():
    rgb,profile,pitch=_synthetic_vthread(top_sigma=2.5)
    result=estimate_periodic_silhouette_diameter(rgb,profile,pitch)
    assert result.reason is None, result
    assert result.diameter_px is not None
    assert abs(result.diameter_px-48.0)<=1.5


def test_periodic_raw_silhouette_handles_asymmetric_blur_without_nominal_diameter():
    rgb,profile,pitch=_synthetic_vthread(top_sigma=3.0,bottom_sigma=1.2)
    result=estimate_periodic_silhouette_diameter(rgb,profile,pitch)
    assert result.reason is None, result
    assert result.diameter_px is not None
    assert abs(result.diameter_px-48.0)<=2.0


def test_periodic_raw_silhouette_uses_image_measured_period_and_fails_bad_pitch():
    rgb,profile,pitch=_synthetic_vthread(top_sigma=2.0)
    good=estimate_periodic_silhouette_diameter(rgb,profile,pitch)
    bad=estimate_periodic_silhouette_diameter(rgb,profile,2.0)
    assert good.diameter_px is not None
    assert bad.diameter_px is None
    assert bad.reason=="invalid_pitch"
