import pathlib
import sys

import cv2
import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from geometry import _ruler_exclusion_mask, extract_object_geometry  # noqa: E402
from semantic_regions import build_semantic_masks  # noqa: E402


def _draw_ruler(image: np.ndarray, y0: int, y1: int, marks_y: int, x0: int = 80, x1: int = 720, px_per_cm: int = 50) -> np.ndarray:
    cv2.rectangle(image, (x0, y0), (x1, y1), (178, 178, 178), -1)
    cv2.line(image, (x0, y0), (x1, y0), (80, 80, 80), 2)
    cv2.line(image, (x0, y1), (x1, y1), (80, 80, 80), 2)
    marks = []
    for x in range(x0 + 20, x1 - 19, px_per_cm):
        marks.append([float(x), float(marks_y)])
        cv2.line(image, (x, y0), (x, min(y1, y0 + 30)), (20, 20, 20), 2)
    return np.array(marks, dtype=np.float32)


def test_extracts_rotated_hardware_geometry_while_excluding_ruler():
    image = np.full((600, 800, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image, 70, 125, 95, x0=60, x1=740)
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
    marks = _draw_ruler(image, 55, 105, 80, x0=70, x1=630)
    box = cv2.boxPoints(((350.0, 320.0), (180.0, 35.0), 55.0)).astype(np.int32)
    cv2.fillConvexPoly(image, box, (20, 20, 20))
    result = extract_object_geometry(image, marks, 50.0, (1.0, 0.0), max_alignment_deg=20.0)
    assert result.detected
    assert result.contour_reliable, result.gate_reasons
    assert "object_ruler_alignment_large" in result.risk_signals


def test_tick_line_near_ruler_edge_does_not_erase_nearby_hardware():
    image = np.full((520, 800, 3), 242, dtype=np.uint8)
    # Marks are deliberately near the ruler's upper edge.  The old symmetric
    # 1.7 cm corridor would extend about 85 px above the tick line and erase a
    # large part of this nearby bolt.
    marks = _draw_ruler(image, 220, 270, 226, x0=70, x1=730)
    box = cv2.boxPoints(((410.0, 168.0), (210.0, 34.0), 2.0)).astype(np.int32)
    cv2.fillConvexPoly(image, box, (28, 28, 28))

    result = extract_object_geometry(image, marks, 50.0, (1.0, 0.0))
    assert result.detected
    assert result.contour_reliable, result.gate_reasons
    assert result.center_xy is not None
    assert result.center_xy[1] < 205
    assert 195 <= result.principal_length_px <= 220
    assert 27 <= result.principal_width_px <= 44


def test_ruler_exclusion_prefers_body_side_over_parallel_hardware_edge():
    image = np.full((600, 900, 3), 245, dtype=np.uint8)
    px_per_cm = 120
    marks = _draw_ruler(
        image,
        360,
        455,
        362,
        x0=80,
        x1=820,
        px_per_cm=px_per_cm,
    )

    # A nearby hardware silhouette contributes a very strong parallel edge on
    # the opposite side of the tick/reference line. The old width-only scoring
    # could pair that edge with the ruler's far edge and erase the hardware.
    cv2.rectangle(image, (120, 226), (800, 342), (30, 30, 30), -1)

    exclusion, _ = _ruler_exclusion_mask(image, marks, float(px_per_cm))

    # The ruler interior must be excluded.
    assert exclusion[410, 450] > 0
    # The nearby hardware must remain outside the ruler exclusion mask.
    assert exclusion[280, 450] == 0

    result = extract_object_geometry(
        image,
        marks,
        float(px_per_cm),
        (1.0, 0.0),
    )
    assert result.detected
    assert result.contour_reliable, result.gate_reasons
    assert result.center_xy is not None
    assert result.center_xy[1] < 330
    assert result.principal_width_px is not None
    assert result.principal_width_px > 90


def test_soft_shadow_does_not_outscore_dark_hardware():
    image = np.full((600, 820, 3), 238, dtype=np.uint8)
    marks = _draw_ruler(image, 65, 115, 72, x0=70, x1=750)

    # Large soft shadow: intentionally larger than the hardware and therefore a
    # trap for area-only foreground selection.
    shadow = np.zeros((600, 820), dtype=np.uint8)
    cv2.ellipse(shadow, (425, 360), (230, 95), 5, 0, 360, 120, -1)
    shadow = cv2.GaussianBlur(shadow, (0, 0), 28)
    attenuation = (shadow.astype(np.float32) / 255.0 * 34.0)[..., None]
    image = np.clip(image.astype(np.float32) - attenuation, 0, 255).astype(np.uint8)

    box = cv2.boxPoints(((420.0, 350.0), (190.0, 38.0), -12.0)).astype(np.int32)
    cv2.fillConvexPoly(image, box, (25, 25, 25))

    result = extract_object_geometry(image, marks, 50.0, (1.0, 0.0))
    assert result.detected
    assert result.center_xy is not None
    assert abs(result.center_xy[0] - 420) < 30
    assert abs(result.center_xy[1] - 350) < 30
    assert result.principal_length_px is not None
    assert 175 <= result.principal_length_px <= 210
    # If threshold perturbation makes the shadow merge with the object, the
    # algorithm is allowed to detect it but must refuse to call the dimensions
    # reliable.
    if not result.contour_reliable:
        assert "object_contour_unstable" in result.gate_reasons or "object_contour_weak_edge_support" in result.gate_reasons


def test_hardware_may_be_on_either_side_of_ruler():
    image = np.full((620, 820, 3), 244, dtype=np.uint8)
    marks = _draw_ruler(image, 270, 320, 276, x0=70, x1=750)
    box = cv2.boxPoints(((430.0, 440.0), (170.0, 32.0), 18.0)).astype(np.int32)
    cv2.fillConvexPoly(image, box, (24, 24, 24))

    result = extract_object_geometry(image, marks, 50.0, (1.0, 0.0))
    assert result.detected
    assert result.center_xy is not None
    assert result.center_xy[1] > 380
    assert result.principal_length_px is not None
    assert 155 <= result.principal_length_px <= 185


def test_semantic_reference_roi_filters_parallel_hardware_from_ruler_edges():
    image = np.full((600, 900, 3), 245, dtype=np.uint8)
    px_per_cm = 120
    marks = _draw_ruler(
        image,
        360,
        455,
        362,
        x0=80,
        x1=820,
        px_per_cm=px_per_cm,
    )

    # Strong hardware edges sit above the ruler and are parallel to its axis.
    # The semantic reference ROI says the ruler is only in the lower band.
    cv2.rectangle(image, (90, 210), (825, 340), (25, 25, 25), -1)
    semantic = {
        "target_region": {
            "present": True,
            "confidence": 0.95,
            "x_min": 80,
            "y_min": 300,
            "x_max": 930,
            "y_max": 580,
        },
        "reference_region": {
            "present": True,
            "confidence": 0.95,
            "x_min": 50,
            "y_min": 590,
            "x_max": 980,
            "y_max": 800,
        },
        "head_style": "hex",
    }
    masks = build_semantic_masks(image.shape, semantic)
    exclusion, _ = _ruler_exclusion_mask(
        image,
        marks,
        float(px_per_cm),
        masks,
    )

    assert exclusion[405, 450] > 0
    assert exclusion[275, 450] == 0
