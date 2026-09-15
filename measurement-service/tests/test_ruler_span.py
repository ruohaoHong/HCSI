import pathlib
import sys

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from geometry import extract_object_geometry  # noqa: E402
from ruler_span import expand_reference_points_to_ruler_body  # noqa: E402


def _scene() -> tuple[np.ndarray, np.ndarray]:
    image = np.full((850, 1200, 3), 255, dtype=np.uint8)

    # A long ruler body, while the visual scale detector only trusts a local
    # run of imperial ticks near its left side.
    cv2.rectangle(image, (370, 470), (890, 593), (210, 210, 210), -1)
    cv2.line(image, (370, 470), (890, 470), (40, 40, 40), 2)
    cv2.line(image, (370, 593), (890, 593), (40, 40, 40), 2)
    for x in range(394, 881, 24):
        cv2.line(image, (x, 470), (x, 535), (20, 20, 20), 3)

    # Hardware above the ruler. Its long horizontal edges are intentionally
    # plausible Hough candidates. The vertical separation is deliberate: this
    # regression isolates recovery of the ruler's *axial* body span and does
    # not test the separate ruler-normal-width exclusion heuristic.
    cv2.rectangle(image, (390, 260), (770, 310), (30, 30, 30), -1)
    cv2.rectangle(image, (770, 235), (835, 335), (30, 30, 30), -1)

    partial_ticks = np.array(
        [[421.0 + 24.0 * i, 470.0] for i in range(7)],
        dtype=np.float32,
    )
    return image, partial_ticks


def test_expands_local_tick_run_to_visible_ruler_body_span():
    image, partial_ticks = _scene()
    expanded = expand_reference_points_to_ruler_body(
        image,
        partial_ticks,
        (1.0, 0.0),
        384.0 / 2.54,
    )

    assert len(expanded) >= len(partial_ticks) + 2
    assert float(np.min(expanded[:, 0])) <= 380.0
    assert float(np.max(expanded[:, 0])) >= 880.0


def test_expanded_span_keeps_ruler_remnant_out_of_hardware_contour():
    image, partial_ticks = _scene()
    px_per_cm = 384.0 / 2.54
    expanded = expand_reference_points_to_ruler_body(
        image,
        partial_ticks,
        (1.0, 0.0),
        px_per_cm,
    )

    result = extract_object_geometry(image, expanded, px_per_cm, (1.0, 0.0))

    assert result.detected
    assert result.center_xy is not None
    assert result.center_xy[1] < 400.0
    assert result.principal_length_px is not None
    assert result.principal_length_px >= 400.0
    assert "selected_contour_too_close_to_ruler" not in result.gate_reasons
