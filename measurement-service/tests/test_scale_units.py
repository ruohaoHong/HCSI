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
