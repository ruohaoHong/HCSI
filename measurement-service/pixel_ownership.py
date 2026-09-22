from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np


@dataclass(frozen=True)
class SemanticVisionHint:
    object_box: tuple[float, float, float, float]
    reference_box: tuple[float, float, float, float] | None
    head_style: str
    confidence: float


def _normalized_box(value: Any) -> tuple[float, float, float, float] | None:
    if not isinstance(value, dict):
        return None
    try:
        x0 = float(value["x_min"])
        y0 = float(value["y_min"])
        x1 = float(value["x_max"])
        y1 = float(value["y_max"])
    except (KeyError, TypeError, ValueError):
        return None
    values = np.asarray([x0, y0, x1, y1], dtype=np.float64)
    if not np.all(np.isfinite(values)):
        return None
    x0, y0, x1, y1 = [float(np.clip(v, 0.0, 1.0)) for v in values]
    if x1 - x0 < 0.02 or y1 - y0 < 0.02:
        return None
    return x0, y0, x1, y1


def parse_semantic_vision_hint(value: Any) -> SemanticVisionHint | None:
    if not isinstance(value, dict):
        return None
    object_box = _normalized_box(value.get("object_box"))
    if object_box is None:
        return None

    reference_present = bool(value.get("reference_present", False))
    reference_box = _normalized_box(value.get("reference_box")) if reference_present else None
    head_style = str(value.get("head_style", "unknown")).strip() or "unknown"
    try:
        confidence = float(value.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = float(np.clip(confidence, 0.0, 1.0))
    return SemanticVisionHint(
        object_box=object_box,
        reference_box=reference_box,
        head_style=head_style,
        confidence=confidence,
    )


def _pixel_box(
    box: tuple[float, float, float, float],
    width: int,
    height: int,
    padding_fraction: float = 0.0,
) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = box
    pad_x = (x1 - x0) * padding_fraction
    pad_y = (y1 - y0) * padding_fraction
    x0 = float(np.clip(x0 - pad_x, 0.0, 1.0))
    y0 = float(np.clip(y0 - pad_y, 0.0, 1.0))
    x1 = float(np.clip(x1 + pad_x, 0.0, 1.0))
    y1 = float(np.clip(y1 + pad_y, 0.0, 1.0))
    return (
        int(np.floor(x0 * width)),
        int(np.floor(y0 * height)),
        int(np.ceil(x1 * width)),
        int(np.ceil(y1 * height)),
    )


def semantic_overlap_ratio(hint: SemanticVisionHint) -> float:
    if hint.reference_box is None:
        return 0.0
    ax0, ay0, ax1, ay1 = hint.object_box
    bx0, by0, bx1, by1 = hint.reference_box
    ix = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    iy = max(0.0, min(ay1, by1) - max(ay0, by0))
    intersection = ix * iy
    object_area = max((ax1 - ax0) * (ay1 - ay0), 1e-9)
    return intersection / object_area


def build_semantic_masks(
    image_shape: tuple[int, ...],
    hint: SemanticVisionHint | None,
) -> tuple[np.ndarray | None, np.ndarray | None, dict[str, float | str]]:
    if hint is None:
        return None, None, {}

    height, width = image_shape[:2]
    object_mask = np.zeros((height, width), dtype=np.uint8)
    x0, y0, x1, y1 = _pixel_box(hint.object_box, width, height, padding_fraction=0.08)
    cv2.rectangle(object_mask, (x0, y0), (max(x0, x1 - 1), max(y0, y1 - 1)), 255, thickness=-1)

    reference_mask = np.zeros((height, width), dtype=np.uint8)
    if hint.reference_box is not None:
        rx0, ry0, rx1, ry1 = _pixel_box(hint.reference_box, width, height, padding_fraction=0.04)
        cv2.rectangle(reference_mask, (rx0, ry0), (max(rx0, rx1 - 1), max(ry0, ry1 - 1)), 255, thickness=-1)

    diagnostics: dict[str, float | str] = {
        "semantic_confidence": round(hint.confidence, 3),
        "semantic_head_style": hint.head_style,
        "semantic_object_reference_overlap": round(semantic_overlap_ratio(hint), 4),
    }
    return object_mask, reference_mask, diagnostics


def constrain_foreground_mask(
    foreground: np.ndarray,
    object_mask: np.ndarray | None,
    reference_mask: np.ndarray | None,
) -> np.ndarray:
    constrained = foreground.copy()
    if object_mask is not None:
        constrained[object_mask == 0] = 0
    if reference_mask is not None:
        constrained[reference_mask > 0] = 0
    return constrained
