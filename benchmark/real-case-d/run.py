"""Controlled real-photo Case D: NAS220-6, #8-32 x 13/32 inch pan head."""
import dataclasses, hashlib, html, json, pathlib, re, sys, urllib.parse, urllib.request
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

SOURCE = "https://www.univair.com/hardware/nas220-6-pan-head-machine-screw/"
GROUND_TRUTH = {
    "spec": "#8-32 x 13/32 inch",
    "D_mm": 4.1656,
    "P_mm": 0.79375,
    "L_mm": 10.31875,
    "head_style": "pan",
    "length_convention": "head_underface_to_tip",
}

def convert(x):
    if dataclasses.is_dataclass(x): return dataclasses.asdict(x)
    if isinstance(x, np.ndarray): return x.tolist()
    if isinstance(x, np.generic): return x.item()
    raise TypeError(type(x).__name__)

def region(vals):
    return dict(present=True, confidence=0.95, **dict(zip(["x_min","y_min","x_max","y_max"], vals)))

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0 HCSI acceptance"})
    return urllib.request.urlopen(req, timeout=60).read()

image_url = "https://cdn11.bigcommerce.com/s-dtwuls/images/stencil/1280x1280/products/25069/10465/nas220-6__83774.1494512951.jpg?c=2"
raw = fetch(image_url)
decoded = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
if decoded is None:
    raise RuntimeError(f"image decode failed: {image_url}")
rgb = cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB)
(OUT / "D-original.jpg").write_bytes(raw)

# Controlled semantics: no VLM call.  Regions are deliberately coarse.
# Screw is horizontal in the upper-right quadrant; bottom scale is horizontal
# and parallel to it, matching the first-version capture contract.
semantic = {
    "target_region": region([285, 390, 735, 650]),
    "reference_region": region([210, 615, 1000, 815]),
    "head_style": "pan",
}
steps = [
    {"operation":"outer_width","inputs":["threaded_shank"],"purpose":"D"},
    {"operation":"periodicity","inputs":["threaded_shank"],"purpose":"P"},
    {"operation":"axial_distance","inputs":["object_tip","head_underface"],"purpose":"L"},
]

import scale_units
gray_debug = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
edges_debug = cv2.Canny(cv2.GaussianBlur(gray_debug, (5, 5), 0), 45, 135)
short_debug = scale_units._short_lines(edges_debug)
long_debug = scale_units._long_lines(edges_debug)
borderless_debug = scale_units._borderless_pattern_candidates(short_debug, gray_debug.shape)
# Deeper diagnostic: locate where real tick rows stop satisfying the
# borderless baseline/lattice invariants.
family_debug = []
angle_bin = np.deg2rad(8.0)
families = {}
for line in short_debug:
    if line.length > 180.0:
        continue
    angle = np.arctan2(float(line.direction[1]), float(line.direction[0]))
    if angle < 0:
        angle += np.pi
    key = int(round(angle / angle_bin))
    families.setdefault(key, []).append(line)
for key, family in families.items():
    if len(family) < 7:
        continue
    directions = np.stack([line.direction for line in family]).astype(np.float64)
    reference = directions[0]
    aligned = directions.copy()
    for ii in range(len(aligned)):
        if float(np.dot(aligned[ii], reference)) < 0:
            aligned[ii] = -aligned[ii]
    tick_direction = scale_units._unit(np.mean(aligned, axis=0))
    if tick_direction is None:
        continue
    axis_debug = scale_units._unit(np.array([tick_direction[1], -tick_direction[0]], dtype=np.float64))
    endpoint_records = []
    for li, line in enumerate(family):
        endpoint_records.append((float(np.dot(line.a, tick_direction)), li, 0))
        endpoint_records.append((float(np.dot(line.b, tick_direction)), li, 1))
    endpoint_records.sort(key=lambda item: item[0])
    groups = []
    for record in endpoint_records:
        if not groups or record[0] - groups[-1][-1][0] > 6.0:
            groups.append([record])
        else:
            groups[-1].append(record)
    for group in groups:
        unique = {r[1] for r in group}
        if len(unique) < 7:
            continue
        baseline = float(np.median([r[0] for r in group]))
        items = []
        for li in unique:
            line = family[li]
            vals = np.array([np.dot(line.a, tick_direction), np.dot(line.b, tick_direction)])
            endpoint_index = int(np.argmin(np.abs(vals - baseline)))
            if abs(float(vals[endpoint_index]) - baseline) > 6.0:
                continue
            anchor = line.a if endpoint_index == 0 else line.b
            items.append((float(np.dot(anchor, axis_debug)), line.length, anchor))
        pos, lens, pts = scale_units._cluster_ticks(items, 4.0)
        if len(pos) < 7:
            continue
        pitch_dbg = scale_units._estimate_minor_pitch(pos)
        pattern_dbg = scale_units._infer_tick_pattern(pos, lens, pts)
        family_debug.append({
            "angle_bin": key,
            "family": len(family),
            "baseline_group": len(unique),
            "ticks": len(pos),
            "span": round(float(np.ptp(pos)), 2),
            "pitch": None if pitch_dbg is None else round(float(pitch_dbg), 3),
            "pattern": None if pattern_dbg is None else {
                "system": pattern_dbg.system,
                "confidence": round(pattern_dbg.confidence, 3),
                "minor": round(pattern_dbg.minor_tick_px, 3),
                "ppi": None if pattern_dbg.px_per_inch is None else round(pattern_dbg.px_per_inch, 2),
            },
        })
