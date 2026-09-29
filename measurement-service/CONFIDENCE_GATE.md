# Measurement Confidence Gate

`measurement_status` continues to describe whether the existing measurement
pipeline can return absolute dimensions. The confidence gate is an additive,
independent evidence layer; it never recalculates D, P, L, or scale.

## Output

Every response adds:

```json
{
  "measurement_confidence": "uncertain",
  "confidence_evaluation": {
    "status": "uncertain",
    "measurement_state": "measured",
    "reason_codes": ["same_plane_unverified"],
    "checks": [
      {
        "id": "same_plane",
        "status": "unknown",
        "required": true,
        "reason_code": "same_plane_unverified",
        "evidence": {"source": null, "inferred_from_image": false}
      }
    ],
    "recommendations": [
      {
        "code": "confirm_same_plane",
        "message": "請將尺與五金平放在同一硬質平面後重拍；目前無法由單張照片確認共面。"
      }
    ],
    "verified_for_purchase_spec": false
  }
}
```

No percentage confidence score is emitted.

### Confidence states

| State | Meaning |
|---|---|
| `measured` | A value exists, but no verification policy has run yet. Reserved for staged callers. |
| `verified` | A value exists and every explicitly defined required check passed. |
| `uncertain` | A value exists, but a required check failed or remains unknown. The value is retained as an unverified estimate and must not be presented as a purchase specification. |
| `not_measured` | No measurement value was produced. Appearance-only identification remains available. |

`measurement_status`, `measurement_valid`, geometry-step `status`, and all
existing numeric fields keep their original meaning and shape.

## Checks

The current evaluator reports:

- scale availability and observable reference-point support;
- one-dimensional perspective progression and its existing risk gate;
- object detection and contour reliability;
- segmentation risk signals;
- semantic target/reference consistency with the contour path;
- requested geometry-step completion, including each individual step;
- ruler/hardware co-planarity;
- near-overhead capture evidence.

Check states are `passed`, `failed`, `unknown`, or `not_applicable`.

## Co-planarity and capture evidence

A single image currently cannot independently verify that the ruler and the
hardware occupy the same physical plane. Clear ticks, low ruler progression,
parallel axes, and spatial proximity are not substitutes for that evidence.
Therefore the normal single-image API path emits:

```json
{
  "same_plane_status": "unknown",
  "same_plane_verified": false
}
```

The evaluator accepts optional evidence with a deliberately narrow schema for
future calibrated capture or explicit human confirmation:

```json
{
  "same_plane": {
    "status": "verified",
    "source": "manual_confirmation"
  },
  "near_overhead": {
    "status": "verified",
    "source": "calibrated_capture"
  }
}
```

Accepted evaluator sources are `manual_confirmation`, `calibrated_capture`,
and `multi_view_calibration`. Image proximity is intentionally not accepted as
a verification source. The current `/measure` endpoint does not accept or
derive this external evidence, so its single-image path keeps both capture
conditions `unknown`. The schema is reserved for a separately authorized
future capture or human-confirmation workflow.

## Reason codes

| Reason code | Interpretation |
|---|---|
| `scale_reference_not_confirmed` | No usable absolute scale was established. |
| `scale_observation_support_insufficient` | Fewer than four observable reference points support the scale. |
| `perspective_risk_detected` | The existing perspective gate detected excessive progression. |
| `perspective_evidence_unavailable` | Perspective progression could not be observed. |
| `object_geometry_unreliable` | Object detection or contour reliability failed. |
| `segmentation_risk_detected` | Observable segmentation risk signals remain. |
| `semantic_target_unconfirmed` | The semantic target was absent or did not control the selected contour. |
| `semantic_reference_unconfirmed` | The semantic reference was absent or could not be safely applied. |
| `geometry_steps_not_requested` | Only envelope dimensions exist; no semantic D/P/L step was requested. |
| `geometry_steps_incomplete` | At least one requested geometry step did not produce a measurement. |
| `same_plane_unverified` | Co-planarity has no independent evidence. |
| `same_plane_rejected` | Supplied external evidence says the objects are not co-planar. |
| `capture_orientation_unverified` | Near-overhead capture has no independent evidence. |
| `capture_orientation_rejected` | Supplied external evidence rejects the capture orientation. |

An individual failed geometry step also contributes its existing reason code,
such as `periodicity_signal_weak`.

## Consumer rule

Only `measurement_confidence=verified` may be presented as verified purchase
specification evidence. `measured` and `uncertain` preserve their numeric
estimates for diagnosis and user review, but consumers must label them as
unverified and show the supplied recommendations.
