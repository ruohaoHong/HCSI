import pathlib
import sys

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

import app as service_app  # noqa: E402
from rulernet import RulerObservation  # noqa: E402


def _fake_ruler():
    marks = np.array([[float(x), 95.0] for x in range(100, 701, 50)], dtype=np.float32)
    return RulerObservation(True, marks, 50.0, 1.0, (1.0, 0.0), ())


def _threaded_bolt_image(period_px: float = 20.0):
    image = np.full((600, 800, 3), 245, dtype=np.uint8)
    cv2.rectangle(image, (210, 270), (260, 430), (25, 25, 25), -1)
    xs = np.arange(260, 561)
    radius = 14.0 + 2.0 * np.cos(2.0 * np.pi * (xs - 260) / period_px)
    top = np.column_stack([xs, 350.0 - radius]).astype(np.int32)
    bottom = np.column_stack([xs[::-1], (350.0 + radius)[::-1]]).astype(np.int32)
    cv2.fillPoly(image, [np.vstack([top, bottom])], (25, 25, 25))
    return image


def test_measure_rgb_returns_independent_l_d_pitch_and_tpi(monkeypatch):
    image = _threaded_bolt_image()
    monkeypatch.setattr(service_app, "infer_ruler", lambda _image: _fake_ruler())
    steps = [
        {
            "operation": "axial_distance",
            "inputs": ["object_tip", "width_transition"],
            "purpose": "量測螺栓頭下有效長度",
        },
        {
            "operation": "outer_width",
            "inputs": ["threaded_shank"],
            "purpose": "量測螺紋桿身外徑",
        },
        {
            "operation": "periodicity",
            "inputs": ["threaded_shank"],
            "purpose": "量測螺紋重複週期",
        },
    ]

    result = service_app.measure_rgb(image, "abc123", steps)

    assert result["measurement_status"] == "valid", result["reason_codes"]
    assert len(result["geometry_steps"]) == 3
    length, diameter, pitch = result["geometry_steps"]

    assert length["status"] == "measured", length
    assert diameter["status"] == "measured", diameter
    assert pitch["status"] == "measured", pitch

    assert 57.0 <= length["value_mm"] <= 63.0
    assert 5.8 <= diameter["value_mm"] <= 6.6
    assert 3.8 <= pitch["value_mm"] <= 4.2
    assert 6.0 <= pitch["derived_tpi"] <= 6.7
    assert pitch["reason_codes"] == []
    assert pitch["diagnostics"]["left_pitch_px"] == 20.0
    assert pitch["diagnostics"]["right_pitch_px"] == 20.0
