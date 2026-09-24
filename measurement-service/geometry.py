from __future__ import annotations

from dataclasses import dataclass
import math

import cv2
import numpy as np

from semantic_regions import SemanticMasks, apply_semantic_constraints, build_semantic_masks


MIN_CONTOUR_EDGE_SUPPORT = 0.055
STRONG_PHYSICAL_BOUNDARY_SUPPORT = 0.12
MIN_OWNERSHIP_PRECISION = 0.60
RULER_MASK_CONTACT_TOLERANCE_PX = 2.0


@dataclass(frozen=True)
class ObjectGeometry:
    detected: bool
    contour_reliable: bool
    center_xy: tuple[float, float] | None
    contour_area_px: float | None
    contour_area_ratio: float | None
    solidity: float | None
    principal_length_px: float | None
    principal_width_px: float | None
    min_area_length_px: float | None
    min_area_width_px: float | None
    principal_angle_deg: float | None
    ruler_alignment_deg: float | None
    segmentation_method: str
    gate_reasons: tuple[str, ...]
    risk_signals: tuple[str, ...]


@dataclass(frozen=True)
class _Candidate:
    contour: np.ndarray
    score: float
    area_ratio: float
    solidity: float
    border: bool
    edge_support: float


@dataclass(frozen=True)
class _PhysicalContourSelection:
    candidate: _Candidate | None
    source: str
    exclusion_mask: np.ndarray
    exclusion_radius: float
    semantic_masks: SemanticMasks
    boundary_edge_support: float | None
    ownership_precision: float | None
    ownership_recall: float | None


