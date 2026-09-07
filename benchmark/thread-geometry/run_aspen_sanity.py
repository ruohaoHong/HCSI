from __future__ import annotations

import importlib.util
import json
import sys
from dataclasses import asdict
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
MEASURE_PATH = ROOT / "measure.py"

spec = importlib.util.spec_from_file_location("thread_measure", MEASURE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("Could not import measure.py")
measure_mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = measure_mod
spec.loader.exec_module(measure_mod)


def extract_line_drawing_silhouette(page_path: Path, crop_frac: tuple[float, float, float, float], out_path: Path) -> Path:
    """Crop a clean threaded-shaft section from an Aspen engineering drawing.

    The source drawing is horizontal. We threshold dark vector lines, take the
    outer envelope row-by-row inside the tightly controlled threaded ROI, fill
    that envelope into a solid silhouette, then rotate it vertical so the same
    photo measurement code can be used.

    crop_frac is expressed as fractions of full page width/height and contains
    no screw-size label, dimensions text, or arrowheads.
    """
    page = cv2.imread(str(page_path), cv2.IMREAD_GRAYSCALE)
    if page is None:
        raise FileNotFoundError(page_path)

    h, w = page.shape
    fx1, fy1, fx2, fy2 = crop_frac
    x1, x2 = int(w * fx1), int(w * fx2)
    y1, y2 = int(h * fy1), int(h * fy2)
    crop = page[y1:y2, x1:x2]
    if crop.size == 0:
        raise RuntimeError("Empty engineering-drawing crop")

    # Vector screw geometry is nearly black; watermark/centerlines are lighter.
    dark = crop < 90
    silhouette = np.zeros_like(crop, dtype=np.uint8)

    valid_rows = 0
    for y in range(crop.shape[0]):
        xs = np.flatnonzero(dark[y])
        if xs.size < 2:
            continue
        # Ignore isolated annotation fragments: require a plausible threaded span.
        span = int(xs[-1] - xs[0])
        if span < max(20, int(crop.shape[1] * 0.20)):
            continue
        silhouette[y, xs[0]: xs[-1] + 1] = 255
        valid_rows += 1

    if valid_rows < 20:
        raise RuntimeError(f"Too few silhouette rows extracted: {valid_rows}")

    # Rotate horizontal shaft to vertical, matching measure.py's current assumptions.
    vertical = cv2.rotate(silhouette, cv2.ROTATE_90_CLOCKWISE)

    # Add a black border so central-component logic has unambiguous background.
    vertical = cv2.copyMakeBorder(vertical, 12, 12, 12, 12, cv2.BORDER_CONSTANT, value=0)
    cv2.imwrite(str(out_path), vertical)
    return out_path


def run_one(name: str, page_png: Path, crop_frac: tuple[float, float, float, float], theory: float) -> dict:
    sample_path = ROOT / f"{name}-ideal-silhouette.png"
    extract_line_drawing_silhouette(page_png, crop_frac, sample_path)
    img = cv2.imread(str(sample_path), cv2.IMREAD_GRAYSCALE)
    assert img is not None
    h, w = img.shape
    result = measure_mod.measure(sample_path, (0, 0, w, h))
    payload = asdict(result)
    payload["sample"] = name
    payload["theoretical_p_over_d"] = theory
    payload["absolute_error"] = abs(payload["p_over_d"] - theory)
    return payload


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: run_aspen_sanity.py <m6-page.png> <m8-page.png>")

    m6_page = Path(sys.argv[1])
    m8_page = Path(sys.argv[2])

    # Crops are fixed page-relative windows chosen from the engineering drawing layout,
    # not tuned from the numerical result. They isolate only repeated thread geometry.
    results = [
        run_one("aspen-m6x1.0", m6_page, (0.595, 0.505, 0.715, 0.640), 1.0 / 6.0),
        run_one("aspen-m8x1.25", m8_page, (0.480, 0.505, 0.615, 0.640), 1.25 / 8.0),
    ]

    out = ROOT / "aspen-sanity-results.json"
    out.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
