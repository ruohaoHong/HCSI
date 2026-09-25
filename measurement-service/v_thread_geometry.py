"""Geometry-only reconstruction for unresolved 60-degree V-thread crests.

When optical blur removes the major-crest apex, a stable apparent silhouette can
represent a pitch-line diameter more reliably than the major diameter itself.
For the ISO/Unified basic 60-degree V profile, major diameter D and basic pitch
Diameter E satisfy D - E = 3H/4 = 0.649519... * P.

This module never chooses a nominal screw size.  It only applies the V-thread
geometry to an externally justified pitch-diameter proxy and an image-measured
pitch.  Callers must not use this fallback when crisp major crests are directly
observable.
"""
from __future__ import annotations

from dataclasses import dataclass
import math


@dataclass(frozen=True)
class VThreadMajorEstimate:
    pitch_diameter_proxy_px: float | None
    pitch_px: float | None
    correction_px: float | None
    major_diameter_px: float | None
    uncertainty_px: float | None
    included_angle_deg: float
    reliable: bool
    reason: str | None


def major_minus_pitch_factor(included_angle_deg: float = 60.0) -> float:
    """Return (D-E)/P for a symmetric basic V-thread profile."""
    angle = float(included_angle_deg)
    if not (20.0 <= angle <= 120.0):
        raise ValueError("included_angle_deg must be between 20 and 120 degrees")
    half = math.radians(angle * 0.5)
    # Fundamental triangle H=(P/2)cot(theta/2); basic pitch line is 3H/8
    # radially below the major crest, therefore D-E = 2*(3H/8)=3H/4.
    return 0.375 / math.tan(half)


def estimate_major_from_pitch_diameter(
    pitch_diameter_proxy_px: float,
    pitch_px: float,
    *,
    proxy_uncertainty_px: float = 0.0,
    pitch_uncertainty_px: float = 0.0,
    included_angle_deg: float = 60.0,
) -> VThreadMajorEstimate:
    proxy = float(pitch_diameter_proxy_px)
    pitch = float(pitch_px)
    if not math.isfinite(proxy) or proxy <= 2.0:
        return VThreadMajorEstimate(None, pitch, None, None, None,
                                    included_angle_deg, False,
                                    "invalid_pitch_diameter_proxy")
    if not math.isfinite(pitch) or pitch < 2.0:
        return VThreadMajorEstimate(proxy, None, None, None, None,
                                    included_angle_deg, False, "invalid_pitch")
    factor = major_minus_pitch_factor(included_angle_deg)
    correction = factor * pitch
    major = proxy + correction
    proxy_u = max(0.0, float(proxy_uncertainty_px))
    pitch_u = max(0.0, float(pitch_uncertainty_px))
    uncertainty = math.hypot(proxy_u, factor * pitch_u)
    return VThreadMajorEstimate(
        pitch_diameter_proxy_px=proxy,
        pitch_px=pitch,
        correction_px=correction,
        major_diameter_px=major,
        uncertainty_px=uncertainty,
        included_angle_deg=float(included_angle_deg),
        reliable=True,
        reason=None,
    )