def _background_distance(image_rgb: np.ndarray) -> tuple[np.ndarray, float]:
    height, width = image_rgb.shape[:2]
    side = max(4, int(min(height, width) * 0.08))
    corners = np.concatenate([
        image_rgb[:side, :side].reshape(-1, 3),
        image_rgb[:side, width - side :].reshape(-1, 3),
        image_rgb[height - side :, :side].reshape(-1, 3),
        image_rgb[height - side :, width - side :].reshape(-1, 3),
    ], axis=0).astype(np.uint8)
    image_lab = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    corner_lab = cv2.cvtColor(corners.reshape(-1, 1, 3), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    background = np.median(corner_lab, axis=0)
    corner_distance = np.linalg.norm(corner_lab - background, axis=1)
    median_distance = float(np.median(corner_distance))
    mad = float(np.median(np.abs(corner_distance - median_distance)))
    threshold = max(12.0, median_distance + 5.0 * max(mad, 1.0))
    distance = np.linalg.norm(image_lab - background, axis=2)
    return distance, threshold


def _raw_edge_mask(image_rgb: np.ndarray) -> np.ndarray:
    """Return the localized image-gradient boundary without tolerance dilation."""
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    return cv2.Canny(blurred, 35, 110)


def _edge_mask(image_rgb: np.ndarray) -> np.ndarray:
    """Return a tolerant boundary-support mask, not a geometry boundary."""
    edges = _raw_edge_mask(image_rgb)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    return cv2.dilate(edges, kernel, iterations=1)


def _normalize(vector: np.ndarray) -> np.ndarray | None:
    norm = float(np.linalg.norm(vector))
    if norm < 1e-6:
        return None
    return vector.astype(np.float64) / norm


def _segment_overlap_along_axis(
    a: np.ndarray,
    b: np.ndarray,
    origin: np.ndarray,
    axis: np.ndarray,
    expected_min: float,
    expected_max: float,
) -> float:
    s0 = float(np.dot(a - origin, axis))
    s1 = float(np.dot(b - origin, axis))
    lo, hi = sorted((s0, s1))
    overlap = max(0.0, min(hi, expected_max) - max(lo, expected_min))
    expected = max(expected_max - expected_min, 1.0)
    return overlap / expected


def _segment_reference_support(
    a: np.ndarray,
    b: np.ndarray,
    reference_mask: np.ndarray | None,
) -> float:
    if reference_mask is None:
        return 1.0
    height, width = reference_mask.shape[:2]
    samples = np.linspace(0.0, 1.0, 11)
    points = a[None, :] + (b - a)[None, :] * samples[:, None]
    xs = np.clip(np.rint(points[:, 0]).astype(np.int32), 0, width - 1)
    ys = np.clip(np.rint(points[:, 1]).astype(np.int32), 0, height - 1)
    return float(np.mean(reference_mask[ys, xs] > 0))


def _ruler_exclusion_mask(
    image_rgb: np.ndarray,
    mark_points_px: np.ndarray,
    px_per_cm: float,
    semantic_masks: SemanticMasks | None = None,
) -> tuple[np.ndarray, float]:
    height, width = image_rgb.shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)
    if len(mark_points_px) < 2 or px_per_cm <= 0:
        return mask, 0.0

    points = mark_points_px.astype(np.float64)
    p0 = points[0]
    p1 = points[-1]
    axis = _normalize(p1 - p0)
    if axis is None:
        return mask, 0.0
    normal = np.array([-axis[1], axis[0]], dtype=np.float64)
    center = np.mean(points, axis=0)
    projections = (points - center) @ axis
    span_min = float(np.min(projections))
    span_max = float(np.max(projections))
    mark_span = max(span_max - span_min, px_per_cm)

    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 45, 135)
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180.0,
        threshold=max(24, int(mark_span * 0.10)),
        minLineLength=max(24, int(mark_span * 0.30)),
        maxLineGap=max(10, int(px_per_cm * 0.35)),
    )

    max_offset = min(float(min(height, width)) * 0.24, px_per_cm * 3.2)
    offsets: list[tuple[float, float]] = []
    if lines is not None:
        for raw in lines[:, 0, :]:
            a = np.array([float(raw[0]), float(raw[1])])
            b = np.array([float(raw[2]), float(raw[3])])
            segment = b - a
            direction = _normalize(segment)
            if direction is None:
                continue
            cosine = float(np.clip(abs(np.dot(direction, axis)), 0.0, 1.0))
            angle = math.degrees(math.acos(cosine))
            if angle > 12.0:
                continue
            overlap = _segment_overlap_along_axis(a, b, center, axis, span_min, span_max)
            if overlap < 0.24:
                continue

            # The VLM reference box is a coarse ownership prior, not a ruler
            # edge detector. When it is trustworthy, reject long parallel lines
            # that live mostly outside the coarse ruler region. This prevents a
            # strong hardware edge from being paired with a true ruler edge.
            reference_mask = (
                semantic_masks.reference_exclusion_mask
                if semantic_masks is not None and semantic_masks.reference_applied
                else None
            )
            if reference_mask is not None and _segment_reference_support(a, b, reference_mask) < 0.35:
                continue

            midpoint = (a + b) * 0.5
            offset = float(np.dot(midpoint - center, normal))
            if abs(offset) > max_offset:
                continue
            length = float(np.linalg.norm(segment))
            strength = length * (0.5 + overlap)
            offsets.append((offset, strength))

    offsets.sort(key=lambda item: item[0])
    clusters: list[list[tuple[float, float]]] = []
    cluster_gap = max(3.0, px_per_cm * 0.10)
    for item in offsets:
        if not clusters or abs(item[0] - clusters[-1][-1][0]) > cluster_gap:
            clusters.append([item])
        else:
            clusters[-1].append(item)
    edge_offsets: list[tuple[float, float]] = []
    for cluster in clusters:
        weights = np.array([max(v[1], 1.0) for v in cluster], dtype=np.float64)
        values = np.array([v[0] for v in cluster], dtype=np.float64)
        edge_offsets.append((float(np.average(values, weights=weights)), float(np.sum(weights))))

    # Visual tick references are often anchored close to one physical ruler edge.
    # A long, parallel hardware edge can otherwise be paired with the opposite
    # ruler edge and create an exclusion band that cuts through the object.
    #
    # Estimate which side of the reference line contains ruler material by
    # probing a thin strip immediately on both sides. Only when this evidence is
    # strong do we constrain pair selection; ambiguous cases retain the previous
    # generic pair scoring for metric/RulerNet compatibility.
    body_distance, body_threshold = _background_distance(image_rgb)
    probe_offsets = (
        float(np.clip(px_per_cm * 0.035, 3.0, 7.0)),
        float(np.clip(px_per_cm * 0.065, 5.0, 12.0)),
    )
    sample_count = max(24, min(96, int(round(mark_span / 4.0))))
    sample_positions = np.linspace(span_min, span_max, sample_count)
    side_occupancy: dict[int, float] = {}
    for side in (-1, 1):
        occupancies: list[float] = []
        for probe in probe_offsets:
            coords = (
                center[None, :]
                + sample_positions[:, None] * axis[None, :]
                + float(side) * probe * normal[None, :]
            )
            xs = np.clip(np.rint(coords[:, 0]).astype(np.int32), 0, width - 1)
            ys = np.clip(np.rint(coords[:, 1]).astype(np.int32), 0, height - 1)
            occupancies.append(float(np.mean(body_distance[ys, xs] > body_threshold)))
        side_occupancy[side] = float(np.mean(occupancies))

    body_side: int | None = None
    negative_occupancy = side_occupancy[-1]
    positive_occupancy = side_occupancy[1]
    if (
        max(negative_occupancy, positive_occupancy) >= 0.55
        and abs(positive_occupancy - negative_occupancy) >= 0.25
    ):
        body_side = 1 if positive_occupancy > negative_occupancy else -1

    min_width = max(8.0, px_per_cm * 0.45)
    max_width = min(max_offset * 1.9, px_per_cm * 3.2)
    pair_candidates: list[tuple[float, float, float]] = []
    for i, (off_a, strength_a) in enumerate(edge_offsets):
        for off_b, strength_b in edge_offsets[i + 1 :]:
            body_width = abs(off_b - off_a)
            if body_width < min_width or body_width > max_width:
                continue
            lo, hi = sorted((off_a, off_b))
            distance_to_interval = 0.0 if lo <= 0.0 <= hi else min(abs(lo), abs(hi))
            if distance_to_interval > px_per_cm * 0.55:
                continue
            width_prior = 1.0 - min(abs(body_width / px_per_cm - 1.8) / 2.0, 0.65)
            score = (strength_a + strength_b) * width_prior
            pair_candidates.append((score, lo, hi))

    # If the near-reference strip clearly says the ruler body lies on one side,
    # prefer an edge pair with one edge anchored near the reference line and the
    # second edge extending into that same side. This rejects a nearby bolt edge
    # on the opposite side without hard-coding "ruler is below object".
    constrained_candidates: list[tuple[float, float, float]] = []
    if body_side is not None:
        anchor_tolerance = max(6.0, px_per_cm * 0.14)
        for candidate in pair_candidates:
            _, lo, hi = candidate
            if abs(lo) <= abs(hi):
                near_offset, far_offset = lo, hi
            else:
                near_offset, far_offset = hi, lo
            if (
                abs(near_offset) <= anchor_tolerance
                and body_side * far_offset > anchor_tolerance * 0.35
            ):
                constrained_candidates.append(candidate)

    pool = constrained_candidates or pair_candidates
    best_pair: tuple[float, float] | None = None
    if pool:
        _, low_offset, high_offset = max(pool, key=lambda item: item[0])
        best_pair = (low_offset, high_offset)

    extension = px_per_cm * 0.35
    if best_pair is not None:
        low_offset, high_offset = best_pair
        pad = float(np.clip(px_per_cm * 0.12, 3.0, 10.0))
        low_offset -= pad
        high_offset += pad
        effective_half_width = max(abs(low_offset), abs(high_offset))
    else:
        fallback_half_width = float(np.clip(px_per_cm * 0.42, 10.0, min(height, width) * 0.07))
        low_offset, high_offset = -fallback_half_width, fallback_half_width
        effective_half_width = fallback_half_width

    polygon = np.array([
        center + axis * (span_min - extension) + normal * low_offset,
        center + axis * (span_max + extension) + normal * low_offset,
        center + axis * (span_max + extension) + normal * high_offset,
        center + axis * (span_min - extension) + normal * high_offset,
    ], dtype=np.float64)
    polygon[:, 0] = np.clip(polygon[:, 0], 0, width - 1)
    polygon[:, 1] = np.clip(polygon[:, 1], 0, height - 1)
    cv2.fillConvexPoly(mask, np.round(polygon).astype(np.int32), 255)
    return mask, float(effective_half_width)


