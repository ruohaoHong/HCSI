"""Experimental screw thread geometry benchmark.

This script is intentionally NOT imported by the HCSI app.
It estimates scale-invariant P/D from a manually selected threaded-shaft ROI.
The first goal is reproducibility, not production robustness.

Dependencies:
    pip install opencv-python numpy scipy

Usage:
    python measure.py image.jpg --roi x1,y1,x2,y2

The algorithm does not accept or use a screw-size label while measuring.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, asdict
from pathlib import Path

import cv2
import numpy as np
from scipy.signal import find_peaks


@dataclass
class Measurement:
    image: str
    roi: tuple[int, int, int, int]
    axis_angle_deg: float
    pitch_px_median: float
    pitch_px_mad: float
    crest_diameter_px_median: float
    crest_diameter_px_mad: float
    p_over_d: float
    pitch_intervals_px: list[float]
    crest_diameters_px: list[float]


def mad(values: np.ndarray) -> float:
    values = np.asarray(values, dtype=float)
    if values.size == 0:
        return float("nan")
    med = np.median(values)
    return float(np.median(np.abs(values - med)))


def rotate_bound(image: np.ndarray, angle_deg: float) -> np.ndarray:
    h, w = image.shape[:2]
    center = (w / 2.0, h / 2.0)
    m = cv2.getRotationMatrix2D(center, angle_deg, 1.0)
    cos = abs(m[0, 0])
    sin = abs(m[0, 1])
    nw = int(h * sin + w * cos)
    nh = int(h * cos + w * sin)
    m[0, 2] += nw / 2 - center[0]
    m[1, 2] += nh / 2 - center[1]
    return cv2.warpAffine(image, m, (nw, nh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def estimate_axis_angle(gray: np.ndarray) -> float:
    edges = cv2.Canny(gray, 50, 150)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=45, minLineLength=max(30, gray.shape[0] // 4), maxLineGap=12)
    if lines is None:
        return 0.0

    angles = []
    weights = []
    for line in lines[:, 0]:
        x1, y1, x2, y2 = map(float, line)
        dx, dy = x2 - x1, y2 - y1
        length = float(np.hypot(dx, dy))
        if length <= 0:
            continue
        angle = np.degrees(np.arctan2(dy, dx))
        # Keep lines roughly parallel to a vertical screw shaft.
        vertical_distance = abs(abs(angle) - 90.0)
        if vertical_distance <= 35.0:
            angles.append(angle)
            weights.append(length)

    if not angles:
        return 0.0

    # Convert observed shaft angle to the rotation needed for vertical alignment.
    angle = float(np.average(np.asarray(angles), weights=np.asarray(weights)))
    return 90.0 - angle


def central_component_mask(gray: np.ndarray) -> np.ndarray:
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    # Otsu is deliberately global and label-agnostic for the first benchmark.
    _, mask = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # If the background is brighter than the object, invert based on central-vs-corner occupancy.
    h, w = mask.shape
    center = mask[h // 4: 3 * h // 4, w // 4: 3 * w // 4]
    corners = np.concatenate([
        mask[: h // 5, : w // 5].ravel(),
        mask[: h // 5, -w // 5:].ravel(),
        mask[-h // 5:, : w // 5].ravel(),
        mask[-h // 5:, -w // 5:].ravel(),
    ])
    if center.mean() < corners.mean():
        mask = 255 - mask

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    return mask


def extract_boundaries(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    h, w = mask.shape
    cx = w / 2.0
    ys, lefts, rights = [], [], []

    for y in range(h):
        xs = np.flatnonzero(mask[y] > 0)
        if xs.size < 2:
            continue

        # Split foreground into contiguous runs and prefer a broad run near the ROI center.
        breaks = np.where(np.diff(xs) > 1)[0]
        starts = np.r_[0, breaks + 1]
        ends = np.r_[breaks, xs.size - 1]
        runs = [(int(xs[s]), int(xs[e])) for s, e in zip(starts, ends)]
        scored = sorted(
            runs,
            key=lambda r: ((r[1] - r[0] + 1) + (0.5 * w if r[0] <= cx <= r[1] else 0)),
            reverse=True,
        )
        l, r = scored[0]
        if r - l + 1 < max(10, w * 0.15):
            continue
        ys.append(y)
        lefts.append(l)
        rights.append(r)

    if len(ys) < 20:
        raise RuntimeError("Could not isolate a stable threaded-shaft silhouette in this ROI")

    return np.asarray(ys), np.asarray(lefts, float), np.asarray(rights, float)


def detrend(y: np.ndarray, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    yi = np.arange(int(y.min()), int(y.max()) + 1)
    xi = np.interp(yi, y, x)
    trend = np.polyval(np.polyfit(yi, xi, 1), yi)
    return yi, xi - trend


def estimate_pitch_samples(y: np.ndarray, left: np.ndarray, right: np.ndarray) -> np.ndarray:
    samples = []
    for edge in (left, -right):
        yi, signal = detrend(y, edge)
        # Estimate a coarse period from autocorrelation first.
        centered = signal - signal.mean()
        ac = np.correlate(centered, centered, mode="full")[len(centered) - 1:]
        lo = max(5, int(len(signal) * 0.015))
        hi = min(max(lo + 2, int(len(signal) * 0.20)), len(ac) - 1)
        if hi <= lo:
            continue
        coarse = lo + int(np.argmax(ac[lo: hi + 1]))
        peaks, _ = find_peaks(signal, distance=max(3, int(coarse * 0.65)), prominence=max(1.0, np.std(signal) * 0.20))
        if peaks.size >= 3:
            diffs = np.diff(yi[peaks]).astype(float)
            # Remove obvious skipped/double peaks around the median.
            med = np.median(diffs)
            diffs = diffs[(diffs >= 0.65 * med) & (diffs <= 1.45 * med)]
            samples.extend(diffs.tolist())

    if len(samples) < 3:
        raise RuntimeError("Not enough repeated thread peaks to estimate pitch")
    return np.asarray(samples, dtype=float)


def estimate_crest_diameters(y: np.ndarray, left: np.ndarray, right: np.ndarray, pitch_px: float) -> np.ndarray:
    width = right - left
    # Smooth only lightly; thread crests should remain visible.
    smooth = np.convolve(width, np.ones(3) / 3.0, mode="same")
    peaks, _ = find_peaks(smooth, distance=max(3, int(pitch_px * 0.65)), prominence=max(1.0, np.std(smooth) * 0.10))
    values = smooth[peaks]
    if values.size < 3:
        # Fallback: use upper-envelope rows. This is less ideal, so dispersion will expose instability.
        cutoff = np.percentile(width, 85)
        values = width[width >= cutoff]
    if values.size < 3:
        raise RuntimeError("Not enough crest-width samples to estimate major diameter")

    lo, hi = np.percentile(values, [5, 95])
    values = values[(values >= lo) & (values <= hi)]
    return values.astype(float)


def measure(image_path: Path, roi: tuple[int, int, int, int]) -> Measurement:
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(image_path)

    x1, y1, x2, y2 = roi
    crop = image[y1:y2, x1:x2]
    if crop.size == 0:
        raise ValueError("ROI is outside the image")

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    angle = estimate_axis_angle(gray)
    rectified = rotate_bound(crop, angle) if abs(angle) >= 0.5 else crop
    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)
    mask = central_component_mask(gray)
    y, left, right = extract_boundaries(mask)

    pitch_samples = estimate_pitch_samples(y, left, right)
    pitch = float(np.median(pitch_samples))
    diameters = estimate_crest_diameters(y, left, right, pitch)
    diameter = float(np.median(diameters))

    return Measurement(
        image=str(image_path),
        roi=roi,
        axis_angle_deg=float(angle),
        pitch_px_median=pitch,
        pitch_px_mad=mad(pitch_samples),
        crest_diameter_px_median=diameter,
        crest_diameter_px_mad=mad(diameters),
        p_over_d=float(pitch / diameter),
        pitch_intervals_px=[float(v) for v in pitch_samples],
        crest_diameters_px=[float(v) for v in diameters],
    )


def parse_roi(value: str) -> tuple[int, int, int, int]:
    parts = [int(v.strip()) for v in value.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("ROI must be x1,y1,x2,y2")
    return tuple(parts)  # type: ignore[return-value]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("--roi", required=True, type=parse_roi)
    args = parser.parse_args()
    result = measure(args.image, args.roi)
    print(json.dumps(asdict(result), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
