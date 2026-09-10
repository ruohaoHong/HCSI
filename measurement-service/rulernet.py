from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

MODEL_SIZE = 768
MIN_MARKS = 4


@dataclass(frozen=True)
class PreprocessTransform:
    scale: float
    top: int
    left: int
    original_height: int
    original_width: int


@dataclass(frozen=True)
class RulerObservation:
    detected: bool
    mark_points_px: np.ndarray
    median_px_per_cm: float | None
    perspective_ratio: float | None
    direction_xy: tuple[float, float] | None
    gate_reasons: tuple[str, ...]


def preprocess_rgb(image_rgb: np.ndarray) -> tuple[np.ndarray, PreprocessTransform]:
    if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
        raise ValueError("expected RGB image with shape HxWx3")

    height, width = image_rgb.shape[:2]
    scale = min(MODEL_SIZE / width, MODEL_SIZE / height)
    new_width = max(1, int(width * scale))
    new_height = max(1, int(height * scale))
    resized = np.asarray(Image.fromarray(image_rgb).resize((new_width, new_height), Image.Resampling.BILINEAR), dtype=np.float32) / 255.0
    canvas = np.zeros((MODEL_SIZE, MODEL_SIZE, 3), dtype=np.float32)
    top = (MODEL_SIZE - new_height) // 2
    left = (MODEL_SIZE - new_width) // 2
    canvas[top : top + new_height, left : left + new_width] = resized
    tensor = np.transpose(canvas, (2, 0, 1))[None].astype(np.float32)
    return tensor, PreprocessTransform(scale, top, left, height, width)


def outward_cumsum(initial_point: np.ndarray, line_direction: np.ndarray, spacings: np.ndarray, n: np.ndarray) -> np.ndarray:
    left_spacings = spacings[n < 0][::-1]
    right_spacings = spacings[n >= 0]
    left_increments = -np.expand_dims(left_spacings, axis=1) * line_direction
    right_increments = np.expand_dims(right_spacings, axis=1) * line_direction
    zero = np.zeros((1, 2), dtype=initial_point.dtype)
    left_cumulative = np.cumsum(np.vstack([zero, left_increments]), axis=0)
    right_cumulative = np.cumsum(np.vstack([zero, right_increments]), axis=0)
    left_points = initial_point + left_cumulative
    right_points = initial_point + right_cumulative
    return np.vstack([left_points[::-1], right_points[1:]])


def reconstruct_processed_marks(initial_point: np.ndarray, dist: float, ratio: float, direction: np.ndarray, points_info: np.ndarray) -> np.ndarray:
    if not np.isfinite(dist) or dist <= 0 or not np.isfinite(ratio) or ratio <= 0:
        return np.empty((0, 2), dtype=np.float32)
    direction = np.asarray(direction, dtype=np.float64)
    norm = float(np.linalg.norm(direction))
    if not np.isfinite(norm) or norm < 1e-6:
        return np.empty((0, 2), dtype=np.float32)
    direction = direction / norm
    points_info = np.asarray(points_info, dtype=np.float64).reshape(-1)
    if len(points_info) < 5:
        return np.empty((0, 2), dtype=np.float32)
    num_points = max(0, int(points_info[0]))
    min_x, min_y, max_x, max_y = points_info[1:5]
    n = np.arange(-num_points, num_points + 1)
    spacings = (ratio**n) * dist
    points = outward_cumsum(np.asarray(initial_point, dtype=np.float64).reshape(2), direction, spacings, n)
    within = (points[:, 0] >= min_x) & (points[:, 0] <= max_x) & (points[:, 1] >= min_y) & (points[:, 1] <= max_y)
    return points[within].astype(np.float32)


def map_marks_to_original(points: np.ndarray, transform: PreprocessTransform) -> np.ndarray:
    if points.size == 0:
        return np.empty((0, 2), dtype=np.float32)
    mapped = points.astype(np.float64).copy()
    mapped[:, 0] = (mapped[:, 0] - transform.left) / transform.scale
    mapped[:, 1] = (mapped[:, 1] - transform.top) / transform.scale
    inside = (mapped[:, 0] >= 0) & (mapped[:, 0] < transform.original_width) & (mapped[:, 1] >= 0) & (mapped[:, 1] < transform.original_height)
    return mapped[inside].astype(np.float32)