def _touches_border(contour: np.ndarray, width: int, height: int, margin: int = 3) -> bool:
    x, y, w, h = cv2.boundingRect(contour)
    return x <= margin or y <= margin or x + w >= width - margin or y + h >= height - margin


def _angle_deg(vector: np.ndarray) -> float:
    return math.degrees(math.atan2(float(vector[1]), float(vector[0]))) % 180.0


def _axis_alignment_deg(axis: np.ndarray, ruler_direction: tuple[float, float] | None) -> float | None:
    if ruler_direction is None:
        return None
    ruler = np.asarray(ruler_direction, dtype=np.float64)
    ruler_norm = np.linalg.norm(ruler)
    if ruler_norm < 1e-6:
        return None
    ruler /= ruler_norm
    axis = np.asarray(axis, dtype=np.float64)
    axis /= max(np.linalg.norm(axis), 1e-9)
    cosine = float(np.clip(abs(np.dot(axis, ruler)), 0.0, 1.0))
    return math.degrees(math.acos(cosine))


def _candidate_from_mask(mask: np.ndarray, edge_mask: np.ndarray, width: int, height: int) -> _Candidate | None:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    image_area = float(height * width)
    candidates: list[_Candidate] = []
    for contour in contours:
        area = float(cv2.contourArea(contour))
        area_ratio = area / image_area
        if area_ratio < 0.00045 or area_ratio > 0.50:
            continue
        hull = cv2.convexHull(contour)
        hull_area = float(cv2.contourArea(hull))
        solidity = area / hull_area if hull_area > 0 else 0.0
        border = _touches_border(contour, width, height)

        boundary = np.zeros((height, width), dtype=np.uint8)
        cv2.drawContours(boundary, [contour], -1, 255, thickness=2)
        boundary_pixels = int(np.count_nonzero(boundary))
        edge_support = float(np.count_nonzero(cv2.bitwise_and(edge_mask, boundary))) / max(boundary_pixels, 1)

        edge_factor = (0.06 + 3.5 * min(edge_support, 0.60)) ** 2
        solidity_factor = max(0.18, min(solidity, 1.0))
        border_factor = 0.45 if border else 1.0
        score = math.sqrt(max(area, 1.0)) * solidity_factor * edge_factor * border_factor
        candidates.append(_Candidate(contour, score, area_ratio, solidity, border, edge_support))

    if not candidates:
        return None
    # A border-touching contour can never produce trusted dimensions.  If a
    # complete internal candidate exists, prefer it even when a ruler remnant or
    # crop boundary creates a much larger foreground region.
    internal = [candidate for candidate in candidates if not candidate.border]
    pool = internal if internal else candidates
    return max(pool, key=lambda item: item.score)



