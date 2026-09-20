from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any

import cv2
import numpy as np


SEMANTIC_BOX_CONFIDENCE_THRESHOLD = 0.55
_ALLOWED_HEAD_STYLES = {
    "hex",
    "flat_countersunk",
    "pan",
    "button",
    "socket_cap",
    "round",
    "other",
    "unknown",
}


@dataclass(frozen=True)
class SemanticMasks:
    target_mask: np.ndarray | None
    reference_exclusion_mask: np.ndarray | None
    target_applied: bool
    reference_applied: bool
    overlap_ratio: float | None
    risk_signals: tuple[str, ...]


def _finite_number(value: Any, name: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not np.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    return float(value)


def _normalize_box(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object")

    present = value.get("present")
    if not isinstance(present, bool):
        raise ValueError(f"{name}.present must be boolean")

    confidence = _finite_number(value.get("confidence"), f"{name}.confidence")
    if confidence < 0.0 or confidence > 1.0:
        raise ValueError(f"{name}.confidence must be within 0..1")

    coords = {
        key: _finite_number(value.get(key), f"{name}.{key}")
        for key in ("x_min", "y_min", "x_max", "y_max")
    }
    if any(v < 0.0 or v > 1000.0 for v in coords.values()):
        raise ValueError(f"{name} coordinates must be within normalized 0..1000")

    if present:
        if coords["x_max"] - coords["x_min"] < 4.0 or coords["y_max"] - coords["y_min"] < 4.0:
            raise ValueError(f"{name} must have positive area")
    else:
        confidence = 0.0

    return {"present": present, "confidence": confidence, **coords}


def normalize_semantic_vision(value: Any) -> dict[str, Any]:
    if value is None:
        return {
            "target_region": {
                "present": False,
                "confidence": 0.0,
                "x_min": 0.0,
                "y_min": 0.0,
                "x_max": 0.0,
                "y_max": 0.0,
            },
            "reference_region": {
                "present": False,
                "confidence": 0.0,
                "x_min": 0.0,
                "y_min": 0.0,
                "x_max": 0.0,
                "y_max": 0.0,
            },
            "head_style": "unknown",
        }
    if not isinstance(value, dict):
        raise ValueError("semantic_vision must be a JSON object")

    head_style = value.get("head_style")
    if head_style not in _ALLOWED_HEAD_STYLES:
        raise ValueError("semantic_vision.head_style is unsupported")

    return {
        "target_region": _normalize_box(value.get("target_region"), "semantic_vision.target_region"),
        "reference_region": _normalize_box(value.get("reference_region"), "semantic_vision.reference_region"),
        "head_style": head_style,
    }


def parse_semantic_vision(raw: str | None) -> dict[str, Any]:
    if raw is None or not raw.strip():
        return normalize_semantic_vision(None)
    if len(raw.encode("utf-8")) > 8_000:
        raise ValueError("semantic_vision payload is too large")
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("semantic_vision is not valid JSON") from exc
    return normalize_semantic_vision(decoded)


def _pixel_rect(
    box: dict[str, Any],
    width: int,
    height: int,
    pad_x: int,
    pad_y: int,
) -> tuple[int, int, int, int]:
    x0 = int(np.floor(box["x_min"] / 1000.0 * width)) - pad_x
    y0 = int(np.floor(box["y_min"] / 1000.0 * height)) - pad_y
    x1 = int(np.ceil(box["x_max"] / 1000.0 * width)) + pad_x
    y1 = int(np.ceil(box["y_max"] / 1000.0 * height)) + pad_y
    x0 = int(np.clip(x0, 0, max(width - 1, 0)))
    y0 = int(np.clip(y0, 0, max(height - 1, 0)))
    x1 = int(np.clip(x1, x0 + 1, width))
    y1 = int(np.clip(y1, y0 + 1, height))
    return x0, y0, x1, y1


def _rect_mask(height: int, width: int, rect: tuple[int, int, int, int]) -> np.ndarray:
    x0, y0, x1, y1 = rect
    mask = np.zeros((height, width), dtype=np.uint8)
    mask[y0:y1, x0:x1] = 255
    return mask


def build_semantic_masks(
    image_shape: tuple[int, ...],
    semantic_vision: dict[str, Any] | None,
) -> SemanticMasks:
    height, width = int(image_shape[0]), int(image_shape[1])
    semantic = normalize_semantic_vision(semantic_vision)

    target = semantic["target_region"]
    reference = semantic["reference_region"]
    target_mask: np.ndarray | None = None
    reference_mask: np.ndarray | None = None
    target_applied = bool(
        target["present"] and target["confidence"] >= SEMANTIC_BOX_CONFIDENCE_THRESHOLD
    )
    reference_candidate = bool(
        reference["present"] and reference["confidence"] >= SEMANTIC_BOX_CONFIDENCE_THRESHOLD
    )

    if target_applied:
        pad_x = max(3, int(round(width * 0.015)))
        pad_y = max(3, int(round(height * 0.015)))
        target_mask = _rect_mask(
            height,
            width,
            _pixel_rect(target, width, height, pad_x, pad_y),
        )

    if reference_candidate:
        pad_x = max(2, int(round(width * 0.006)))
        pad_y = max(2, int(round(height * 0.006)))
        reference_mask = _rect_mask(
            height,
            width,
            _pixel_rect(reference, width, height, pad_x, pad_y),
        )

    overlap_ratio: float | None = None
    risk_signals: list[str] = []
    reference_applied = reference_mask is not None

    if target_mask is not None and reference_mask is not None:
        target_area = int(np.count_nonzero(target_mask))
        overlap = int(np.count_nonzero(cv2.bitwise_and(target_mask, reference_mask)))
        overlap_ratio = overlap / max(target_area, 1)

        # VLM boxes are semantic priors, not exact masks. If their coarse boxes
        # overlap heavily, deleting the whole reference box could erase the
        # hardware itself. Keep the target ROI but fall back to the calibrated
        # ruler-body exclusion for ownership inside the overlap.
        if overlap_ratio > 0.20:
            reference_mask = None
            reference_applied = False
            risk_signals.append("semantic_region_overlap_high")

    return SemanticMasks(
        target_mask=target_mask,
        reference_exclusion_mask=reference_mask,
        target_applied=target_applied,
        reference_applied=reference_applied,
        overlap_ratio=overlap_ratio,
        risk_signals=tuple(risk_signals),
    )


def apply_semantic_constraints(
    mask: np.ndarray,
    semantic_masks: SemanticMasks,
) -> np.ndarray:
    constrained = mask.copy()
    if semantic_masks.target_mask is not None:
        constrained[semantic_masks.target_mask == 0] = 0
    if semantic_masks.reference_exclusion_mask is not None:
        constrained[semantic_masks.reference_exclusion_mask > 0] = 0
    return constrained
