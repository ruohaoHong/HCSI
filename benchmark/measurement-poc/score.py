from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

SERVICE_DIR = Path(__file__).resolve().parents[2] / "measurement-service"
sys.path.insert(0, str(SERVICE_DIR))

from scoring import error_metrics  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Score HCSI measurement results against pre-recorded ground truth.")
    parser.add_argument("input", type=Path, help="JSON file containing benchmark cases")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    rows = []
    for case in payload.get("cases", []):
        measurement = case.get("measurement", {})
        length = error_metrics(case.get("actual_length_mm"), measurement.get("length_mm"))
        width = error_metrics(case.get("actual_width_mm"), measurement.get("width_mm"))
        rows.append({"id": case.get("id"), "measurement_valid": bool(measurement.get("measurement_valid")), "length": length, "width": width})
    valid = [row for row in rows if row["measurement_valid"]]
    length_errors = [row["length"]["absolute_error_mm"] for row in valid if row["length"]["absolute_error_mm"] is not None]
    summary = {
        "cases": len(rows),
        "measurement_valid": len(valid),
        "valid_rate_pct": round((len(valid) / len(rows) * 100.0), 2) if rows else 0.0,
        "mean_absolute_length_error_mm": round(sum(length_errors) / len(length_errors), 4) if length_errors else None,
    }
    output = {"summary": summary, "cases": rows}
    text = json.dumps(output, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main()