def _contour_support_against_mask(
    contour: np.ndarray,
    support_mask: np.ndarray,
) -> tuple[float, float]:
    """Return ownership precision and recall for one closed contour.

    Color/background segmentation is treated only as interior ownership
    evidence. It does not define the physical boundary by itself.
    """
    height, width = support_mask.shape[:2]
    filled = np.zeros((height, width), dtype=np.uint8)
    cv2.drawContours(filled, [contour], -1, 255, thickness=-1)
    candidate_pixels = int(np.count_nonzero(filled))
    support_pixels = int(np.count_nonzero(support_mask))
    if candidate_pixels == 0 or support_pixels == 0:
        return 0.0, 0.0
    overlap = int(np.count_nonzero(cv2.bitwise_and(filled, support_mask)))
    return overlap / candidate_pixels, overlap / support_pixels


def _select_physical_object_candidate(
    image_rgb: np.ndarray,
    ruler_mark_points_px: np.ndarray,
    px_per_cm: float,
    semantic_vision: dict | None = None,
) -> _PhysicalContourSelection:
    """Fuse ownership and boundary evidence into one physical contour.

    The three LAB thresholds are not independent contour hypotheses. They vote
    only on which pixels plausibly belong to the object interior. Image edges
    supply the direct physical-boundary evidence. A strong edge contour is used
    when it is also supported by the ownership consensus; otherwise the
    consensus contour is the conservative fallback.
    """
    height, width = image_rgb.shape[:2]
    semantic_masks = build_semantic_masks(image_rgb.shape, semantic_vision)
    distance, base_threshold = _background_distance(image_rgb)
    raw_edges = _raw_edge_mask(image_rgb)
    edge_mask = _edge_mask(image_rgb)
    exclusion, exclusion_radius = _ruler_exclusion_mask(
        image_rgb,
        ruler_mark_points_px,
        px_per_cm,
        semantic_masks,
    )

    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    ownership_masks: list[np.ndarray] = []
    for factor in (0.82, 1.0, 1.22):
        mask = (distance > base_threshold * factor).astype(np.uint8) * 255
        mask[exclusion > 0] = 0
        mask = apply_semantic_constraints(mask, semantic_masks)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_kernel, iterations=2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, open_kernel, iterations=1)
        mask = apply_semantic_constraints(mask, semantic_masks)
        mask[:2, :] = 0
        mask[-2:, :] = 0
        mask[:, :2] = 0
        mask[:, -2:] = 0
        ownership_masks.append(mask)

    votes = np.zeros((height, width), dtype=np.uint8)
    for mask in ownership_masks:
        votes += (mask > 0).astype(np.uint8)
    ownership_consensus = (votes >= 2).astype(np.uint8) * 255

    # The central appearance mask is only a fallback boundary hypothesis.
    # The perturbed masks contribute ownership evidence, not three peer
    # geometries that can veto one another.
    appearance_candidate = _candidate_from_mask(
        ownership_masks[1],
        edge_mask,
        width,
        height,
    )
    if appearance_candidate is None:
        appearance_candidate = _candidate_from_mask(
            ownership_consensus,
            edge_mask,
            width,
            height,
        )

    # Boundary localization uses raw Canny edges. The dilated edge_mask above
    # is only for tolerant support scoring and must not inflate geometry.
    edge_region = raw_edges.copy()
    edge_region[exclusion > 0] = 0
    edge_region = apply_semantic_constraints(edge_region, semantic_masks)
    edge_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    edge_region = cv2.morphologyEx(edge_region, cv2.MORPH_CLOSE, edge_close, iterations=2)
    edge_region = apply_semantic_constraints(edge_region, semantic_masks)
    edge_region[:2, :] = 0
    edge_region[-2:, :] = 0
    edge_region[:, :2] = 0
    edge_region[:, -2:] = 0
    edge_candidate = _candidate_from_mask(edge_region, edge_mask, width, height)

    if appearance_candidate is not None:
        appearance_precision, appearance_recall = _contour_support_against_mask(
            appearance_candidate.contour,
            ownership_consensus,
        )
        # A closed appearance silhouette that is already directly supported by
        # image gradients is the preferred physical contour: it preserves the
        # complete object boundary without importing edge-map fragmentation.
        if appearance_candidate.edge_support >= STRONG_PHYSICAL_BOUNDARY_SUPPORT:
            return _PhysicalContourSelection(
                appearance_candidate,
                "appearance_boundary+edge_supported+ownership_consensus",
                exclusion,
                exclusion_radius,
                semantic_masks,
                appearance_candidate.edge_support,
                appearance_precision,
                appearance_recall,
            )
    else:
        appearance_precision = None
        appearance_recall = None

    if edge_candidate is not None:
        precision, recall = _contour_support_against_mask(
            edge_candidate.contour,
            ownership_consensus,
        )
        if (
            edge_candidate.edge_support >= STRONG_PHYSICAL_BOUNDARY_SUPPORT
            and precision >= MIN_OWNERSHIP_PRECISION
        ):
            return _PhysicalContourSelection(
                edge_candidate,
                "edge_boundary+ownership_consensus",
                exclusion,
                exclusion_radius,
                semantic_masks,
                edge_candidate.edge_support,
                precision,
                recall,
            )

    if appearance_candidate is not None:
        return _PhysicalContourSelection(
            appearance_candidate,
            "appearance_boundary+ownership_consensus",
            exclusion,
            exclusion_radius,
            semantic_masks,
            appearance_candidate.edge_support,
            appearance_precision,
            appearance_recall,
        )

    if edge_candidate is not None and edge_candidate.edge_support >= STRONG_PHYSICAL_BOUNDARY_SUPPORT:
        return _PhysicalContourSelection(
            edge_candidate,
            "edge_boundary_without_ownership",
            exclusion,
            exclusion_radius,
            semantic_masks,
            edge_candidate.edge_support,
            None,
            None,
        )

    return _PhysicalContourSelection(
        None,
        "none",
        exclusion,
        exclusion_radius,
        semantic_masks,
        None,
        None,
        None,
    )


