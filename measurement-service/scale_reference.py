from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

from ruler_span import expand_reference_points_to_ruler_body
from rulernet import RulerObservation
from scale_units import ScaleSystem, infer_visual_scale

ScaleSource = Literal[
    "rulernet_cm",
    "imperial_ticks",
    "rulernet_cm+imperial_ticks",
    "visual_dual",
    "none",
]

IMPERIAL_MIN_CONFIDENCE = 0.62
DUAL_SCALE_MAX_RELATIVE_DELTA = 0.08


@dataclass(frozen=True)
class ScaleReference:
    system: ScaleSystem
    source: ScaleSource
    confidence: float
    px_per_cm: float | None
    px_per_inch: float | None
    reference_points_px: np.ndarray
    reference_interval_cm: float | None
    direction_xy: tuple[float, float] | None
    perspective_step_pct: float | None
    reason_codes: tuple[str, ...]


def _empty(reason: str) -> ScaleReference:
    return ScaleReference(
        system="unknown",
        source="none",
        confidence=0.0,
        px_per_cm=None,
        px_per_inch=None,
        reference_points_px=np.empty((0, 2), dtype=np.float32),
        reference_interval_cm=None,
        direction_xy=None,
        perspective_step_pct=None,
        reason_codes=(reason,),
    )


def _visual_reference_points(image_rgb: np.ndarray, visual) -> np.ndarray:
    if visual.px_per_cm is None:
        return visual.reference_points_px.astype(np.float32)
    return expand_reference_points_to_ruler_body(
        image_rgb,
        visual.reference_points_px,
        visual.direction_xy,
        float(visual.px_per_cm),
    )


def resolve_scale_reference(image_rgb: np.ndarray, ruler: RulerObservation) -> ScaleReference:
    visual = infer_visual_scale(image_rgb)
    metric_available = (
        ruler.detected
        and ruler.median_px_per_cm is not None
        and np.isfinite(ruler.median_px_per_cm)
        and ruler.median_px_per_cm > 0
        and len(ruler.mark_points_px) >= 2
    )

    imperial_available = (
        visual.system == "imperial"
        and visual.confidence >= IMPERIAL_MIN_CONFIDENCE
        and visual.px_per_cm is not None
        and visual.px_per_inch is not None
        and visual.reference_interval_cm is not None
        and len(visual.reference_points_px) >= 2
    )

    if metric_available:
        metric_px_per_cm = float(ruler.median_px_per_cm)
        if imperial_available:
            relative_delta = abs(metric_px_per_cm - float(visual.px_per_cm)) / max(
                metric_px_per_cm,
                float(visual.px_per_cm),
            )
            if relative_delta <= DUAL_SCALE_MAX_RELATIVE_DELTA:
                return ScaleReference(
                    system="dual",
                    source="rulernet_cm+imperial_ticks",
                    confidence=min(1.0, max(visual.confidence, 0.85)),
                    px_per_cm=metric_px_per_cm,
                    px_per_inch=metric_px_per_cm * 2.54,
                    reference_points_px=ruler.mark_points_px.astype(np.float32),
                    reference_interval_cm=1.0,
                    direction_xy=ruler.direction_xy,
                    perspective_step_pct=None,
                    reason_codes=(),
                )

        # RulerNet is trained on centimeter marks and explicitly ignores inch
        # marks. If its cm sequence is valid, keep it as the authoritative
        # metric scale even when the generic visual tick heuristic finds a
        # conflicting pattern elsewhere in the image.
        return ScaleReference(
            system="metric",
            source="rulernet_cm",
            confidence=1.0,
            px_per_cm=metric_px_per_cm,
            px_per_inch=metric_px_per_cm * 2.54,
            reference_points_px=ruler.mark_points_px.astype(np.float32),
            reference_interval_cm=1.0,
            direction_xy=ruler.direction_xy,
            perspective_step_pct=None,
            reason_codes=(),
        )

    if imperial_available:
        return ScaleReference(
            system="imperial",
            source="imperial_ticks",
            confidence=visual.confidence,
            px_per_cm=float(visual.px_per_cm),
            px_per_inch=float(visual.px_per_inch),
            reference_points_px=_visual_reference_points(image_rgb, visual),
            reference_interval_cm=float(visual.reference_interval_cm),
            direction_xy=visual.direction_xy,
            perspective_step_pct=visual.perspective_step_pct,
            reason_codes=visual.reason_codes,
        )

    if (
        visual.system == "dual"
        and visual.confidence >= IMPERIAL_MIN_CONFIDENCE
        and visual.px_per_cm is not None
        and visual.reference_interval_cm is not None
        and len(visual.reference_points_px) >= 2
    ):
        return ScaleReference(
            system="dual",
            source="visual_dual",
            confidence=visual.confidence,
            px_per_cm=float(visual.px_per_cm),
            px_per_inch=float(visual.px_per_cm * 2.54),
            reference_points_px=_visual_reference_points(image_rgb, visual),
            reference_interval_cm=float(visual.reference_interval_cm),
            direction_xy=visual.direction_xy,
            perspective_step_pct=visual.perspective_step_pct,
            reason_codes=visual.reason_codes,
        )

    return _empty("scale_unit_unconfirmed")
