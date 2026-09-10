import pathlib
import sys

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from geometry import extract_object_geometry  # noqa: E402


def test_extracts_rotated_hardware_geometry_while_excluding_ruler():
    image = np.full((600, 800, 3), 245, dtype=np.uint8)
    cv2.rectangle(image, (60, 70), (740, 125), (180, 180, 180), -1)
    marks = []
    for x in range(100, 701, 50):
        marks.append([float(x), 95.0])
        cv2.line(image, (x, 70), (x, 105), (20, 20, 20), 2)
    marks = np.array(marks, dtype=np.float32)
    box = cv2.boxPoints(((410.0, 350.0), (200.0, 40.0), 8.0)).astype(np.int32)
    cv2.fillConvexPoly(image, box, (25, 25, 25))

    result = extract_object_geometry(image, marks, 50.0, (1.0, 0.0), max_alignment_deg=20.0)
    assert result.detected
    assert result.contour_reliable, result.gate_reasons
    assert result.principal_length_px is not None
    assert result.principal_width_px is not None
    assert 185 <= result.principal_length_px <= 215
    assert 32 <= result.principal_width_px <= 52
    assert result.ruler_alignment_deg is not None
    assert result.ruler_alignment_deg < 12


def test_large_ruler_alignment_is_risk_not_hard_rejection():
    image = np.full((500, 700, 3), 245, dtype=np.uint8)
    marks = np.array([[x, 80.0] for x in range(100, 601, 50)], dtype=np.float32)
    box = cv2.boxPoints(((350.0, 320.0), (180.0, 35.0), 55.0)).astype(np.int32)
    cv2.fillConvexPoly(image, box, (20, 20, 20))
    result = extract_object_geometry(image, marks, 50.0, (1.0, 0.0), max_alignment_deg=20.0)
    assert result.detected
    assert result.contour_reliable, result.gate_reasons
    assert "object_ruler_alignment_large" in result.risk_signals
