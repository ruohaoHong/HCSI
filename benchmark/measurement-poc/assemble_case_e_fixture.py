"""Reassemble the committed, immutable Case E WebP derivative.

This utility does not generate or re-encode an image. It only concatenates the
versioned base64 parts and verifies the locked derivative SHA-256.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CASES = ROOT / "benchmark" / "measurement-poc" / "cases"
MANIFEST = CASES / "real-cases-v1.json"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    case_e = next(case for case in manifest["cases"] if case["id"] == "E")
    expected = case_e["repository_derivative"]["sha256"]
    parts = sorted(CASES.glob("case-e-m3x30-q80.part*.b64"))
    if not parts:
        raise RuntimeError("Case E base64 parts are missing")
    encoded = "".join(part.read_text(encoding="ascii").strip() for part in parts)
    raw = base64.b64decode(encoded, validate=True)
    actual = hashlib.sha256(raw).hexdigest()
    if actual != expected:
        raise RuntimeError(f"Case E derivative SHA mismatch: expected {expected}, got {actual}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(raw)
    print(f"Case E derivative verified: {actual}")


if __name__ == "__main__":
    main()
