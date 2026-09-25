import pathlib
import sys

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from scale_units import _infer_tick_pattern, infer_visual_scale  # noqa: E402


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



def _standalone_tick_ladder(
    *,
    spacing_px: int,
    major_period: int,
    count: int,
) -> np.ndarray:
    image = np.full((760, 1200, 3), 255, dtype=np.uint8)
    baseline = 590
    x0 = 100
    for index in range(count):
        x = x0 + index * spacing_px
        if index % major_period == 0:
            length = 105
        elif major_period % 2 == 0 and index % (major_period // 2) == 0:
            length = 82
        elif major_period % 4 == 0 and index % (major_period // 4) == 0:
            length = 67
        else:
            length = 51
        cv2.line(image, (x, baseline), (x, baseline - length), (20, 20, 20), 3)
    return image


def test_detects_standalone_imperial_tick_hierarchy_without_ruler_body():
    result = infer_visual_scale(
        _standalone_tick_ladder(spacing_px=24, major_period=16, count=40)
    )

    assert result.system == "imperial", result
    assert result.px_per_inch is not None
    assert 380.0 <= result.px_per_inch <= 388.0
    assert result.reference_interval_cm is not None
    assert abs(result.reference_interval_cm - 2.54 / 16.0) < 0.002


def test_detects_standalone_metric_tick_hierarchy_without_ruler_body():
    result = infer_visual_scale(
        _standalone_tick_ladder(spacing_px=20, major_period=10, count=45)
    )

    assert result.system == "metric", result
    assert result.px_per_cm is not None
    assert 196.0 <= result.px_per_cm <= 204.0
    assert result.reference_interval_cm == 0.1


def test_missing_tick_slots_do_not_masquerade_as_perspective():
    pitch = 20.0
    omitted = {5, 12, 19}
    slots = [index for index in range(30) if index not in omitted]
    positions = np.asarray([index * pitch for index in slots], dtype=np.float64)
    lengths = np.asarray(
        [
            100.0 if index % 10 == 0 else 70.0 if index % 5 == 0 else 40.0
            for index in slots
        ],
        dtype=np.float64,
    )
    points = np.column_stack(
        [positions, np.full(len(positions), 120.0, dtype=np.float64)]
    )

    pattern = _infer_tick_pattern(positions, lengths, points)

    assert pattern is not None
    assert pattern.system == "metric"
    assert pattern.perspective_step_pct < 1.0
