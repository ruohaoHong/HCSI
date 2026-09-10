from __future__ import annotations


def error_metrics(actual_mm: float | None, measured_mm: float | None) -> dict[str, float | None]:
    if actual_mm is None or measured_mm is None:
        return {"absolute_error_mm": None, "relative_error_pct": None}

    absolute_error = abs(float(measured_mm) - float(actual_mm))
    relative_error = None if actual_mm == 0 else absolute_error / abs(float(actual_mm)) * 100.0
    return {
        "absolute_error_mm": round(absolute_error, 4),
        "relative_error_pct": None if relative_error is None else round(relative_error, 4),
    }