def _geometry_from_contour(contour: np.ndarray) -> tuple[np.ndarray, np.ndarray, float, float, float, float]:
    points = contour[:, 0, :].astype(np.float64)
    center = points.mean(axis=0)
    centered = points - center
    covariance = np.cov(centered, rowvar=False)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    major_axis = eigenvectors[:, int(np.argmax(eigenvalues))]
    minor_axis = np.array([-major_axis[1], major_axis[0]], dtype=np.float64)
    major_projection = centered @ major_axis
    minor_projection = centered @ minor_axis
    principal_length = float(np.ptp(major_projection))
    principal_width = float(np.ptp(minor_projection))
    if principal_width > principal_length:
        principal_length, principal_width = principal_width, principal_length
        major_axis = minor_axis

    rect = cv2.minAreaRect(contour)
    rect_w, rect_h = rect[1]
    min_area_length = float(max(rect_w, rect_h))
    min_area_width = float(min(rect_w, rect_h))
    return center, major_axis, principal_length, principal_width, min_area_length, min_area_width


def _contour_distance_to_mask(contour: np.ndarray, mask: np.ndarray) -> float | None:
    if mask.size == 0 or not np.any(mask):
        return None

    height, width = mask.shape[:2]
    points = contour[:, 0, :].astype(np.int32)
    xs = np.clip(points[:, 0], 0, width - 1)
    ys = np.clip(points[:, 1], 0, height - 1)

    if np.any(mask[ys, xs] > 0):
        return 0.0

    # distanceTransform measures non-zero pixels to the nearest zero pixel.
    # Treat the ruler exclusion as zero so this is the actual contour-to-mask
    # gap rather than a symmetric approximation around the ruler tick line.
    free_space = (mask == 0).astype(np.uint8)
    distance = cv2.distanceTransform(free_space, cv2.DIST_L2, 5)
    return float(np.min(distance[ys, xs]))