def median_px_per_cm(mark_points_px: np.ndarray) -> float | None:
    if len(mark_points_px) < 2:
        return None
    spacings = np.linalg.norm(np.diff(mark_points_px.astype(np.float64), axis=0), axis=1)
    spacings = spacings[np.isfinite(spacings) & (spacings > 0)]
    return None if len(spacings) == 0 else float(np.median(spacings))


def local_px_per_cm(mark_points_px: np.ndarray, target_xy: tuple[float, float]) -> float | None:
    if len(mark_points_px) < 2:
        return None
    p0 = mark_points_px[:-1].astype(np.float64)
    p1 = mark_points_px[1:].astype(np.float64)
    mids = (p0 + p1) / 2.0
    spacings = np.linalg.norm(p1 - p0, axis=1)
    target = np.asarray(target_xy, dtype=np.float64)
    order = np.argsort(np.linalg.norm(mids - target, axis=1))
    selected = spacings[order[: min(3, len(order))]]
    selected = selected[np.isfinite(selected) & (selected > 0)]
    return None if len(selected) == 0 else float(np.median(selected))


def perspective_step_pct(ratio: float | None) -> float | None:
    if ratio is None or not np.isfinite(ratio) or ratio <= 0:
        return None
    symmetric_ratio = max(float(ratio), 1.0 / float(ratio))
    return (symmetric_ratio - 1.0) * 100.0


@lru_cache(maxsize=1)
def _load_session():
    import onnxruntime as ort
    configured = os.environ.get("RULERNET_MODEL_PATH", "").strip()
    if configured:
        model_path = Path(configured)
        if not model_path.is_file():
            raise RuntimeError(f"RULERNET_MODEL_PATH does not exist: {model_path}")
    else:
        allow_download = os.environ.get("RULERNET_ALLOW_NONCOMMERCIAL_DOWNLOAD", "").lower()
        if allow_download not in {"1", "true", "yes"}:
            raise RuntimeError("RulerNet model is not configured. Set RULERNET_MODEL_PATH or explicitly enable the PoC model download.")
        from huggingface_hub import hf_hub_download
        model_path = Path(hf_hub_download(repo_id="ymp5078/RulerNet", filename="model.onnx"))
    return ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])


def infer_ruler(image_rgb: np.ndarray) -> RulerObservation:
    tensor, transform = preprocess_rgb(image_rgb)
    session = _load_session()
    outputs = session.run(None, {"input": tensor})
    if len(outputs) < 5:
        raise RuntimeError("unexpected RulerNet ONNX output count")
    initial_point = np.asarray(outputs[0][0]).reshape(2)
    dist = float(np.asarray(outputs[1][0]).reshape(-1)[0])
    ratio = float(np.asarray(outputs[2][0]).reshape(-1)[0])
    direction = np.asarray(outputs[3][0]).reshape(2)
    points_info = np.asarray(outputs[4][0]).reshape(-1)
    processed_marks = reconstruct_processed_marks(initial_point, dist, ratio, direction, points_info)
    original_marks = map_marks_to_original(processed_marks, transform)
    scale = median_px_per_cm(original_marks)
    reasons: list[str] = []
    if len(original_marks) < MIN_MARKS:
        reasons.append("ruler_marks_insufficient")
    if scale is None or not np.isfinite(scale) or scale <= 0:
        reasons.append("ruler_scale_invalid")
    direction_norm = float(np.linalg.norm(direction))
    direction_xy: tuple[float, float] | None = None
    if direction_norm > 1e-6 and np.isfinite(direction_norm):
        unit = direction / direction_norm
        direction_xy = (float(unit[0]), float(unit[1]))
    else:
        reasons.append("ruler_direction_invalid")
    return RulerObservation(detected=len(reasons) == 0, mark_points_px=original_marks, median_px_per_cm=scale, perspective_ratio=ratio if np.isfinite(ratio) and ratio > 0 else None, direction_xy=direction_xy, gate_reasons=tuple(reasons))
