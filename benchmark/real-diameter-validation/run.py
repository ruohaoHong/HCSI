"""Real-photo validation for the physical head-underface primitive.

Controlled semantics only: no VLM/API call. Production geometry code is used.
"""
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

OUT = ROOT / "acceptance-results"
OUT.mkdir(parents=True, exist_ok=True)

CASES = [
    {
        "id": "B",
        "url": "https://cdn11.bigcommerce.com/s-1ygf19te2/images/stencil/1280x1280/products/20420/89736/r20b002-5__33578.1667485725.jpg?c=2?imbypass=on",
        "source": "https://www.dougdeals.com/box-of-1-000-m6-1-0-x-40mm-din-965-phillips-flat-head-machine-screws-zinc/",
        "ground_truth": {"D_mm": 6.0, "P_mm": 1.0, "L_mm": 40.0, "head_style": "flat_countersunk"},
        "target": [50,245,970,515],
        "reference": [50,535,1000,850],
    },
    {
        "id": "C",
        "url": "https://cdn11.bigcommerce.com/s-1ygf19te2/images/stencil/1280x1280/products/20567/90373/r16b008-6__94664.1667485912.jpg?c=2%3Fimbypass%3Don",
        "source": "https://www.dougdeals.com/box-of-250-nucor-m14-2-0-x-45-grade-10-9-metric-hex-head-bolts-zinc-usa-made/",
        "ground_truth": {"D_mm": 14.0, "P_mm": 2.0, "L_mm": 45.0, "head_style": "hex"},
        "target": [0,60,1000,600],
        "reference": [0,600,1000,900],
    },
]

def convert(x):
    if dataclasses.is_dataclass(x): return dataclasses.asdict(x)
    if isinstance(x, np.ndarray): return x.tolist()
    if isinstance(x, np.generic): return x.item()
    raise TypeError(type(x).__name__)

def region(vals):
    return dict(present=True, confidence=0.95, **dict(zip(["x_min","y_min","x_max","y_max"], vals)))

def save(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, default=convert))

for case in CASES:
    raw = urllib.request.urlopen(case["url"], timeout=60).read()
    rgb = cv2.cvtColor(cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
    (OUT / f'{case["id"]}-original.jpg').write_bytes(raw)

    sem = {
        "target_region": region(case["target"]),
        "reference_region": region(case["reference"]),
        "head_style": case["ground_truth"]["head_style"],
    }
    anchor = "head_top" if sem["head_style"] == "flat_countersunk" else "head_underface"
    steps = [
        {"operation":"outer_width","inputs":["threaded_shank"],"purpose":"D"},
        {"operation":"periodicity","inputs":["threaded_shank"],"purpose":"P"},
        {"operation":"axial_distance","inputs":["object_tip",anchor],"purpose":"L"},
    ]

    obs = infer_ruler(rgb)
    scale = resolve_scale_reference(rgb, obs)
    sha = hashlib.sha256(raw).hexdigest()
    record = {
        "case": case["id"],
        "source": case["source"],
        "ground_truth": case["ground_truth"],
        "sha256": sha,
        "semantic_input": sem,
        "scale_reference": scale,
        "baseline_measurement": measure_rgb(rgb, sha, steps, sem),
    }

    if scale.px_per_cm:
        geo = extract_object_geometry(
            rgb, scale.reference_points_px, scale.px_per_cm, scale.direction_xy,
            semantic_vision=sem,
        )
        effective = scale.px_per_cm
        if scale.source in {"rulernet_cm","rulernet_cm+imperial_ticks"} and geo.center_xy:
            effective = local_px_per_cm(scale.reference_points_px, geo.center_xy) or effective
        result = execute_geometry_steps(
            rgb, scale.reference_points_px, effective, steps, semantic_vision=sem
        )
        record["geometry"] = geo
        record["effective_px_per_cm"] = effective
        record["executor"] = result

        overlay = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        contour = _select_object_contour(
            rgb, scale.reference_points_px, effective, semantic_vision=sem
        )
        if contour is not None:
            cv2.drawContours(overlay, [contour], -1, (0,200,0), 2)
        for p in scale.reference_points_px:
            cv2.circle(overlay, tuple(np.rint(p).astype(int)), 4, (0,0,255), -1)
        for step in result:
            for name,p in step.get("landmarks",{}).items():
                if p.get("x_px") is not None and p.get("y_px") is not None:
                    xy=(int(round(p["x_px"])),int(round(p["y_px"])))
                    cv2.circle(overlay,xy,5,(255,0,0),-1)
                    cv2.putText(overlay,name,xy,cv2.FONT_HERSHEY_SIMPLEX,0.35,(255,0,0),1)
        cv2.imwrite(str(OUT / f'{case["id"]}-overlay.png'), overlay)

    save(OUT / f'{case["id"]}.json', record)
    print(case["id"], json.dumps(record.get("executor"), ensure_ascii=False, default=convert), flush=True)
