from __future__ import annotations

import base64
import hashlib
import json
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SERVICE_DIR = ROOT / "measurement-service"
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "generated"
sys.path.insert(0, str(SERVICE_DIR))

from app import measure_rgb  # noqa: E402


def decode_fixture(name: str, destination: Path) -> None:
    parts = sorted(FIXTURE_DIR.glob(f"{name}.jpg.b64.part*"))
    if parts:
        encoded = "".join(part.read_text(encoding="utf-8").strip() for part in parts)
    else:
        encoded = (FIXTURE_DIR / f"{name}.jpg.b64").read_text(encoding="utf-8").strip()
    raw = base64.b64decode(encoded, validate=True)
    if not raw.startswith(b"\xff\xd8"):
        raise RuntimeError(f"{name}: decoded fixture is not a JPEG")
    destination.write_bytes(raw)


def run_case(name: str, image_path: Path, source_kind: str) -> dict:
    raw = image_path.read_bytes()
    image_bgr = cv2.imdecode(np.frombuffer(raw, dtype="uint8"), cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise RuntimeError(f"{name}: unable to decode image")
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    result = measure_rgb(image_rgb, hashlib.sha256(raw).hexdigest())

    status = result["measurement_status"]
    valid = result["measurement_valid"]
    assert status in {"valid", "no_reference", "unreliable"}
    assert result["analysis_mode"] == ("measurement_assisted" if valid else "appearance_only")
    if not valid:
        assert result["length_mm"] is None
        assert result["width_mm"] is None
        assert result["scale_px_per_cm"] is None

    return {
        "case": name,
        "source_kind": source_kind,
        "measurement_status": status,
        "analysis_mode": result["analysis_mode"],
        "measurement_valid": valid,
        "retry_recommended": result["retry_recommended"],
        "length_mm": result["length_mm"],
        "width_mm": result["width_mm"],
        "scale_px_per_cm": result["scale_px_per_cm"],
        "reason_codes": result["reason_codes"],
        "ruler": result["ruler"],
        "object": result["object"],
    }


def main() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        image_path = Path(temp_dir) / "bolt_ruler_case.jpg"
        decode_fixture("bolt_ruler_case", image_path)
        result = run_case("A_generated_bolt_with_ruler", image_path, "generated_integration_fixture")

    Path("measurement-integration-results.json").write_text(
        json.dumps([result], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
