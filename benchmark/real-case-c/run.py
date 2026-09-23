"""Controlled real-photo Case C: M14-2.0 x 45 mm hex-head bolt."""
import dataclasses, hashlib, json, pathlib, sys, urllib.request
import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "measurement-service"))

from app import measure_rgb
from geometry import extract_object_geometry
from geometry_executor import execute_geometry_steps, _select_object_contour
from rulernet import infer_ruler, local_px_per_cm
from scale_reference import resolve_scale_reference
from scale_units import infer_visual_scale

OUT = ROOT / "acceptance-results"
OUT.mkdir(parents=True, exist_ok=True)

URL = "https://cdn11.bigcommerce.com/s-1ygf19te2/images/stencil/1280x1280/products/20567/90373/r16b008-6__94664.1667485912.jpg?c=2%3Fimbypass%3Don"
SOURCE = "https://www.dougdeals.com/box-of-250-nucor-m14-2-0-x-45-grade-10-9-metric-hex-head-bolts-zinc-usa-made/"
GROUND_TRUTH = {"D_mm": 14.0, "P_mm": 2.0, "L_mm": 45.0, "head_style": "hex"}

def convert(x):
    if dataclasses.is_dataclass(x): return dataclasses.asdict(x)
    if isinstance(x, np.ndarray): return x.tolist()
    if isinstance(x, np.generic): return x.item()
    raise TypeError(type(x).__name__)

def region(vals):
    return dict(present=True, confidence=0.95, **dict(zip(["x_min","y_min","x_max","y_max"], vals)))

raw = urllib.request.urlopen(URL, timeout=60).read()
sha = hashlib.sha256(raw).hexdigest()
(OUT / "C-original.jpg").write_bytes(raw)
rgb = cv2.cvtColor(cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)

semantic = {
    "target_region": region([0, 60, 1000, 600]),
    "reference_region": region([0, 600, 1000, 900]),
    "head_style": "hex",
}
steps = [
    {"operation": "outer_width", "inputs": ["threaded_shank"], "purpose": "D"},
    {"operation": "periodicity", "inputs": ["threaded_shank"], "purpose": "P"},
    {"operation": "axial_distance", "inputs": ["object_tip", "head_underface"], "purpose": "L"},
]

obs = infer_ruler(rgb)
scale = resolve_scale_reference(rgb, obs)
record = {
    "case": "C",
    "source": SOURCE,
    "ground_truth": GROUND_TRUTH,
    "sha256": sha,
    "image_shape": list(rgb.shape),
    "semantic_input": semantic,
    "steps_input": steps,
    "rulernet": obs,
    "visual_scale": infer_visual_scale(rgb),
    "scale_reference": scale,
}
baseline = measure_rgb(rgb, sha, steps, semantic)
record["baseline_measurement"] = baseline

if scale.px_per_cm:
    geo = extract_object_geometry(
        rgb, scale.reference_points_px, scale.px_per_cm, scale.direction_xy,
        semantic_vision=semantic,
    )
    record["geometry"] = geo
    effective = scale.px_per_cm
    if scale.source in {"rulernet_cm", "rulernet_cm+imperial_ticks"} and geo.center_xy:
        effective = local_px_per_cm(scale.reference_points_px, geo.center_xy) or effective
    record["effective_px_per_cm"] = effective
    record["executor"] = execute_geometry_steps(
        rgb, scale.reference_points_px, effective, steps, semantic_vision=semantic
    )
    contour = _select_object_contour(
        rgb, scale.reference_points_px, effective, semantic_vision=semantic
    )
    overlay = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    if contour is not None:
        record["selected_contour_bbox_xywh"] = cv2.boundingRect(contour)
        cv2.drawContours(overlay, [contour], -1, (0,200,0), 2)
    for p in scale.reference_points_px:
        cv2.circle(overlay, tuple(np.rint(p).astype(int)), 4, (0,0,255), -1)
    for step in record.get("executor", []):
        for name, p in step.get("landmarks", {}).items():
            if p.get("x_px") is not None and p.get("y_px") is not None:
                xy = (int(round(p["x_px"])), int(round(p["y_px"])))
                cv2.circle(overlay, xy, 5, (255,0,0), -1)
                cv2.putText(overlay, name, xy, cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255,0,0), 1)
    cv2.imwrite(str(OUT / "C-controlled-overlay.png"), overlay)

(OUT / "C-controlled.json").write_text(json.dumps(record, ensure_ascii=False, indent=2, default=convert))
print(json.dumps({
    "baseline": baseline,
    "executor": record.get("executor"),
    "geometry": dataclasses.asdict(record["geometry"]) if "geometry" in record else None,
    "scale_reference": dataclasses.asdict(scale),
}, ensure_ascii=False, indent=2, default=convert))
