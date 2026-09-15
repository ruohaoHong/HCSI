import pathlib
import sys

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from geometry_executor import execute_geometry_steps  # noqa: E402


def _draw_ruler(image: np.ndarray, x0: int = 70, x1: int = 730, px_per_cm: int = 50) -> np.ndarray:
    cv2.rectangle(image, (x0, 65), (x1, 120), (178, 178, 178), -1)
    cv2.line(image, (x0, 65), (x1, 65), (80, 80, 80), 2)
    cv2.line(image, (x0, 120), (x1, 120), (80, 80, 80), 2)
    marks = []
    for x in range(x0 + 20, x1 - 19, px_per_cm):
        marks.append([float(x), 92.0])
        cv2.line(image, (x, 65), (x, 95), (20, 20, 20), 2)
    return np.array(marks, dtype=np.float32)


def _axial_step():
    return {
        "operation": "axial_distance",
        "inputs": ["object_tip", "width_transition"],
        "purpose": "量測螺栓頭下有效長度",
    }


def test_axial_distance_executes_object_tip_to_width_transition():
    image = np.full((520, 820, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image)

    # Bolt-like silhouette: a wide head at the left and a narrow shank extending
    # to the right. The under-head distance is about 290 px.
    cv2.rectangle(image, (220, 300), (270, 400), (25, 25, 25), -1)
    cv2.rectangle(image, (270, 335), (560, 365), (25, 25, 25), -1)

    results = execute_geometry_steps(image, marks, 50.0, [_axial_step()])

    assert len(results) == 1
    result = results[0]
    assert result["status"] == "measured", result
    assert result["reason_codes"] == []
    assert 275.0 <= result["value_px"] <= 305.0
    assert 55.0 <= result["value_mm"] <= 61.0
    assert set(result["landmarks"]) == {"object_tip", "width_transition"}
    assert result["landmarks"]["object_tip"]["x_px"] > result["landmarks"]["width_transition"]["x_px"]


def test_uniform_width_object_does_not_invent_transition():
    image = np.full((520, 820, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image)
    cv2.rectangle(image, (220, 330), (560, 370), (25, 25, 25), -1)

    results = execute_geometry_steps(image, marks, 50.0, [_axial_step()])

    assert results[0]["status"] == "not_measured"
    assert results[0]["value_px"] is None
    assert results[0]["value_mm"] is None
    assert results[0]["reason_codes"] == ["width_transition_not_found"]


def test_unimplemented_operation_is_explicitly_not_measured():
    image = np.full((520, 820, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image)
    cv2.rectangle(image, (220, 330), (560, 370), (25, 25, 25), -1)
    step = {
        "operation": "periodicity",
        "inputs": ["threaded_shank"],
        "purpose": "量測螺紋重複週期",
    }

    results = execute_geometry_steps(image, marks, 50.0, [step])

    assert results[0]["status"] == "not_measured"
    assert results[0]["reason_codes"] == ["operation_not_implemented"]
