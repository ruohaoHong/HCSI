import pathlib
import sys

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

import app as service_app  # noqa: E402
from rulernet import RulerObservation  # noqa: E402
from scale_reference import ScaleReference  # noqa: E402


def _hardware_image():
    image = np.full((600, 800, 3), 245, dtype=np.uint8)
    box = cv2.boxPoints(((410.0, 350.0), (200.0, 40.0), 5.0)).astype(np.int32)
    cv2.fillConvexPoly(image, box, (25, 25, 25))
    return image


def _bolt_image():
    image = np.full((600, 800, 3), 245, dtype=np.uint8)
    cv2.rectangle(image, (210, 290), (260, 410), (25, 25, 25), -1)
    cv2.rectangle(image, (260, 335), (560, 365), (25, 25, 25), -1)
    return image


def _fake_ruler(perspective_ratio: float = 1.0):
    marks = np.array([[float(x), 95.0] for x in range(100, 701, 50)], dtype=np.float32)
    return RulerObservation(True, marks, 50.0, perspective_ratio, (1.0, 0.0), ())


def _fake_imperial_scale(px_per_inch: float = 384.0):
    px_per_cm = px_per_inch / 2.54
    minor = px_per_inch / 16.0
    points = np.array([[100.0 + minor * i, 95.0] for i in range(20)], dtype=np.float32)
    return ScaleReference(
        system="imperial",
        source="imperial_ticks",
        confidence=0.9,
        px_per_cm=px_per_cm,
        px_per_inch=px_per_inch,
        reference_points_px=points,
        reference_interval_cm=2.54 / 16.0,
        direction_xy=(1.0, 0.0),
        perspective_step_pct=1.0,
        reason_codes=(),
    )


def test_measure_rgb_combines_ruler_scale_and_opencv_geometry(monkeypatch):
    image = _hardware_image()
    fake_ruler = _fake_ruler()
    monkeypatch.setattr(service_app, "infer_ruler", lambda _image: fake_ruler)
    result = service_app.measure_rgb(image, "abc123")
    assert result["measurement_status"] == "valid"
    assert result["measurement_confidence"] == "uncertain"
    assert result["confidence_evaluation"]["measurement_state"] == "measured"
    assert result["capture_assumptions"]["same_plane_status"] == "unknown"
    assert "same_plane_unverified" in result["confidence_evaluation"]["reason_codes"]
    assert result["analysis_mode"] == "measurement_assisted"
    assert result["measurement_valid"] is True
    assert result["retry_recommended"] is False
    assert result["scale_system"] == "metric"
    assert 37.0 <= result["length_mm"] <= 43.0
    assert 6.0 <= result["width_mm"] <= 11.0
    assert result["scale_px_per_cm"] == 50.0
    assert result["scale_px_per_inch"] == 127.0
    assert result["geometry_steps"] == []
    assert result["image_sha256"] == "abc123"


def test_measure_rgb_accepts_imperial_scale_and_normalizes_output_to_mm(monkeypatch):
    image = _hardware_image()
    no_metric = RulerObservation(False, np.empty((0, 2), dtype=np.float32), None, None, None, ("ruler_marks_insufficient",))
    imperial = _fake_imperial_scale()
    monkeypatch.setattr(service_app, "infer_ruler", lambda _image: no_metric)
    monkeypatch.setattr(service_app, "resolve_scale_reference", lambda _image, _ruler: imperial)

    result = service_app.measure_rgb(image, "abc123")

    assert result["measurement_status"] == "valid", result["reason_codes"]
    assert result["scale_system"] == "imperial"
    assert result["ruler"]["scale_source"] == "imperial_ticks"
    assert 151.0 <= result["scale_px_per_cm"] <= 151.3
    assert 383.9 <= result["scale_px_per_inch"] <= 384.1
    # The object is about 200 px long. At 384 px/in that is about 13.23 mm.
    assert 12.0 <= result["length_mm"] <= 14.5
    assert 2.0 <= result["width_mm"] <= 3.5


