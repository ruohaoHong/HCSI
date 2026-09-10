import pathlib
import sys

SERVICE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))

from scoring import error_metrics  # noqa: E402


def test_error_metrics_example():
    result = error_metrics(40.0, 39.7)
    assert result["absolute_error_mm"] == 0.3
    assert result["relative_error_pct"] == 0.75


def test_error_metrics_handles_missing_measurement():
    result = error_metrics(40.0, None)
    assert result == {"absolute_error_mm": None, "relative_error_pct": None}
