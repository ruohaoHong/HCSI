from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from thread_geometry import HeadUnderfaceEstimate, ThreadedShankProfile


@dataclass(frozen=True)
class HeadProfilePoint:
    axial_fraction: float
    width_ratio: float
    center_offset_ratio: float


@dataclass(frozen=True)
class HeadGeometryObservation:
    status: str
    quality: str
    reason_codes: tuple[str, ...]
    boundary_source: str
    sample_count: int
    head_height_px: float | None
    head_width_p90_px: float | None
    shank_width_px: float | None
    height_to_width: float | None
    bearing_width_ratio: float | None
    mid_width_ratio: float | None
    top_width_ratio: float | None
    max_width_position: float | None
    width_trend: float | None
    centerline_drift_ratio: float | None
    profile_roughness: float | None
    length_convention_evidence: str
    profile_points: tuple[HeadProfilePoint, ...]

    def to_dict(self) -> dict[str, Any]:
        def rounded(value: float | None, digits: int = 4) -> float | None:
            return None if value is None else round(float(value), digits)

        return {
            "status": self.status,
            "quality": self.quality,
            "reason_codes": list(self.reason_codes),
            "boundary_source": self.boundary_source,
            "sample_count": self.sample_count,
            "head_height_px": rounded(self.head_height_px, 3),
            "head_width_p90_px": rounded(self.head_width_p90_px, 3),
            "shank_width_px": rounded(self.shank_width_px, 3),
            "height_to_width": rounded(self.height_to_width),
            "bearing_width_ratio": rounded(self.bearing_width_ratio),
            "mid_width_ratio": rounded(self.mid_width_ratio),
            "top_width_ratio": rounded(self.top_width_ratio),
            "max_width_position": rounded(self.max_width_position),
            "width_trend": rounded(self.width_trend),
            "centerline_drift_ratio": rounded(self.centerline_drift_ratio),
            "profile_roughness": rounded(self.profile_roughness),
            "length_convention_evidence": self.length_convention_evidence,
            "profile_points": [
                {
                    "axial_fraction": rounded(point.axial_fraction),
                    "width_ratio": rounded(point.width_ratio),
                    "center_offset_ratio": rounded(point.center_offset_ratio),
                }
                for point in self.profile_points
            ],
        }


def unavailable_head_geometry(reason: str) -> HeadGeometryObservation:
    return HeadGeometryObservation(
        status="not_measured",
        quality="unusable",
        reason_codes=(reason,),
        boundary_source="unavailable",
        sample_count=0,
        head_height_px=None,
        head_width_p90_px=None,
        shank_width_px=None,
        height_to_width=None,
        bearing_width_ratio=None,
        mid_width_ratio=None,
        top_width_ratio=None,
        max_width_position=None,
        width_trend=None,
        centerline_drift_ratio=None,
        profile_roughness=None,
        length_convention_evidence="unknown",
        profile_points=(),
    )


def _band_median(values: np.ndarray, t: np.ndarray, start: float, end: float) -> float:
    selected = values[(t >= start) & (t <= end)]
    if len(selected) == 0:
        return float("nan")
    return float(np.median(selected))