def extract_object_geometry(
    image_rgb: np.ndarray,
    ruler_mark_points_px: np.ndarray,
    px_per_cm: float,
    ruler_direction: tuple[float, float] | None,
    max_alignment_deg: float = 20.0,
    semantic_vision: dict | None = None,
) -> ObjectGeometry:
    height, width = image_rgb.shape[:2]
    if height < 32 or width < 32:
        return ObjectGeometry(
            False, False, None, None, None, None, None, None, None, None,
            None, None, "physical_contour_evidence", ("image_too_small",), (),
        )

    selection = _select_physical_object_candidate(
        image_rgb,
        ruler_mark_points_px,
        px_per_cm,
        semantic_vision=semantic_vision,
    )
    semantic_masks = selection.semantic_masks
    method = "physical_contour_evidence:" + selection.source
    if semantic_masks.target_applied:
        method += "+semantic_roi"
    if semantic_masks.reference_applied:
        method += "+semantic_reference_exclusion"

    nominal = selection.candidate
    if nominal is None:
        return ObjectGeometry(
            False, False, None, None, None, None, None, None, None, None,
            None, None, method, ("object_contour_not_found",),
            tuple(dict.fromkeys(semantic_masks.risk_signals)),
        )

    contour = nominal.contour
    center, major_axis, principal_length, principal_width, min_area_length, min_area_width = _geometry_from_contour(contour)
    angle = _angle_deg(major_axis)
    alignment = _axis_alignment_deg(major_axis, ruler_direction)

    reasons: list[str] = []
    risks: list[str] = list(semantic_masks.risk_signals)
    if nominal.border:
        reasons.append("object_contour_touches_image_border")
    if nominal.solidity < 0.20:
        reasons.append("object_contour_low_solidity")
    if principal_length < 12 or principal_width < 2:
        reasons.append("object_geometry_too_small")
    if nominal.edge_support < MIN_CONTOUR_EDGE_SUPPORT:
        reasons.append("object_contour_weak_edge_support")

    # Reliability is now about the selected physical contour itself. Appearance
    # thresholds are interior-ownership evidence, not peer contours with veto
    # power over a boundary that is directly supported by image gradients.
    if selection.source == "edge_boundary_without_ownership":
        risks.append("object_ownership_support_unknown")

    if alignment is None:
        risks.append("object_ruler_alignment_unknown")
    elif alignment > max_alignment_deg:
        risks.append("object_ruler_alignment_large")

    if selection.exclusion_radius > 0:
        contour_ruler_gap = _contour_distance_to_mask(
            contour,
            selection.exclusion_mask,
        )
        if (
            contour_ruler_gap is not None
            and contour_ruler_gap <= RULER_MASK_CONTACT_TOLERANCE_PX
        ):
            reasons.append("selected_contour_too_close_to_ruler")

    return ObjectGeometry(
        True,
        len(reasons) == 0,
        (float(center[0]), float(center[1])),
        float(cv2.contourArea(contour)),
        float(nominal.area_ratio),
        float(nominal.solidity),
        principal_length,
        principal_width,
        min_area_length,
        min_area_width,
        angle,
        alignment,
        method,
        tuple(dict.fromkeys(reasons)),
        tuple(dict.fromkeys(risks)),
    )
