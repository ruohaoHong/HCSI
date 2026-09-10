import pathlib
import sys

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

import app as service_app  # noqa: E402
from rulernet import RulerObservation  # noqa: E402


def test_measure_rgb_combines_ruler_scale_and_opencv_geometry(monkeypatch):
    image = np.full((600, 800, 3), 245, dtype=np.uint8)
    marks = np.array([[float(x), 95.0] for x in range(100, 701, 50)], dtype=np.float32)
    box = cv2.boxPoints(((410.0, 350.0), (200.0, 40.0), 5.0)).astype(np.int32)
    cv2.fillConvexPoly(image, box, (25, 25, 25))
    fake_ruler = RulerObservation(True, marks, 50.0, 1.0, (1.0, 0.0), ())
    monkeypatch.setattr(service_app, "infer_ruler", lambda _image: fake_ruler)
    result = service_app.measure_rgb(image, "abc123")
    assert result["measurement_valid"] is True
    assert 37.0 <= result["length_mm"] <= 43.0
    assert 6.0 <= result["width_mm"] <= 11.0
    assert result["scale_px_per_cm"] == 50.0
    assert result["image_sha256"] == "abc123"


def test_measure_rgb_nulls_dimensions_when_perspective_gate_fails(monkeypatch):
    image = np.full((600, 800, 3), 245, dtype=np.uint8)
    marks = np.array([[float(x), 95.0] for x in range(100, 701, 50)], dtype=np.float32)
    box = cv2.boxPoints(((410.0, 350.0), (200.0, 40.0), 5.0)).astype(np.int32)
    cv2.fillConvexPoly(image, box, (25, 25, 25))
    fake_ruler = RulerObservation(True, marks, 50.0, 1.10, (1.0, 0.0), ())
    monkeypatch.setattr(service_app, "infer_ruler", lambda _image: fake_ruler)
    result = service_app.measure_rgb(image, "abc123")
    assert result["measurement_valid"] is False
    assert result["length_mm"] is None
    assert result["width_mm"] is None
    assert "perspective_too_strong_for_2d_measurement" in result["gate_reasons"]
