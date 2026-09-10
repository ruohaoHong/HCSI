import pathlib
import sys

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

import app as service_app  # noqa: E402
from rulernet import RulerObservation  # noqa: E402


def _hardware_image():
    image = np.full((600, 800, 3), 245, dtype=np.uint8)
    box = cv2.boxPoints(((410.0, 350.0), (200.0, 40.0), 5.0)).astype(np.int32)
    cv2.fillConvexPoly(image, box, (25, 25, 25))
    return image


def test_measure_rgb_combines_ruler_scale_and_opencv_geometry(monkeypatch):
    image = _hardware_image()
    marks = np.array([[float(x), 95.0] for x in range(100, 701, 50)], dtype=np.float32)
    fake_ruler = RulerObservation(True, marks, 50.0, 1.0, (1.0, 0.0), ())
    monkeypatch.setattr(service_app, "infer_ruler", lambda _image: fake_ruler)
    result = service_app.measure_rgb(image, "abc123")
    assert result["measurement_status"] == "valid"
    assert result["analysis_mode"] == "measurement_assisted"
    assert result["measurement_valid"] is True
    assert result["retry_recommended"] is False
    assert 37.0 <= result["length_mm"] <= 43.0
    assert 6.0 <= result["width_mm"] <= 11.0
    assert result["scale_px_per_cm"] == 50.0
    assert result["image_sha256"] == "abc123"


def test_measure_rgb_returns_no_reference_without_blocking_identification(monkeypatch):
    image = _hardware_image()
    fake_ruler = RulerObservation(False, np.empty((0, 2), dtype=np.float32), None, None, None, ("ruler_marks_insufficient",))
    monkeypatch.setattr(service_app, "infer_ruler", lambda _image: fake_ruler)
    result = service_app.measure_rgb(image, "abc123")
    assert result["measurement_status"] == "no_reference"
    assert result["analysis_mode"] == "appearance_only"
    assert result["measurement_valid"] is False
    assert result["retry_recommended"] is False
    assert result["length_mm"] is None
    assert result["width_mm"] is None


def test_measure_rgb_marks_strong_perspective_unreliable(monkeypatch):
    image = _hardware_image()
    marks = np.array([[float(x), 95.0] for x in range(100, 701, 50)], dtype=np.float32)
    fake_ruler = RulerObservation(True, marks, 50.0, 1.10, (1.0, 0.0), ())
    monkeypatch.setattr(service_app, "infer_ruler", lambda _image: fake_ruler)
    result = service_app.measure_rgb(image, "abc123")
    assert result["measurement_status"] == "unreliable"
    assert result["analysis_mode"] == "appearance_only"
    assert result["measurement_valid"] is False
    assert result["retry_recommended"] is True
    assert result["length_mm"] is None
    assert result["width_mm"] is None
    assert "perspective_too_strong_for_2d_measurement" in result["reason_codes"]
