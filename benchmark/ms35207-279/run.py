"""Real-photo protruding-head discriminator: MS35207-279.

No VLM/API call and no nominal-length fitting; catalog data is reporting-only. The catalog nominal is reported
only after image geometry is measured.
"""
from __future__ import annotations
import dataclasses, hashlib, json, pathlib, sys, urllib.request
import cv2
import numpy as np

ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"measurement-service"))

from app import measure_rgb
from geometry import extract_object_geometry
from geometry_executor import _select_object_contour
from rulernet import infer_ruler, local_px_per_cm
from scale_reference import resolve_scale_reference
from thread_geometry import detect_threaded_shank, decompose_head_body

OUT=ROOT/"acceptance-results"
OUT.mkdir(parents=True,exist_ok=True)

SOURCE="https://www.univair.com/hardware/ms35207-279-pan-head-screw/"
IMAGE_URL="https://cdn11.bigcommerce.com/s-dtwuls/images/stencil/1280x1280/products/24868/6552/ms35207_279__58634.1404424552.jpg?c=2"
CATALOG={
    "part":"MS35207-279",
    "head_style":"pan",
    "thread":"1/4-28",
    "nominal_length_in":0.5,
    "nominal_length_mm":12.7,
    "nominal_diameter_in":0.25,
}
semantic={
    "target_region":{
        "present":True,"confidence":0.95,
        "x_min":300,"y_min":300,"x_max":760,"y_max":690,
    },
    "reference_region":{
        "present":True,"confidence":0.95,
        "x_min":250,"y_min":650,"x_max":1000,"y_max":930,
    },
    "head_style":"pan",
}
steps=[
    {"operation":"outer_width","inputs":["threaded_shank"],"purpose":"D"},
    {"operation":"periodicity","inputs":["threaded_shank"],"purpose":"P"},
    {"operation":"axial_distance","inputs":["object_tip","head_underface"],"purpose":"L"},
]

req=urllib.request.Request(IMAGE_URL,headers={"User-Agent":"Mozilla/5.0 HCSI validation"})
raw=urllib.request.urlopen(req,timeout=60).read()
img=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR)
if img is None:
    raise RuntimeError("image decode failed")
rgb=cv2.cvtColor(img,cv2.COLOR_BGR2RGB)
(OUT/"MS35207-279-original.jpg").write_bytes(raw)
sha=hashlib.sha256(raw).hexdigest()

obs=infer_ruler(rgb)
scale=resolve_scale_reference(rgb,obs)
result=measure_rgb(rgb,sha,steps,semantic)
record={
    "source":SOURCE,
    "image_url":IMAGE_URL,
    "sha256":sha,
    "catalog":CATALOG,
    "semantic_input":semantic,
    "visual_scale":obs,
    "scale_reference":scale,
    "measurement":result,
}

# This photo contains a complete bottom inch ruler even though the production
# scale resolver does not currently accept it. For this head/body-only
# experiment, derive scale strictly from that ruler: detect the 17 consecutive
# ticks spanning 0..1 inch (16 minor intervals). Screw dimensions never enter.
gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
h,w=gray.shape
y0,y1=int(round(h*0.69)),int(round(h*0.80))
counts=np.count_nonzero(gray[y0:y1,:] < 100,axis=0)
xs=np.flatnonzero(counts > 8)
groups=[]
if len(xs):
    a=b=int(xs[0])
    for x in xs[1:]:
        x=int(x)
        if x>b+1:
            groups.append((a,b))
            a=x
        b=x
    groups.append((a,b))
centers=np.asarray([(a+b)/2 for a,b in groups if a>=w*0.25],dtype=np.float64)
best_ticks=None
for start in range(max(0,len(centers)-16)):
    trial=centers[start:start+17]
    if len(trial)!=17:
        continue
    gaps=np.diff(trial)
    if np.median(gaps) < 15 or np.median(gaps) > 40:
        continue
    if np.max(np.abs(gaps-np.median(gaps))) > 7:
        continue
    best_ticks=trial
    break
if best_ticks is None:
    raise RuntimeError(f"controlled bottom-ruler ticks unresolved: {centers.tolist()}")
px_per_inch=float(best_ticks[-1]-best_ticks[0])
controlled_px_per_cm=px_per_inch/2.54
controlled_points=np.column_stack((best_ticks,np.full_like(best_ticks,float((y0+y1)/2))))
record["controlled_ruler_scale"]={
    "method":"17 consecutive bottom ticks = 16 x 1/16 inch intervals",
    "tick_centers_x":best_ticks,
    "px_per_inch":px_per_inch,
    "px_per_cm":controlled_px_per_cm,
}

ref_points=scale.reference_points_px if scale.px_per_cm else controlled_points
effective=scale.px_per_cm if scale.px_per_cm else controlled_px_per_cm
direction=scale.direction_xy if scale.px_per_cm else (1.0,0.0)
geo=extract_object_geometry(
    rgb,ref_points,effective,direction,semantic_vision=semantic,
)
contour=_select_object_contour(rgb,ref_points,effective,semantic)
record["controlled_geometry"]=geo
record["controlled_effective_px_per_cm"]=effective
if contour is not None:
    profile=detect_threaded_shank(contour)
    if profile is not None:
        structure=decompose_head_body(profile)
        record["head_body_structure"]=structure
        if structure.transition_start_s is not None:
            old_px=abs(profile.tip_s-structure.transition_start_s)
            record["first_expansion_length"]={
                "value_px":old_px,
                "value_mm":old_px/effective*10.0,
            }
        if structure.bearing_plane is not None:
            new_px=abs(profile.tip_s-structure.bearing_plane.s)
            record["bearing_plane_length"]={
                "value_px":new_px,
                "value_mm":new_px/effective*10.0,
            }

def conv(x):
    if dataclasses.is_dataclass(x): return dataclasses.asdict(x)
    if isinstance(x,np.ndarray): return x.tolist()
    if isinstance(x,np.generic): return x.item()
    raise TypeError(type(x).__name__)

(OUT/"MS35207-279.json").write_text(json.dumps(record,ensure_ascii=False,indent=2,default=conv))
print(json.dumps({
    "catalog":CATALOG,
    "scale_reference":record["scale_reference"],
    "controlled_ruler_scale":record.get("controlled_ruler_scale"),
    "controlled_geometry":record.get("controlled_geometry"),
    "measurement_steps":result.get("geometry_steps"),
    "head_body_structure":record.get("head_body_structure"),
    "first_expansion_length":record.get("first_expansion_length"),
    "bearing_plane_length":record.get("bearing_plane_length"),
},ensure_ascii=False,indent=2,default=conv))
