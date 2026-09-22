import pathlib
import sys

import numpy as np

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from pixel_ownership import (  # noqa: E402
    build_semantic_masks,
    constrain_foreground_mask,
    parse_semantic_vision_hint,
    semantic_overlap_ratio,
)


def _hint(reference_present=True):
    return {
        "object_box": {"x_min": 0.20, "y_min": 0.35, "x_max": 0.75, "y_max": 0.65},
        "reference_present": reference_present,
        "reference_box": {"x_min": 0.72, "y_min": 0.10, "x_max": 0.95, "y_max": 0.90},
        "head_style": "hex_external",
        "confidence": 0.91,
    }


def test_semantic_mask_preserves_object_roi_and_removes_reference_pixels():
    parsed = parse_semantic_vision_hint(_hint())
    assert parsed is not None
    object_mask, reference_mask, diagnostics = build_semantic_masks((200, 400, 3), parsed)

    foreground = np.full((200, 400), 255, dtype=np.uint8)
    constrained = constrain_foreground_mask(foreground, object_mask, reference_mask)

    assert constrained[100, 100] == 255
    assert constrained[100, 350] == 0
    assert constrained[10, 10] == 0
    assert diagnostics["semantic_head_style"] == "hex_external"
    assert diagnostics["semantic_confidence"] == 0.91


def test_reference_absence_does_not_create_fake_exclusion_region():
    parsed = parse_semantic_vision_hint(_hint(reference_present=False))
    assert parsed is not None
    _, reference_mask, _ = build_semantic_masks((200, 400, 3), parsed)
    assert reference_mask is not None
    assert int(np.count_nonzero(reference_mask)) == 0
    assert semantic_overlap_ratio(parsed) == 0.0


def test_large_semantic_overlap_is_visible_for_capture_quality_gate():
    raw = _hint()
    raw["reference_box"] = {"x_min": 0.50, "y_min": 0.30, "x_max": 0.90, "y_max": 0.70}
    parsed = parse_semantic_vision_hint(raw)
    assert parsed is not None
    assert semantic_overlap_ratio(parsed) > 0.20


def test_invalid_object_box_rejects_semantic_hint_instead_of_guessing():
    raw = _hint()
    raw["object_box"] = {"x_min": 0.2, "y_min": 0.2, "x_max": 0.205, "y_max": 0.7}
    assert parse_semantic_vision_hint(raw) is None
