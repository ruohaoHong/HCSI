from __future__ import annotations

import base64
import hashlib
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[2]
SERVICE_DIR = ROOT / "measurement-service"
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "generated"
sys.path.insert(0, str(SERVICE_DIR))

from app import measure_rgb  # noqa: E402

ZHENYU_IMAGE_URL = "https://s3.zhenyu.com.tw/public/upload/ald5/upload/ald5/41CWS2.jpg"


def decode_fixture(name: str, destination: Path) -> None:
    encoded = (FIXTURE_DIR / f"{name}.jpg.b64").read_text(encoding="utf-8").strip()
    raw = base64.b64decode(encoded, validate=True)
    if not raw.startswith(b"\xff\xd8"):
        raise RuntimeError(f"{name}: decoded fixture is not a JPEG")
    destination.write_bytes(raw)


def download_real_case(destination: Path) -> None:
    request = urllib.request.Request(
        ZHENYU_IMAGE_URL,
        headers={"User-Agent": "Mozilla/5.0 HCSI measurement integration test"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
    if not raw:
        raise RuntimeError("Zhenyu fixture download returned an empty response")
    destination.write_bytes(raw)


def run_case(name: str, image_path: Path, source_kind: str) -> dict:
    raw = image_path.read_bytes()
    image_bgr = cv2.imdecode(__import__("numpy").frombuffer(raw, dtype="uint8"), cv2.IMREAD_COLOR)
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
    results: list[dict] = []
    with tempfile.TemporaryDirectory() as temp_dir:
        temp = Path(temp_dir)
        for fixture_name, case_name in [
            ("bolt_ruler_case", "A_generated_bolt_with_ruler"),
            ("screw_easy_case", "B1_generated_easy_screw_with_ruler"),
            ("screw_hard_case", "B2_generated_hard_screw_with_ruler"),
        ]:
            image_path = temp / f"{fixture_name}.jpg"
            decode_fixture(fixture_name, image_path)
            results.append(run_case(case_name, image_path, "generated_integration_fixture"))

        real_path = temp / "zhenyu_A_anchor_2fen.jpg"
        download_real_case(real_path)
        results.append(run_case("C_real_zhenyu_A_anchor_no_ruler", real_path, "real_taiwan_retailer_photo"))

    output = Path("measurement-integration-results.json")
    output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    for result in results:
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
