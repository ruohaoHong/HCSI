import pathlib
import sys


SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from confidence_gate import (  # noqa: E402
    determine_confidence_status,
    evaluate_measurement_confidence,
    normalize_capture_evidence,
)


def _ruler(**overrides):
    result = {
        "detected": True,
        "mark_count": 8,
        "scale_system": "metric",
        "scale_source": "metric_ticks",
        "px_per_cm": 100.0,
        "perspective_step_pct": 1.2,
        "perspective_ok": True,
    }
    result.update(overrides)
    return result


def _object(**overrides):
    result = {
        "detected": True,
        "contour_reliable": True,
        "segmentation_method": (
            "physical_contour_selection:appearance"
            "+semantic_roi+semantic_reference_exclusion"
        ),
        "risk_signals": [],
        "semantic_target_region": {"present": True, "confidence": 0.96},
        "semantic_reference_region": {"present": True, "confidence": 0.94},
    }
    result.update(overrides)
    return result


def _measured_step(operation="outer_width"):
    return {
        "operation": operation,
        "inputs": ["threaded_shank"],
        "status": "measured",
        "value_px": 50.0,
        "value_mm": 5.0,
        "reason_codes": [],
    }


def _capture():
    return {
        "same_plane": {
            "status": "verified",
            "source": "manual_confirmation",
        },
        "near_overhead": {
            "status": "verified",
            "source": "calibrated_capture",
        },
    }


def _evaluate(**overrides):
    inputs = {
        "measurement_status": "valid",
        "has_measurement": True,
        "ruler": _ruler(),
        "object_evidence": _object(),
        "geometry_steps": [_measured_step()],
        "capture_evidence": _capture(),
    }
    inputs.update(overrides)
    return evaluate_measurement_confidence(**inputs)


def _check(result, check_id):
    return next(check for check in result["checks"] if check["id"] == check_id)


def test_measured_is_distinct_from_verified_before_checks_run():
    assert determine_confidence_status(True, []) == "measured"
    assert determine_confidence_status(False, []) == "not_measured"


def test_missing_scale_is_not_measured_and_preserves_appearance_only_path():
    result = _evaluate(
        measurement_status="no_reference",
        has_measurement=False,
        ruler=_ruler(
            detected=False,
            mark_count=0,
            scale_system="unknown",
            scale_source="none",
            px_per_cm=None,
            perspective_step_pct=None,
            perspective_ok=False,
        ),
        geometry_steps=[],
        capture_evidence=None,
    )

    assert result["status"] == "not_measured"
    assert result["measurement_state"] == "not_measured"
    assert "scale_reference_not_confirmed" in result["reason_codes"]
    assert _check(result, "scale_available")["status"] == "failed"
    assert result["verified_for_purchase_spec"] is False


def test_scale_quality_insufficient_keeps_value_but_marks_uncertain():
    result = _evaluate(ruler=_ruler(mark_count=3))

    assert result["status"] == "uncertain"
    assert result["measurement_state"] == "measured"
    assert "scale_observation_support_insufficient" in result["reason_codes"]
    assert _check(result, "scale_observation_support")["evidence"] == {
        "reference_point_count": 3,
        "minimum_required": 4,
    }


def test_perspective_risk_is_exposed_without_changing_the_measurement():
    result = _evaluate(
        ruler=_ruler(perspective_step_pct=8.5, perspective_ok=False)
    )

    assert result["status"] == "uncertain"
    assert "perspective_risk_detected" in result["reason_codes"]
    assert _check(result, "perspective_risk")["status"] == "failed"
    assert any(
        item["code"] == "retake_near_overhead"
        for item in result["recommendations"]
    )


def test_same_plane_remains_unknown_without_independent_evidence():
    result = _evaluate(capture_evidence=None)

    same_plane = _check(result, "same_plane")
    assert result["status"] == "uncertain"
    assert same_plane["status"] == "unknown"
    assert same_plane["reason_code"] == "same_plane_unverified"
    assert same_plane["evidence"]["inferred_from_image"] is False
    assert "same_plane_unverified" in result["reason_codes"]


def test_partial_geometry_failure_is_not_promoted_to_verified():
    failed = {
        "operation": "periodicity",
        "inputs": ["threaded_shank"],
        "status": "not_measured",
        "value_px": None,
        "value_mm": None,
        "reason_codes": ["periodicity_signal_weak"],
    }
    result = _evaluate(geometry_steps=[_measured_step(), failed])

    assert result["status"] == "uncertain"
    assert "geometry_steps_incomplete" in result["reason_codes"]
    assert "periodicity_signal_weak" in result["reason_codes"]
    assert _check(result, "geometry_steps_complete")["evidence"]["measured"] == 1


def test_complete_explicit_evidence_can_be_verified():
    result = _evaluate(
        geometry_steps=[
            _measured_step("outer_width"),
            _measured_step("periodicity"),
            _measured_step("axial_distance"),
        ]
    )

    assert result["status"] == "verified"
    assert result["reason_codes"] == []
    assert result["verified_for_purchase_spec"] is True
    assert all(
        check["status"] == "passed"
        for check in result["checks"]
        if check["required"]
    )


def test_capture_claim_requires_supported_evidence_source():
    try:
        normalize_capture_evidence(
            {"same_plane": {"status": "verified", "source": "image_proximity"}}
        )
    except ValueError as exc:
        assert "source is unsupported" in str(exc)
    else:
        raise AssertionError("unsupported co-planarity claim was accepted")
