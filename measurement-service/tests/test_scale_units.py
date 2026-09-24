import pathlib
import sys

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from scale_units import infer_visual_scale  # noqa: E402


def _imperial_ruler_image() -> np.ndarray:
    image = np.full((850, 1200, 3), 255, dtype=np.uint8)
    cv2.rectangle(image, (370, 470), (890, 593), (210, 210, 210), -1)
    cv2.line(image, (370, 470), (890, 470), (40, 40, 40), 2)
    cv2.line(image, (370, 593), (890, 593), (40, 40, 40), 2)

    # Common 1/16-inch hierarchy: minor ticks every 24 px, stronger ticks at
    # eighth/quarter-inch intervals. One inch therefore spans 16 * 24 = 384 px.
    x = 394
    index = 0
    while x <= 880:
        if index % 4 == 3:
            length = 90
        elif index % 2 == 1:
            length = 66
        else:
            length = 53
        cv2.line(image, (x, 470), (x, 470 + length), (20, 20, 20), 3)
        x += 24
        index += 1
    return image


def test_detects_common_imperial_tick_hierarchy_and_converts_to_cm_scale():
    result = infer_visual_scale(_imperial_ruler_image())

    assert result.system == "imperial", result
    assert result.confidence >= 0.62
    assert result.px_per_inch is not None
    assert 380.0 <= result.px_per_inch <= 388.0
    assert result.px_per_cm is not None
    assert 149.0 <= result.px_per_cm <= 153.0
    assert result.reference_interval_cm is not None
    assert abs(result.reference_interval_cm - 2.54 / 16.0) < 0.002
    assert len(result.reference_points_px) >= 8



def _borderless_imperial_scale_image() -> np.ndarray:
    image = np.full((1000, 1000, 3), 255, dtype=np.uint8)
    baseline = 670
    start = 280
    pitch = 30
    # 1/16-inch hierarchy without any enclosing ruler body/rails.
    for index in range(25):
        x = start + index * pitch
        if index % 16 == 0:
            length = 94
            thickness = 5
        elif index % 8 == 0:
            length = 82
            thickness = 4
        elif index % 4 == 0:
            length = 62
            thickness = 3
        elif index % 2 == 0:
            length = 48
            thickness = 2
        else:
            length = 36
            thickness = 2
        cv2.line(image, (x, baseline), (x, baseline + length), (20, 20, 20), thickness)
    return image


def test_detects_borderless_imperial_tick_hierarchy():
    image = _borderless_imperial_scale_image()
    result = infer_visual_scale(image)
    if result.system == "unknown":
        import scale_units
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 45, 135)
        short = scale_units._short_lines(edges)
        print("DEBUG short_lines", len(short))
        print("DEBUG borderless", [
            (round(score, 3), pattern.system, round(pattern.confidence, 3),
             round(pattern.minor_tick_px, 2), pattern.repeat_period,
             len(pattern.points_xy))
            for score, pattern, _axis in scale_units._borderless_pattern_candidates(short, gray.shape)
        ])

    assert result.system == "imperial", result
    assert result.confidence >= 0.62
    assert result.px_per_inch is not None
    assert 470.0 <= result.px_per_inch <= 490.0
    assert result.reference_interval_cm is not None
    assert abs(result.reference_interval_cm - 2.54 / 16.0) < 0.002
    assert len(result.reference_points_px) >= 12


def test_repeated_hardware_edges_without_common_tick_baseline_are_not_a_scale():
    image = np.full((600, 900, 3), 255, dtype=np.uint8)
    for index in range(18):
        x = 150 + index * 28
        y = 260 + (index % 3) * 5
        cv2.line(image, (x, y), (x + 12, y + 28), (20, 20, 20), 2)

    result = infer_visual_scale(image)

    assert result.system == "unknown", result