def test_measure_rgb_executes_resolved_axial_distance(monkeypatch):
    image = _bolt_image()
    fake_ruler = _fake_ruler()
    monkeypatch.setattr(service_app, "infer_ruler", lambda _image: fake_ruler)
    steps = [
        {
            "operation": "axial_distance",
            "inputs": ["object_tip", "width_transition"],
            "purpose": "量測螺栓頭下有效長度",
        }
    ]

    result = service_app.measure_rgb(image, "abc123", steps)

    assert result["measurement_status"] == "valid", result["reason_codes"]
    assert len(result["geometry_steps"]) == 1
    step = result["geometry_steps"][0]
    assert step["status"] == "measured", step
    assert 285.0 <= step["value_px"] <= 315.0
    assert 57.0 <= step["value_mm"] <= 63.0
    assert set(step["landmarks"]) == {"object_tip", "width_transition"}


def test_measure_rgb_returns_no_reference_without_blocking_identification(monkeypatch):
    image = _hardware_image()
    fake_ruler = RulerObservation(False, np.empty((0, 2), dtype=np.float32), None, None, None, ("ruler_marks_insufficient",))
    monkeypatch.setattr(service_app, "infer_ruler", lambda _image: fake_ruler)
    result = service_app.measure_rgb(
        image,
        "abc123",
        [{"operation": "axial_distance", "inputs": ["object_tip", "width_transition"], "purpose": "test"}],
    )
    assert result["measurement_status"] == "no_reference"
    assert result["measurement_confidence"] == "not_measured"
    assert result["analysis_mode"] == "appearance_only"
    assert result["measurement_valid"] is False
    assert result["retry_recommended"] is False
    assert result["length_mm"] is None
    assert result["width_mm"] is None
    assert result["geometry_steps"][0]["status"] == "not_measured"
    assert result["geometry_steps"][0]["reason_codes"] == ["scale_reference_not_confirmed"]


def test_measure_rgb_marks_strong_perspective_unreliable(monkeypatch):
    image = _hardware_image()
    fake_ruler = _fake_ruler(1.10)
    monkeypatch.setattr(service_app, "infer_ruler", lambda _image: fake_ruler)
    result = service_app.measure_rgb(image, "abc123")
    assert result["measurement_status"] == "unreliable"
    assert result["analysis_mode"] == "appearance_only"
    assert result["measurement_valid"] is False
    assert result["retry_recommended"] is True
    assert result["length_mm"] is None
    assert result["width_mm"] is None
    assert "perspective_too_strong_for_2d_measurement" in result["reason_codes"]


def test_measure_rgb_threads_semantic_vision_into_cv_geometry(monkeypatch):
    image = _bolt_image()
    fake_ruler = _fake_ruler()
    monkeypatch.setattr(service_app, "infer_ruler", lambda _image: fake_ruler)
    semantic_vision = {
        "target_region": {
            "present": True,
            "confidence": 0.98,
            "x_min": 240.0,
            "y_min": 430.0,
            "x_max": 730.0,
            "y_max": 740.0,
        },
        "reference_region": {
            "present": True,
            "confidence": 0.95,
            "x_min": 80.0,
            "y_min": 90.0,
            "x_max": 920.0,
            "y_max": 230.0,
        },
        "head_style": "hex",
    }

    result = service_app.measure_rgb(
        image,
        "abc123",
        [_axial_step_for_service()],
        semantic_vision,
    )

    assert result["measurement_status"] == "valid", result["reason_codes"]
    assert "semantic_roi" in result["object"]["segmentation_method"]
    assert result["object"]["semantic_head_style"] == "hex"
    assert result["object"]["semantic_target_region"]["confidence"] == 0.98
    assert result["geometry_steps"][0]["status"] == "measured"


def _axial_step_for_service():
    return {
        "operation": "axial_distance",
        "inputs": ["object_tip", "width_transition"],
        "purpose": "量測螺栓頭下有效長度",
    }
