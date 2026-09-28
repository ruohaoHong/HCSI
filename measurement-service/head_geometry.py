from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from edge_observation import observe_edge
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



@dataclass(frozen=True)
class _BilateralHeadEdgeProfile:
    low: np.ndarray
    high: np.ndarray
    valid: np.ndarray
    positive_valid_fraction: float
    negative_valid_fraction: float
    bilateral_valid_fraction: float
    rescue_count: int


def _bilateral_raw_head_edges(
    image_rgb: np.ndarray,
    profile: ThreadedShankProfile,
    s: np.ndarray,
    coarse_low: np.ndarray,
    coarse_high: np.ndarray,
    t: np.ndarray,
    underface: HeadUnderfaceEstimate,
) -> _BilateralHeadEdgeProfile:
    """Observe the two physical head edges independently from source pixels.

    The segmentation contour is only a search prior.  If one contour side
    collapses inward while the opposite side remains head-sized, reflect the
    opposite radius around the bearing-region centerline *only to seed a raw
    edge search*.  A reflected coordinate is never accepted as a measurement
    unless source pixels independently support an object-to-background edge.
    """
    coarse_centers = (coarse_low + coarse_high) * 0.5
    center_reference = _band_median(coarse_centers, t, 0.05, 0.22)
    if not np.isfinite(center_reference):
        center_reference = float(np.median(coarse_centers))

    coarse_widths = coarse_high - coarse_low
    robust_width = float(np.percentile(coarse_widths, 90))
    half_length = float(np.clip(robust_width * 0.20, 8.0, 20.0))
    minimum_radius = max(2.0, underface.shank_outer_px * 0.42)

    raw_low = np.full(len(s), np.nan, dtype=np.float64)
    raw_high = np.full(len(s), np.nan, dtype=np.float64)
    positive_valid = np.zeros(len(s), dtype=bool)
    negative_valid = np.zeros(len(s), dtype=bool)
    rescue_count = 0

    for index, axial in enumerate(s):
        low = float(coarse_low[index])
        high = float(coarse_high[index])
        positive_radius = high - center_reference
        negative_radius = center_reference - low

        positive_seed = high
        negative_seed = low
        positive_rescue = (
            negative_radius > minimum_radius
            and positive_radius < 0.72 * negative_radius
        )
        negative_rescue = (
            positive_radius > minimum_radius
            and negative_radius < 0.72 * positive_radius
        )
        if positive_rescue:
            positive_seed = center_reference + negative_radius
        if negative_rescue:
            negative_seed = center_reference - positive_radius

        origin = profile.center + profile.axis * float(axial)
        for sign, seed, rescue in (
            (1.0, positive_seed, positive_rescue),
            (-1.0, negative_seed, negative_rescue),
        ):
            coarse_xy = origin + profile.normal * seed
            observation = observe_edge(
                image_rgb,
                coarse_xy,
                profile.normal * sign,
                half_length_px=half_length,
                min_contrast=6.0 if rescue else 10.0,
            )
            if not observation.valid:
                continue
            cross = float(
                np.dot(
                    np.asarray(observation.position_xy, dtype=np.float64)
                    - profile.center,
                    profile.normal,
                )
            )
            radius = (
                cross - center_reference
                if sign > 0
                else center_reference - cross
            )
            # Raw texture inside a knurled head is not an outer silhouette.
            if radius < minimum_radius:
                continue
            if sign > 0:
                raw_high[index] = cross
                positive_valid[index] = True
            else:
                raw_low[index] = cross
                negative_valid[index] = True
            if rescue:
                rescue_count += 1

    bilateral = positive_valid & negative_valid
    return _BilateralHeadEdgeProfile(
        low=raw_low,
        high=raw_high,
        valid=bilateral,
        positive_valid_fraction=float(np.mean(positive_valid)) if len(s) else 0.0,
        negative_valid_fraction=float(np.mean(negative_valid)) if len(s) else 0.0,
        bilateral_valid_fraction=float(np.mean(bilateral)) if len(s) else 0.0,
        rescue_count=rescue_count,
    )


def observe_head_profile(
    profile: ThreadedShankProfile,
    underface: HeadUnderfaceEstimate,
    boundary_source: str = "bearing_plane",
    image_rgb: np.ndarray | None = None,
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

    s_all = np.asarray(profile.s_values[indices], dtype=np.float64)
    low_all = np.asarray(profile.low[indices], dtype=np.float64)
    high_all = np.asarray(profile.high[indices], dtype=np.float64)
    widths_all = high_all - low_all
    centers_all = (low_all + high_all) * 0.5
    finite = (
        np.isfinite(s_all) & np.isfinite(widths_all)
        & np.isfinite(centers_all) & np.isfinite(low_all) & np.isfinite(high_all)
    )
    s_all = s_all[finite]
    low_all = low_all[finite]
    high_all = high_all[finite]
    widths_all = widths_all[finite]
    centers_all = centers_all[finite]
    if len(s_all) < 8:
        return unavailable_head_geometry("head_profile_samples_insufficient")

    distance_all = (s_all - underface.s) * toward_head
    positive = distance_all >= -1e-6
    s_all = s_all[positive]
    low_all = low_all[positive]
    high_all = high_all[positive]
    widths_all = widths_all[positive]
    centers_all = centers_all[positive]
    distance_all = distance_all[positive]
    if len(distance_all) < 8 or float(np.max(distance_all)) < 6.0:
        return unavailable_head_geometry("head_axial_span_insufficient")

    order = np.argsort(distance_all)
    s_all = s_all[order]
    low_all = low_all[order]
    high_all = high_all[order]
    widths_all = widths_all[order]
    centers_all = centers_all[order]
    distance_all = distance_all[order]
    head_height = float(distance_all[-1])
    t_all = np.clip(distance_all / head_height, 0.0, 1.0)

    raw_profile: _BilateralHeadEdgeProfile | None = None
    use_raw_profile = False
    if image_rgb is not None:
        raw_profile = _bilateral_raw_head_edges(
            image_rgb, profile, s_all, low_all, high_all, t_all, underface,
        )
        # Require broad two-sided support. Missing spans are not filled by
        # symmetry or contour interpolation merely to make a head "reliable".
        use_raw_profile = (
            raw_profile.bilateral_valid_fraction >= 0.58
            and int(np.count_nonzero(raw_profile.valid)) >= 12
        )

    if use_raw_profile and raw_profile is not None:
        support = raw_profile.valid
        distance = distance_all[support]
        widths = raw_profile.high[support] - raw_profile.low[support]
        centers = (raw_profile.high[support] + raw_profile.low[support]) * 0.5
        t = t_all[support]
        valid_fraction = raw_profile.bilateral_valid_fraction
    else:
        distance = distance_all
        widths = widths_all
        centers = centers_all
        t = t_all
        valid_fraction = float(np.mean(finite))
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
    if image_rgb is not None and raw_profile is not None:
        if not use_raw_profile:
            reasons.append("head_bilateral_edge_support_insufficient")
        elif (
            raw_profile.positive_valid_fraction < 0.72
            or raw_profile.negative_valid_fraction < 0.72
        ):
            reasons.append("head_bilateral_edge_side_sparse")
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