print("BASELINE_DEBUG", json.dumps(family_debug[:30], ensure_ascii=False))

print("SCALE_DEBUG", json.dumps({
    "short_lines": len(short_debug),
    "long_lines": len(long_debug),
    "borderless": [
        {
            "score": round(score, 3),
            "system": pattern.system,
            "confidence": round(pattern.confidence, 3),
            "minor_tick_px": round(pattern.minor_tick_px, 3),
            "px_per_inch": None if pattern.px_per_inch is None else round(pattern.px_per_inch, 3),
            "repeat_period": pattern.repeat_period,
            "points": len(pattern.points_xy),
        }
        for score, pattern, _axis in borderless_debug
    ],
}, ensure_ascii=False))

obs = infer_ruler(rgb)
scale = resolve_scale_reference(rgb, obs)
sha = hashlib.sha256(raw).hexdigest()
record = {
    "case":"D",
    "source":SOURCE,
    "image_url":image_url,
    "ground_truth":GROUND_TRUTH,
    "sha256":sha,
    "image_shape":list(rgb.shape),
    "semantic_input":semantic,
    "rulernet":obs,
    "visual_scale":infer_visual_scale(rgb),
    "scale_reference":scale,
    "baseline_measurement":measure_rgb(rgb, sha, steps, semantic),
}

if scale.px_per_cm:
    geo = extract_object_geometry(
        rgb, scale.reference_points_px, scale.px_per_cm, scale.direction_xy,
        semantic_vision=semantic,
    )
    effective = scale.px_per_cm
    if scale.source in {"rulernet_cm","rulernet_cm+imperial_ticks"} and geo.center_xy:
        effective = local_px_per_cm(scale.reference_points_px, geo.center_xy) or effective
    result = execute_geometry_steps(
        rgb, scale.reference_points_px, effective, steps, semantic_vision=semantic
    )
    record["geometry"] = geo
    record["effective_px_per_cm"] = effective
    record["executor"] = result

    overlay = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    contour = _select_object_contour(
        rgb, scale.reference_points_px, effective, semantic_vision=semantic
    )
    if contour is not None:
        record["selected_contour_bbox_xywh"] = cv2.boundingRect(contour)
        cv2.drawContours(overlay, [contour], -1, (0,200,0), 2)
    for p in scale.reference_points_px:
        cv2.circle(overlay, tuple(np.rint(p).astype(int)), 4, (0,0,255), -1)
    for step in result:
        for name,p in step.get("landmarks",{}).items():
            if p.get("x_px") is not None and p.get("y_px") is not None:
                xy=(int(round(p["x_px"])), int(round(p["y_px"])))
                cv2.circle(overlay,xy,5,(255,0,0),-1)
                cv2.putText(overlay,name,xy,cv2.FONT_HERSHEY_SIMPLEX,0.35,(255,0,0),1)
    cv2.imwrite(str(OUT / "D-overlay.png"), overlay)


(OUT / "D.json").write_text(json.dumps(record, ensure_ascii=False, indent=2, default=convert))
print("IMAGE_URL", image_url)
print(json.dumps({
    "ground_truth":GROUND_TRUTH,
    "image_shape":list(rgb.shape),
    "scale_reference":dataclasses.asdict(scale),
    "visual_scale":record["visual_scale"],
    "geometry":dataclasses.asdict(record["geometry"]) if "geometry" in record else None,
    "executor":record.get("executor"),
}, ensure_ascii=False, indent=2, default=convert))
