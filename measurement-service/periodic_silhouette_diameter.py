"""Recover thread major diameter from phase-locked raw-image silhouette evidence.

Unlike contour/50%-contrast edges, this estimator asks whether the raw image
contains a signal repeating at the already measured thread pitch. Shadows and
slow illumination changes are removed by a low-order trend; periodic screw
structure remains. This lets many thread cycles accumulate weak outer-silhouette
evidence without inventing pixels or using a nominal diameter.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
import cv2
import numpy as np


@dataclass(frozen=True)
class PeriodicSilhouetteSide:
    radius_px: float | None
    harmonic_amplitude: float | None
    t_score: float | None
    noise_floor: float | None
    reliable: bool
    reason: str | None


@dataclass(frozen=True)
class PeriodicSilhouetteDiameter:
    diameter_px: float | None
    uncertainty_px: float | None
    positive: PeriodicSilhouetteSide
    negative: PeriodicSilhouetteSide
    axis_rms_px: float | None
    mode: str
    reason: str | None


def _robust_axis(s: np.ndarray, center_n: np.ndarray):
    keep=np.isfinite(s)&np.isfinite(center_n)
    if np.count_nonzero(keep)<24:
        return None
    origin=float(np.median(s[keep]))
    x=s-origin
    for _ in range(4):
        m,b=np.polyfit(x[keep],center_n[keep],1)
        err=center_n-(m*x+b)
        med=float(np.median(err[keep]))
        mad=1.4826*float(np.median(np.abs(err[keep]-med)))
        nxt=keep&(np.abs(err-med)<=max(0.8,3.0*mad))
        if np.count_nonzero(nxt)<24:
            break
        keep=nxt
    m,b=np.polyfit(x[keep],center_n[keep],1)
    err=center_n[keep]-(m*x[keep]+b)
    rms=float(np.sqrt(np.mean(err*err)))
    return origin,float(m),float(b),rms


def _harmonic_stats(samples: np.ndarray, s: np.ndarray, pitch_px: float):
    """Fundamental amplitude and approximate significance at every radial row."""
    count=len(s)
    x=(s-float(np.mean(s)))/max(float(np.ptp(s)),1.0)
    omega=2.0*np.pi/pitch_px
    design=np.column_stack((
        np.ones(count),x,x*x,np.sin(omega*s),np.cos(omega*s),
    ))
    amps=np.zeros(samples.shape[1],dtype=np.float64)
    scores=np.zeros(samples.shape[1],dtype=np.float64)
    rms=np.zeros(samples.shape[1],dtype=np.float64)
    for j in range(samples.shape[1]):
        y=samples[:,j].astype(np.float64)
        coeff,_,_,_=np.linalg.lstsq(design,y,rcond=None)
        residual=y-design@coeff
        r=float(np.sqrt(np.mean(residual*residual)))
        a=float(np.hypot(coeff[3],coeff[4]))
        se=max(r*np.sqrt(2.0/max(count,1)),1e-9)
        amps[j]=a
        scores[j]=a/se
        rms[j]=r
    return amps,scores,rms


def _outer_candidate(
    q: np.ndarray,
    amps: np.ndarray,
    scores: np.ndarray,
    side: int,
    coarse_radius: float,
):
    outside=(q>coarse_radius+2.0) if side>0 else (q<-coarse_radius-2.0)
    noise=amps[outside&np.isfinite(amps)]
    if len(noise)<8:
        noise=amps[(q>coarse_radius+1.0) if side>0 else (q<-coarse_radius-1.0)]
    if len(noise):
        med=float(np.median(noise))
        mad=1.4826*float(np.median(np.abs(noise-med)))
        floor=max(0.20,med+4.0*mad)
    else:
        floor=0.35

    radial=(q>=0) if side>0 else (q<=0)
    valid=radial&(amps>=floor)&(scores>=3.5)
    # Require radially contiguous support; a single harmonic speck outside the
    # object must not become a physical crest.
    good=np.zeros_like(valid)
    for i in range(2,len(valid)-2):
        if valid[i] and np.count_nonzero(valid[i-2:i+3])>=3:
            good[i]=True
    idx=np.flatnonzero(good)
    if not len(idx):
        return PeriodicSilhouetteSide(None,None,None,floor,False,
                                      "periodic_silhouette_not_resolved")
    chosen=int(idx[-1] if side>0 else idx[0])
    radius=abs(float(q[chosen]))
    return PeriodicSilhouetteSide(
        radius,float(amps[chosen]),float(scores[chosen]),float(floor),
        True,None,
    )


def estimate_periodic_silhouette_diameter(
    image_rgb: np.ndarray,
    profile,
    pitch_px: float,
    *,
    radial_step_px: float=0.25,
) -> PeriodicSilhouetteDiameter:
    if not np.isfinite(pitch_px) or pitch_px<3.0:
        empty=PeriodicSilhouetteSide(None,None,None,None,False,"invalid_pitch")
        return PeriodicSilhouetteDiameter(None,None,empty,empty,None,"none","invalid_pitch")
    s=np.asarray(profile.s_values[profile.sample_mask],dtype=np.float64)
    low=np.asarray(profile.low[profile.sample_mask],dtype=np.float64)
    high=np.asarray(profile.high[profile.sample_mask],dtype=np.float64)
    if len(s)<max(48,int(round(6*pitch_px))):
        empty=PeriodicSilhouetteSide(None,None,None,None,False,"thread_span_too_short")
        return PeriodicSilhouetteDiameter(None,None,empty,empty,None,"none","thread_span_too_short")

    axis=_robust_axis(s,0.5*(low+high))
    if axis is None:
        empty=PeriodicSilhouetteSide(None,None,None,None,False,"axis_fit_failed")
        return PeriodicSilhouetteDiameter(None,None,empty,empty,None,"none","axis_fit_failed")
    origin,slope,intercept,axis_rms=axis
    center_n=intercept+slope*(s-origin)
    coarse_radius=float(np.percentile(0.5*(high-low),90))
    extent=max(
        float(np.percentile(high-center_n,99)),
        float(np.percentile(center_n-low,99)),
        coarse_radius,
    )+8.0
    q=np.arange(-extent,extent+radial_step_px*0.5,radial_step_px)

    gray=cv2.cvtColor(np.asarray(image_rgb),cv2.COLOR_RGB2GRAY).astype(np.float32)
    base=(
        np.asarray(profile.center,dtype=np.float64)[None,:]
        +np.asarray(profile.axis,dtype=np.float64)[None,:]*s[:,None]
        +np.asarray(profile.normal,dtype=np.float64)[None,:]*center_n[:,None]
    )
    xy=base[:,None,:]+np.asarray(profile.normal,dtype=np.float64)[None,None,:]*q[None,:,None]
    xx=xy[:,:,0].astype(np.float32)
    yy=xy[:,:,1].astype(np.float32)
    if (
        np.min(xx)<1 or np.max(xx)>=gray.shape[1]-1
        or np.min(yy)<1 or np.max(yy)>=gray.shape[0]-1
    ):
        empty=PeriodicSilhouetteSide(None,None,None,None,False,"sample_grid_out_of_bounds")
        return PeriodicSilhouetteDiameter(None,None,empty,empty,axis_rms,"none",
                                          "sample_grid_out_of_bounds")
    samples=cv2.remap(
        gray,xx,yy,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT_101,
    ).astype(np.float64)
    amps,scores,_=_harmonic_stats(samples,s,float(pitch_px))
    positive=_outer_candidate(q,amps,scores,1,coarse_radius)
    negative=_outer_candidate(q,amps,scores,-1,coarse_radius)

    candidates=[]
    if positive.reliable and positive.radius_px is not None:
        candidates.append(("positive",2.0*positive.radius_px,positive))
    if negative.reliable and negative.radius_px is not None:
        candidates.append(("negative",2.0*negative.radius_px,negative))
    if not candidates:
        return PeriodicSilhouetteDiameter(
            None,None,positive,negative,axis_rms,"none",
            "periodic_silhouette_not_resolved",
        )
    if len(candidates)==2:
        dp,dn=candidates[0][1],candidates[1][1]
        if abs(dp-dn)<=max(2.0,0.06*max(dp,dn)):
            weights=np.array([
                max(candidates[0][2].t_score or 0.0,1.0),
                max(candidates[1][2].t_score or 0.0,1.0),
            ])
            value=float(np.average([dp,dn],weights=weights))
            disagreement=0.5*abs(dp-dn)
            uncertainty=max(axis_rms,disagreement,radial_step_px)
            return PeriodicSilhouetteDiameter(
                value,uncertainty,positive,negative,axis_rms,
                "bilateral_periodic_silhouette",None,
            )
        # One side can still be used if its periodic evidence is far stronger.
        pscore=positive.t_score or 0.0
        nscore=negative.t_score or 0.0
        if max(pscore,nscore)>=1.8*max(min(pscore,nscore),1e-6):
            chosen=candidates[0] if pscore>nscore else candidates[1]
            uncertainty=max(axis_rms*2.0,radial_step_px,0.5*abs(dp-dn))
            return PeriodicSilhouetteDiameter(
                chosen[1],uncertainty,positive,negative,axis_rms,
                f"single_{chosen[0]}_periodic_silhouette",None,
            )
        return PeriodicSilhouetteDiameter(
            None,None,positive,negative,axis_rms,"none",
            "side_radii_disagree",
        )
    chosen=candidates[0]
    # Single-side use relies on the contour-midline axis; keep its uncertainty
    # explicit rather than pretending the opposite silhouette was observed.
    uncertainty=max(2.0*axis_rms,radial_step_px)
    return PeriodicSilhouetteDiameter(
        chosen[1],uncertainty,positive,negative,axis_rms,
        f"single_{chosen[0]}_periodic_silhouette",None,
    )
