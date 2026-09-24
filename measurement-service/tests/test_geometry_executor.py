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


def _width_step():
    return {
        "operation": "outer_width",
        "inputs": ["threaded_shank"],
        "purpose": "量測螺紋桿身外徑",
    }


def _periodicity_step():
    return {
        "operation": "periodicity",
        "inputs": ["threaded_shank"],
        "purpose": "量測螺紋重複週期",
    }


def _draw_threaded_bolt(image: np.ndarray, period_px: float = 20.0):
    cv2.rectangle(image, (220, 290), (270, 410), (25, 25, 25), -1)
    xs = np.arange(270, 561)
    radius = 14.0 + 2.0 * np.cos(2.0 * np.pi * (xs - 270) / period_px)
    top = np.column_stack([xs, 350.0 - radius]).astype(np.int32)
    bottom = np.column_stack([xs[::-1], (350.0 + radius)[::-1]]).astype(np.int32)
    cv2.fillPoly(image, [np.vstack([top, bottom])], (25, 25, 25))


def test_axial_distance_executes_object_tip_to_width_transition():
    image = np.full((520, 820, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image)

    cv2.rectangle(image, (220, 300), (270, 400), (25, 25, 25), -1)
    cv2.rectangle(image, (270, 335), (560, 365), (25, 25, 25), -1)

    results = execute_geometry_steps(image, marks, 50.0, [_axial_step()])

    assert len(results) == 1
    result = results[0]
    assert result["status"] == "measured", result
    assert result["reason_codes"] == []
    assert 275.0 <= result["value_px"] <= 305.0
    assert 55.0 <= result["value_mm"] <= 61.0
    assert result["derived_tpi"] is None
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
    assert results[0]["derived_tpi"] is None
    assert results[0]["reason_codes"] == ["width_transition_not_found"]


def test_outer_width_and_periodicity_execute_independently_on_threaded_shank():
    image = np.full((520, 820, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image)
    _draw_threaded_bolt(image, period_px=20.0)

    results = execute_geometry_steps(
        image,
        marks,
        50.0,
        [_width_step(), _periodicity_step()],
    )

    width, periodicity = results
    assert width["status"] == "measured", width
    assert 29.0 <= width["value_px"] <= 33.0
    assert 5.8 <= width["value_mm"] <= 6.6
    assert width["derived_tpi"] is None
    assert set(width["landmarks"]) == {"threaded_shank_start", "threaded_shank_end"}

    assert periodicity["status"] == "measured", periodicity
    assert 19.0 <= periodicity["value_px"] <= 21.0
    assert 3.8 <= periodicity["value_mm"] <= 4.2
    assert 6.0 <= periodicity["derived_tpi"] <= 6.7
    assert periodicity["diagnostics"]["left_pitch_px"] == 20.0
    assert periodicity["diagnostics"]["right_pitch_px"] == 20.0


def test_periodicity_rejects_smooth_shank_without_blocking_diameter():
    image = np.full((520, 820, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image)
    cv2.rectangle(image, (220, 290), (270, 410), (25, 25, 25), -1)
    cv2.rectangle(image, (270, 334), (560, 366), (25, 25, 25), -1)

    width, periodicity = execute_geometry_steps(
        image,
        marks,
        50.0,
        [_width_step(), _periodicity_step()],
    )

    assert width["status"] == "measured", width
    assert periodicity["status"] == "not_measured"
    assert periodicity["value_px"] is None
    assert periodicity["derived_tpi"] is None
    assert periodicity["reason_codes"] == ["periodicity_signal_weak"]


def test_unknown_operation_is_explicitly_not_measured():
    image = np.full((520, 820, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image)
    cv2.rectangle(image, (220, 330), (560, 370), (25, 25, 25), -1)
    step = {
        "operation": "unknown_geometry_op",
        "inputs": ["threaded_shank"],
        "purpose": "test",
    }

    results = execute_geometry_steps(image, marks, 50.0, [step])

    assert results[0]["status"] == "not_measured"
    assert results[0]["reason_codes"] == ["operation_not_implemented"]


def test_semantic_target_region_keeps_periodicity_on_selected_hardware():
    image = np.full((520, 820, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image)

    # Intended hardware: 20 px pitch.
    _draw_threaded_bolt(image, period_px=20.0)

    # A larger, highly periodic distractor elsewhere in the image. Without a
    # semantic ownership prior, contour scoring is free to select this object.
    cv2.rectangle(image, (80, 175), (145, 285), (25, 25, 25), -1)
    xs = np.arange(145, 700)
    radius = 20.0 + 3.0 * np.cos(2.0 * np.pi * (xs - 145) / 10.0)
    top = np.column_stack([xs, 230.0 - radius]).astype(np.int32)
    bottom = np.column_stack([xs[::-1], (230.0 + radius)[::-1]]).astype(np.int32)
    cv2.fillPoly(image, [np.vstack([top, bottom])], (25, 25, 25))

    semantic_vision = {
        "target_region": {
            "present": True,
            "confidence": 0.98,
            "x_min": 240.0,
            "y_min": 520.0,
            "x_max": 710.0,
            "y_max": 820.0,
        },
        "reference_region": {
            "present": True,
            "confidence": 0.98,
            "x_min": 60.0,
            "y_min": 90.0,
            "x_max": 920.0,
            "y_max": 250.0,
        },
        "head_style": "hex",
    }

    width, periodicity = execute_geometry_steps(
        image,
        marks,
        50.0,
        [_width_step(), _periodicity_step()],
        semantic_vision=semantic_vision,
    )

    assert width["status"] == "measured", width
    assert 29.0 <= width["value_px"] <= 33.0
    assert periodicity["status"] == "measured", periodicity
    assert 19.0 <= periodicity["value_px"] <= 21.0
    assert periodicity["landmarks"]["threaded_shank_start"]["y_px"] > 300.0
    assert periodicity["landmarks"]["threaded_shank_end"]["y_px"] > 300.0


def test_fastener_length_supports_under_head_and_overall_conventions():
    image = np.full((520, 820, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image)

    cv2.rectangle(image, (220, 300), (270, 400), (25, 25, 25), -1)
    cv2.rectangle(image, (270, 335), (560, 365), (25, 25, 25), -1)

    steps = [
        {
            "operation": "axial_distance",
            "inputs": ["object_tip", "head_underface"],
            "purpose": "突出頭型：頭下到尾端",
        },
        {
            "operation": "axial_distance",
            "inputs": ["object_tip", "head_top"],
            "purpose": "沉頭型：頭頂到尾端 overall length",
        },
    ]

    under_head, overall = execute_geometry_steps(image, marks, 50.0, steps)

    assert under_head["status"] == "measured", under_head
    assert overall["status"] == "measured", overall
    assert 275.0 <= under_head["value_px"] <= 305.0
    assert 325.0 <= overall["value_px"] <= 355.0
    assert overall["value_px"] > under_head["value_px"] + 35.0
    assert set(under_head["landmarks"]) == {"object_tip", "head_underface"}
    assert set(overall["landmarks"]) == {"object_tip", "head_top"}



def test_head_underface_uses_shank_envelope_not_strongest_internal_head_transition():
    image = np.full((520, 900, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image, x0=60, x1=840, px_per_cm=50)

    # Threaded shank ends at x=600. The head begins with a modest 54 px-wide
    # bearing section, then expands much more strongly at x=625. A
    # strongest-transition detector is tempted by the internal head expansion;
    # the physical underface is still the first persistent departure from the
    # ~30 px shank envelope at x=600.
    xs = np.arange(180, 601)
    radius = 14.0 + 2.0 * np.cos(2.0 * np.pi * (xs - 180) / 20.0)
    top = np.column_stack([xs, 350.0 - radius]).astype(np.int32)
    bottom = np.column_stack([xs[::-1], (350.0 + radius)[::-1]]).astype(np.int32)
    cv2.fillPoly(image, [np.vstack([top, bottom])], (25, 25, 25))
    cv2.rectangle(image, (600, 323), (625, 377), (25, 25, 25), -1)
    cv2.rectangle(image, (625, 285), (700, 415), (25, 25, 25), -1)

    step = {
        "operation": "axial_distance",
        "inputs": ["object_tip", "head_underface"],
        "purpose": "physical under-head length",
    }
    result = execute_geometry_steps(image, marks, 50.0, [step])[0]

    assert result["status"] == "measured", result
    underface_x = result["landmarks"]["head_underface"]["x_px"]
    assert 594.0 <= underface_x <= 610.0, result
    assert 410.0 <= result["value_px"] <= 430.0, result
    assert result["diagnostics"]["head_expansion_threshold_px"] > result["diagnostics"]["shank_outer_px"]



def test_head_underface_skips_runout_fillet_and_uses_bearing_plane():
    image = np.full((520, 900, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image, x0=60, x1=840, px_per_cm=50)

    # Threaded shank -> gradual runout/fillet -> bearing shoulder -> larger head.
    # The physical L anchor is x=590. A "first persistent widening" rule is
    # pulled left into the fillet and therefore reports a systematically short L.
    xs = np.arange(180, 561)
    radius = 14.0 + 2.0 * np.cos(2.0 * np.pi * (xs - 180) / 20.0)
    top = np.column_stack([xs, 350.0 - radius]).astype(np.int32)
    bottom = np.column_stack([xs[::-1], (350.0 + radius)[::-1]]).astype(np.int32)
    cv2.fillPoly(image, [np.vstack([top, bottom])], (25, 25, 25))

    fillet_x = np.arange(560, 591)
    fillet_radius = np.linspace(16.0, 22.0, len(fillet_x))
    fillet_top = np.column_stack([fillet_x, 350.0 - fillet_radius]).astype(np.int32)
    fillet_bottom = np.column_stack(
        [fillet_x[::-1], (350.0 + fillet_radius)[::-1]]
    ).astype(np.int32)
    cv2.fillPoly(image, [np.vstack([fillet_top, fillet_bottom])], (25, 25, 25))

    cv2.rectangle(image, (590, 312), (620, 388), (25, 25, 25), -1)
    cv2.rectangle(image, (620, 285), (700, 415), (25, 25, 25), -1)

    step = {
        "operation": "axial_distance",
        "inputs": ["object_tip", "head_underface"],
        "purpose": "physical under-head length",
    }
    result = execute_geometry_steps(image, marks, 50.0, [step])[0]

    assert result["status"] == "measured", result
    underface_x = result["landmarks"]["head_underface"]["x_px"]
    assert 586.0 <= underface_x <= 594.0, result
    assert 400.0 <= result["value_px"] <= 420.0, result


def test_head_underface_waits_for_projected_shoulder_to_settle():
    image = np.full((520, 900, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image, x0=60, x1=840, px_per_cm=50)

    # A slightly oblique view projects one physical bearing plane into a
    # finite-width silhouette shoulder. The first expansion is x~600, but the
    # shoulder does not settle into the head footprint until x~620. L must use
    # the settled bearing-plane proxy instead of the first widening pixel.
    xs = np.arange(180, 601)
    radius = 14.0 + 2.0 * np.cos(2.0 * np.pi * (xs - 180) / 20.0)
    top = np.column_stack([xs, 350.0 - radius]).astype(np.int32)
    bottom = np.column_stack([xs[::-1], (350.0 + radius)[::-1]]).astype(np.int32)
    cv2.fillPoly(image, [np.vstack([top, bottom])], (25, 25, 25))

    shoulder_x = np.arange(600, 626)
    phase = (shoulder_x - 600) / 25.0
    shoulder_radius = 16.0 + 30.0 * np.sin(phase * np.pi / 2.0)
    shoulder_top = np.column_stack(
        [shoulder_x, 350.0 - shoulder_radius]
    ).astype(np.int32)
    shoulder_bottom = np.column_stack(
        [shoulder_x[::-1], (350.0 + shoulder_radius)[::-1]]
    ).astype(np.int32)
    cv2.fillPoly(
        image,
        [np.vstack([shoulder_top, shoulder_bottom])],
        (25, 25, 25),
    )

    # First stable head footprint, followed by a stronger internal transition.
    cv2.rectangle(image, (625, 304), (640, 396), (25, 25, 25), -1)
    cv2.rectangle(image, (640, 285), (700, 415), (25, 25, 25), -1)

    step = {
        "operation": "axial_distance",
        "inputs": ["object_tip", "head_underface"],
        "purpose": "physical under-head length",
    }
    result = execute_geometry_steps(image, marks, 50.0, [step])[0]

    assert result["status"] == "measured", result
    underface_x = result["landmarks"]["head_underface"]["x_px"]
    assert 616.0 <= underface_x <= 624.0, result
    assert 435.0 <= result["value_px"] <= 445.0, result

def test_underface_refuses_uniform_object_instead_of_guessing():
    image = np.full((520, 820, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image)
    cv2.rectangle(image, (220, 335), (560, 365), (25, 25, 25), -1)

    step = {
        "operation": "axial_distance",
        "inputs": ["object_tip", "head_underface"],
        "purpose": "physical under-head length",
    }
    result = execute_geometry_steps(image, marks, 50.0, [step])[0]

    assert result["status"] == "not_measured"
    assert result["reason_codes"] == ["head_underface_not_found"]



def test_major_diameter_combines_phase_shifted_crest_envelopes():
    image = np.full((520, 900, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image, x0=60, x1=840, px_per_cm=50)

    cv2.rectangle(image, (180, 285), (230, 415), (25, 25, 25), -1)
    xs = np.arange(230, 681)
    period = 24.0
    # Deliberately phase-shift upper and lower crests. No single x reaches the
    # true major diameter of 40 px, but each side independently reaches 20 px.
    upper_radius = 16.0 + 4.0 * np.cos(2.0 * np.pi * (xs - 230) / period)
    lower_radius = 16.0 + 4.0 * np.cos(2.0 * np.pi * (xs - 230) / period + np.pi)
    top = np.column_stack([xs, 350.0 - upper_radius]).astype(np.int32)
    bottom = np.column_stack([xs[::-1], (350.0 + lower_radius)[::-1]]).astype(np.int32)
    cv2.fillPoly(image, [np.vstack([top, bottom])], (25, 25, 25))

    width = execute_geometry_steps(image, marks, 50.0, [_width_step()])[0]

    assert width["status"] == "measured", width
    assert 38.0 <= width["value_px"] <= 41.5, width
    assert 7.6 <= width["value_mm"] <= 8.3, width


def test_major_diameter_ignores_single_outward_contour_spike():
    image = np.full((520, 900, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image, x0=60, x1=840, px_per_cm=50)

    cv2.rectangle(image, (180, 285), (230, 415), (25, 25, 25), -1)
    xs = np.arange(230, 681)
    radius = 16.0 + 3.0 * np.cos(2.0 * np.pi * (xs - 230) / 24.0)
    top = np.column_stack([xs, 350.0 - radius]).astype(np.int32)
    bottom = np.column_stack([xs[::-1], (350.0 + radius)[::-1]]).astype(np.int32)
    polygon = np.vstack([top, bottom])
    cv2.fillPoly(image, [polygon], (25, 25, 25))
    # One isolated defect should not become the major diameter.
    cv2.line(image, (450, 331), (450, 315), (25, 25, 25), 1)

    width = execute_geometry_steps(image, marks, 50.0, [_width_step()])[0]

    assert width["status"] == "measured", width
    assert 36.0 <= width["value_px"] <= 40.5, width



def test_phase_shifted_major_diameter_does_not_change_pitch_search():
    image = np.full((520, 900, 3), 245, dtype=np.uint8)
    marks = _draw_ruler(image, x0=60, x1=840, px_per_cm=50)

    cv2.rectangle(image, (180, 285), (230, 415), (25, 25, 25), -1)
    xs = np.arange(230, 681)
    period = 24.0
    upper_radius = 16.0 + 4.0 * np.cos(2.0 * np.pi * (xs - 230) / period)
    lower_radius = 16.0 + 4.0 * np.cos(2.0 * np.pi * (xs - 230) / period + np.pi)
    top = np.column_stack([xs, 350.0 - upper_radius]).astype(np.int32)
    bottom = np.column_stack([xs[::-1], (350.0 + lower_radius)[::-1]]).astype(np.int32)
    cv2.fillPoly(image, [np.vstack([top, bottom])], (25, 25, 25))

    width, periodicity = execute_geometry_steps(
        image,
        marks,
        50.0,
        [_width_step(), _periodicity_step()],
    )

    assert width["status"] == "measured", width
    assert 38.0 <= width["value_px"] <= 41.5, width
    assert periodicity["status"] == "measured", periodicity
    assert 23.0 <= periodicity["value_px"] <= 25.0, periodicity
