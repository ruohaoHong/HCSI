from __future__ import annotations

from dataclasses import dataclass
import math

import cv2
import numpy as np


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


def _background_difference_mask(image_rgb: np.ndarray) -> np.ndarray:
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
    threshold = max(14.0, median_distance + 6.0 * max(mad, 1.0))
    distance = np.linalg.norm(image_lab - background, axis=2)
    return (distance > threshold).astype(np.uint8) * 255


def _edge_mask(image_rgb: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 40, 120)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    return cv2.dilate(edges, kernel, iterations=1)


def _ruler_exclusion_mask(shape: tuple[int, int], mark_points_px: np.ndarray, px_per_cm: float) -> tuple[np.ndarray, float]:
    height, width = shape
    mask = np.zeros((height, width), dtype=np.uint8)
    if len(mark_points_px) < 2 or px_per_cm <= 0:
        return mask, 0.0
    radius_px = float(np.clip(px_per_cm * 1.7, 16.0, min(height, width) * 0.18))
    p0 = tuple(np.round(mark_points_px[0]).astype(int))
    p1 = tuple(np.round(mark_points_px[-1]).astype(int))
    cv2.line(mask, p0, p1, 255, thickness=max(1, int(round(radius_px * 2))))
    return mask, radius_px


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


def extract_object_geometry(image_rgb: np.ndarray, ruler_mark_points_px: np.ndarray, px_per_cm: float, ruler_direction: tuple[float, float] | None, max_alignment_deg: float = 20.0) -> ObjectGeometry:
    height, width = image_rgb.shape[:2]
    if height < 32 or width < 32:
        return ObjectGeometry(False, False, None, None, None, None, None, None, None, None, None, None, "border_lab+edges", ("image_too_small",))

    color_mask = _background_difference_mask(image_rgb)
    edge_mask = _edge_mask(image_rgb)
    foreground = cv2.bitwise_or(color_mask, edge_mask)
    exclusion, exclusion_radius = _ruler_exclusion_mask((height, width), ruler_mark_points_px, px_per_cm)
    foreground[exclusion > 0] = 0
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, close_kernel, iterations=2)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_OPEN, open_kernel, iterations=1)
    foreground[:2, :] = 0
    foreground[-2:, :] = 0
    foreground[:, :2] = 0
    foreground[:, -2:] = 0

    contours, _ = cv2.findContours(foreground, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    candidates: list[tuple[float, np.ndarray, float, float, bool]] = []
    image_area = float(height * width)
    for contour in contours:
        area = float(cv2.contourArea(contour))
        area_ratio = area / image_area
        if area_ratio < 0.0005 or area_ratio > 0.55:
            continue
        hull = cv2.convexHull(contour)
        hull_area = float(cv2.contourArea(hull))
        solidity = area / hull_area if hull_area > 0 else 0.0
        border = _touches_border(contour, width, height)
        score = area * max(0.2, min(solidity, 1.0)) * (0.55 if border else 1.0)
        candidates.append((score, contour, area_ratio, solidity, border))

    if not candidates:
        return ObjectGeometry(False, False, None, None, None, None, None, None, None, None, None, None, "border_lab+edges", ("object_contour_not_found",))

    _, contour, area_ratio, solidity, border = max(candidates, key=lambda item: item[0])
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
        major_axis, minor_axis = minor_axis, -major_axis

    rect = cv2.minAreaRect(contour)
    rect_w, rect_h = rect[1]
    min_area_length = float(max(rect_w, rect_h))
    min_area_width = float(min(rect_w, rect_h))
    angle = _angle_deg(major_axis)
    alignment = _axis_alignment_deg(major_axis, ruler_direction)
    reasons: list[str] = []
    if border:
        reasons.append("object_contour_touches_image_border")
    if solidity < 0.20:
        reasons.append("object_contour_low_solidity")
    if principal_length < 12 or principal_width < 2:
        reasons.append("object_geometry_too_small")
    if alignment is None:
        reasons.append("object_ruler_alignment_unknown")
    elif alignment > max_alignment_deg:
        reasons.append("object_not_parallel_to_ruler")

    if len(ruler_mark_points_px) >= 2 and exclusion_radius > 0:
        p0 = ruler_mark_points_px[0].astype(np.float64)
        p1 = ruler_mark_points_px[-1].astype(np.float64)
        line = p1 - p0
        line_norm = float(np.linalg.norm(line))
        if line_norm > 1e-6:
            offset = center - p0
            distance = abs(float(line[0] * offset[1] - line[1] * offset[0])) / line_norm
            if distance < exclusion_radius * 0.95:
                reasons.append("selected_contour_too_close_to_ruler")

    return ObjectGeometry(True, len(reasons) == 0, (float(center[0]), float(center[1])), float(cv2.contourArea(contour)), float(area_ratio), float(solidity), principal_length, principal_width, min_area_length, min_area_width, angle, alignment, "border_lab+edges", tuple(reasons))
