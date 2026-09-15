import pathlib
import sys

import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

import scale_reference  # noqa: E402
from rulernet import RulerObservation  # noqa: E402
from scale_units import VisualScaleObservation  # noqa: E402


def _metric_ruler(px_per_cm: float = 150.0) -> RulerObservation:
    marks = np.array([[100.0 + px_per_cm * i, 90.0] for i in range(4)], dtype=np.float32)
    return RulerObservation(True, marks, px_per_cm, 1.0, (1.0, 0.0), ())


def _no_metric_ruler() -> RulerObservation:
    return RulerObservation(False, np.empty((0, 2), dtype=np.float32), None, None, None, ("ruler_marks_insufficient",))


def _visual(
    system: str,
    px_per_cm: float | None,
    confidence: float = 0.9,
) -> VisualScaleObservation:
    points = np.array([[100.0 + 24.0 * i, 90.0] for i in range(8)], dtype=np.float32) if px_per_cm else np.empty((0, 2), dtype=np.float32)
    px_per_inch = None if px_per_cm is None else px_per_cm * 2.54
    return VisualScaleObservation(
        system=system,
        confidence=confidence,
        px_per_cm=px_per_cm,
        px_per_inch=px_per_inch,
        minor_tick_px=24.0 if px_per_cm else None,
        reference_interval_cm=2.54 / 16.0 if px_per_cm else None,
        reference_points_px=points,
        direction_xy=(1.0, 0.0) if px_per_cm else None,
        perspective_step_pct=1.0 if px_per_cm else None,
        reason_codes=(),
    )


def test_metric_rulernet_remains_authoritative(monkeypatch):
    monkeypatch.setattr(scale_reference, "infer_visual_scale", lambda _image: _visual("unknown", None, 0.0))
    result = scale_reference.resolve_scale_reference(np.zeros((20, 20, 3), dtype=np.uint8), _metric_ruler(150.0))
    assert result.system == "metric"
    assert result.source == "rulernet_cm"
    assert result.px_per_cm == 150.0
    assert result.reference_interval_cm == 1.0


def test_pure_imperial_fallback_is_accepted_without_cm_marks(monkeypatch):
    monkeypatch.setattr(scale_reference, "infer_visual_scale", lambda _image: _visual("imperial", 384.0 / 2.54))
    result = scale_reference.resolve_scale_reference(np.zeros((20, 20, 3), dtype=np.uint8), _no_metric_ruler())
    assert result.system == "imperial"
    assert result.source == "imperial_ticks"
    assert result.px_per_inch is not None
    assert abs(result.px_per_inch - 384.0) < 0.01


def test_matching_metric_and_imperial_scales_become_dual(monkeypatch):
    monkeypatch.setattr(scale_reference, "infer_visual_scale", lambda _image: _visual("imperial", 151.0))
    result = scale_reference.resolve_scale_reference(np.zeros((20, 20, 3), dtype=np.uint8), _metric_ruler(150.0))
    assert result.system == "dual"
    assert result.source == "rulernet_cm+imperial_ticks"
    assert result.px_per_cm == 150.0


def test_conflicting_imperial_candidate_cannot_override_valid_cm_scale(monkeypatch):
    monkeypatch.setattr(scale_reference, "infer_visual_scale", lambda _image: _visual("imperial", 75.0))
    result = scale_reference.resolve_scale_reference(np.zeros((20, 20, 3), dtype=np.uint8), _metric_ruler(150.0))
    assert result.system == "metric"
    assert result.source == "rulernet_cm"
    assert result.px_per_cm == 150.0
