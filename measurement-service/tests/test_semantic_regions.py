import pathlib
import sys

import numpy as np
import pytest

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from semantic_regions import (  # noqa: E402
    apply_semantic_constraints,
    build_semantic_masks,
    normalize_semantic_vision,
    parse_semantic_vision,
)


def _semantic(
    target=(150, 250, 650, 750),
    reference=(100, 20, 900, 180),
    target_confidence=0.95,
    reference_confidence=0.95,
):
    return {
        "target_region": {
            "present": True,
            "confidence": target_confidence,
            "x_min": target[0],
            "y_min": target[1],
            "x_max": target[2],
            "y_max": target[3],
        },
        "reference_region": {
            "present": True,
            "confidence": reference_confidence,
            "x_min": reference[0],
            "y_min": reference[1],
            "x_max": reference[2],
            "y_max": reference[3],
        },
        "head_style": "hex",
    }


def test_parse_semantic_vision_normalizes_valid_context():
    context = parse_semantic_vision(__import__("json").dumps(_semantic()))

    assert context["head_style"] == "hex"
    assert context["target_region"]["present"] is True
    assert context["target_region"]["confidence"] == 0.95


def test_invalid_semantic_coordinates_are_rejected():
    context = _semantic()
    context["target_region"]["x_max"] = 1200

    with pytest.raises(ValueError, match="0..1000"):
        normalize_semantic_vision(context)


def test_target_roi_owns_pixels_and_reference_region_is_excluded():
    masks = build_semantic_masks((500, 800, 3), _semantic())
    source = np.full((500, 800), 255, dtype=np.uint8)

    constrained = apply_semantic_constraints(source, masks)

    assert masks.target_applied is True
    assert masks.reference_applied is True
    assert constrained[300, 320] == 255
    assert constrained[450, 750] == 0
    assert constrained[50, 320] == 0


def test_low_confidence_semantic_box_does_not_control_geometry():
    masks = build_semantic_masks(
        (500, 800, 3),
        _semantic(target_confidence=0.40, reference_confidence=0.40),
    )

    assert masks.target_applied is False
    assert masks.reference_applied is False
    assert masks.target_mask is None
    assert masks.reference_exclusion_mask is None


def test_heavy_target_reference_overlap_does_not_erase_hardware():
    masks = build_semantic_masks(
        (500, 800, 3),
        _semantic(
            target=(150, 200, 700, 800),
            reference=(250, 250, 650, 700),
        ),
    )

    assert masks.target_applied is True
    assert masks.reference_applied is False
    assert masks.reference_exclusion_mask is None
    assert masks.overlap_ratio is not None and masks.overlap_ratio > 0.20
    assert "semantic_region_overlap_high" in masks.risk_signals