def observe_head_profile(
    profile: ThreadedShankProfile,
    underface: HeadUnderfaceEstimate,
    boundary_source: str = "bearing_plane",
) -> HeadGeometryObservation:
    """Describe the observed side silhouette without assigning a catalogue head.

    The returned profile is normalized by its observed p90 width. It is useful
    as a physical constraint, but deliberately does not claim that a single
    side view uniquely distinguishes visually similar head styles.
    """
    toward_head = 1 if profile.transition_s > profile.tip_s else -1
    head_mask = (
        profile.s_values >= underface.s
        if toward_head > 0
        else profile.s_values <= underface.s
    )
    indices = np.flatnonzero(head_mask)
    if toward_head < 0:
        indices = indices[::-1]
    if len(indices) < 8:
        return unavailable_head_geometry("head_profile_samples_insufficient")

    s = np.asarray(profile.s_values[indices], dtype=np.float64)
    widths = np.asarray(profile.widths[indices], dtype=np.float64)
    centers = (
        np.asarray(profile.low[indices], dtype=np.float64)
        + np.asarray(profile.high[indices], dtype=np.float64)
    ) * 0.5
    finite = np.isfinite(s) & np.isfinite(widths) & np.isfinite(centers)
    valid_fraction = float(np.mean(finite))
    s = s[finite]
    widths = widths[finite]
    centers = centers[finite]
    if len(s) < 8:
        return unavailable_head_geometry("head_profile_samples_insufficient")

    distance = (s - underface.s) * toward_head
    positive = distance >= -1e-6
    distance = distance[positive]
    widths = widths[positive]
    centers = centers[positive]
    if len(distance) < 8 or float(np.max(distance)) < 6.0:
        return unavailable_head_geometry("head_axial_span_insufficient")

    order = np.argsort(distance)
    distance = distance[order]
    widths = widths[order]
    centers = centers[order]
    head_height = float(distance[-1])
    t = np.clip(distance / head_height, 0.0, 1.0)
    width_p90 = float(np.percentile(widths, 90))
    if width_p90 <= 1.0 or width_p90 < 1.18 * underface.shank_outer_px:
        return unavailable_head_geometry("head_not_separable_from_shank")

    # A narrow median filter suppresses pixel stair-steps but preserves the
    # gross silhouette used to distinguish countersunk vs protruding evidence.
    kernel = max(3, min(9, (len(widths) // 10) * 2 + 1))
    radius = kernel // 2
    padded = np.pad(widths, radius, mode="edge")
    smooth = np.asarray(
        [np.median(padded[index : index + kernel]) for index in range(len(widths))],
        dtype=np.float64,
    )
    normalized = smooth / width_p90
    center_reference = _band_median(centers, t, 0.05, 0.30)
    center_offset = (centers - center_reference) / width_p90

    bearing_ratio = _band_median(normalized, t, 0.05, 0.22)
    mid_ratio = _band_median(normalized, t, 0.40, 0.62)
    top_ratio = _band_median(normalized, t, 0.78, 0.94)
    if not np.all(np.isfinite([bearing_ratio, mid_ratio, top_ratio])):
        return unavailable_head_geometry("head_profile_bands_incomplete")

    max_width_position = float(t[int(np.argmax(smooth))])
    width_trend = float(np.polyfit(t, normalized, 1)[0])
    center_drift = float(np.percentile(np.abs(center_offset), 90))
    if len(normalized) >= 3:
        roughness = float(np.median(np.abs(np.diff(normalized, n=2))))
    else:
        roughness = float("inf")

    convention = "ambiguous"
    # Countersunk heads grow from a shank-sized bearing end toward their widest
    # visible top. Protruding heads already own a broad bearing footprint.
    if bearing_ratio <= 0.74 and top_ratio >= 0.84 and width_trend >= 0.08:
        convention = "countersunk"
    elif bearing_ratio >= 0.78:
        convention = "protruding"

    reasons: list[str] = []
    if valid_fraction < 0.95:
        reasons.append("head_profile_has_gaps")
    if len(widths) < 12:
        reasons.append("head_profile_samples_limited")
    if center_drift > 0.18:
        reasons.append("head_profile_centerline_drift")
    if roughness > 0.12:
        reasons.append("head_profile_rough")
    if boundary_source == "coarse_transition" and convention != "countersunk":
        reasons.append("head_bearing_plane_unresolved")
    quality = "reliable" if not reasons else "degraded"

    sample_t = np.linspace(0.08, 0.92, 9)
    points = tuple(
        HeadProfilePoint(
            axial_fraction=float(position),
            width_ratio=float(np.interp(position, t, normalized)),
            center_offset_ratio=float(np.interp(position, t, center_offset)),
        )
        for position in sample_t
    )
    return HeadGeometryObservation(
        status="measured",
        quality=quality,
        reason_codes=tuple(reasons),
        boundary_source=boundary_source,
        sample_count=int(len(widths)),
        head_height_px=head_height,
        head_width_p90_px=width_p90,
        shank_width_px=float(underface.shank_outer_px),
        height_to_width=head_height / width_p90,
        bearing_width_ratio=bearing_ratio,
        mid_width_ratio=mid_ratio,
        top_width_ratio=top_ratio,
        max_width_position=max_width_position,
        width_trend=width_trend,
        centerline_drift_ratio=center_drift,
        profile_roughness=roughness,
        length_convention_evidence=convention,
        profile_points=points,
    )
