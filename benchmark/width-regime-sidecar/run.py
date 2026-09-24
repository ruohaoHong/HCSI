"""Read-only comparison of production HCSI and local width-regime evidence.

B/C/D photos are SHA pinned and reused. New E is a real BAUHAUS product photo
of a 3.5x25 mm pan-head screw ABOVE (not on) a metric ruler. F is an archived
Univair pan-head photo separately placed from an inch ruler. Catalog lengths
are NOT physical ground truth for the individual photographed screw.
No geometry, datum or scale is fitted to catalog labels.
"""
from __future__ import annotations
import hashlib, json, pathlib, sys, urllib.request
import cv2
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"measurement-service"))
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from app import measure_rgb
from rulernet import infer_ruler,local_px_per_cm
from scale_reference import resolve_scale_reference
from geometry import extract_object_geometry
from geometry_executor import _select_object_contour
from thread_geometry import detect_threaded_shank, estimate_head_underface, measure_outer_width_px
from local_width_aux import detect_local_shank_regime

IMAGES=ROOT/"acceptance-images"
OUT=ROOT/"acceptance-results"
IMAGES.mkdir(exist_ok=True)
OUT.mkdir(exist_ok=True)
cases=json.loads(pathlib.Path(__file__).with_name("cases.json").read_text())
cases.extend([
  {
    "case":"E",
    "source":"https://www.bauhaus.si/vijaki-za-les-in-iverne-plosce/profi-depot-pocinkani-vijak-za-iverne-plosce/p/20087205",
    "image_url":"https://media.cdn.bauhaus/m/1254795/12.jpg",
    "ground_truth":{"D_mm":3.5,"L_mm":25.0,"head_style":"pan","basis":"catalog_nominal_not_individually_measured"},
    "semantic_input":{
      "target_region":{"present":True,"confidence":.95,"x_min":75,"y_min":65,"x_max":975,"y_max":380},
      "reference_region":{"present":True,"confidence":.95,"x_min":50,"y_min":395,"x_max":1000,"y_max":1000},
      "head_style":"pan",
    },
    "steps":[
       {"operation":"outer_width","inputs":["threaded_shank"],"purpose":"D"},
       {"operation":"axial_distance","inputs":["object_tip","head_underface"],"purpose":"L"},
    ],
  },
  {
    "case":"F",
    "source":"https://www.univair.com/hardware/ms35207-279-pan-head-screw/",
    "image_url":"https://cdn11.bigcommerce.com/s-dtwuls/images/stencil/1280x1280/products/24868/6552/ms35207_279__58634.1404424552.jpg?c=2",
    "sha256":"62059f91ee00b24cb774581a027c934124d6b1a138bf307048994c4e988f7279",
    "ground_truth":{"D_mm":6.35,"P_mm":25.4/28,"L_mm":12.7,"head_style":"pan","basis":"catalog_nominal_not_individually_measured"},
    "semantic_input":{
      "target_region":{"present":True,"confidence":.95,"x_min":300,"y_min":300,"x_max":760,"y_max":690},
      "reference_region":{"present":True,"confidence":.95,"x_min":250,"y_min":650,"x_max":1000,"y_max":930},
      "head_style":"pan",
    },
    "steps":[
       {"operation":"outer_width","inputs":["threaded_shank"],"purpose":"D"},
       {"operation":"periodicity","inputs":["threaded_shank"],"purpose":"P"},
       {"operation":"axial_distance","inputs":["object_tip","head_underface"],"purpose":"L"},
    ],
    "controlled_ruler_px_per_cm":435.5/2.54,
  },
])

def obj(x):
    if isinstance(x,(np.floating,np.integer)):return x.item()
    if isinstance(x,np.ndarray):return x.tolist()
    raise TypeError(str(type(x)))

def summary(profile,px_per_cm):
    if profile is None:return None
    d=measure_outer_width_px(profile)
    under=estimate_head_underface(profile)
    return {
      "axis":profile.axis.tolist(),
      "shaft_outer_px":d,
      "tip_s":profile.tip_s,
      "transition_s":profile.transition_s,
      "tip_to_transition_px":abs(profile.transition_s-profile.tip_s),
      "tip_to_transition_mm":None if px_per_cm is None else abs(profile.transition_s-profile.tip_s)/px_per_cm*10,
      "underface_s":None if under is None else under.s,
      "tip_to_underface_mm":None if px_per_cm is None or under is None else abs(under.s-profile.tip_s)/px_per_cm*10,
    }

records=[]
for case in cases:
    name=case["case"]
    filename="MS35207-279-original.jpg" if name=="F" else name+"-original.jpg"
    path=IMAGES/filename
    if not path.exists():
        req=urllib.request.Request(case["image_url"],headers={"User-Agent":"Mozilla/5.0 HCSI research"})
        with urllib.request.urlopen(req,timeout=60) as response:
            path.write_bytes(response.read())
    data=path.read_bytes()
    sha=hashlib.sha256(data).hexdigest()
    if case.get("sha256") and sha!=case["sha256"]:
        raise AssertionError(f"{name}: archived photo bytes changed: {sha}")
    bgr=cv2.imdecode(np.frombuffer(data,np.uint8),cv2.IMREAD_COLOR)
    if bgr is None:raise RuntimeError(f"{name}: invalid image")
    rgb=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB)
    h,w=bgr.shape[:2]
    semantic=case["semantic_input"]
    steps=case["steps"]
    prod=measure_rgb(rgb,sha,steps,semantic)
    scale=resolve_scale_reference(rgb,infer_ruler(rgb))
    # F's separately checked ruler-only calibration is a research control,
    # not a silent production-scale override.
    ruler_only=case.get("controlled_ruler_px_per_cm")
    effective=scale.px_per_cm or ruler_only
    accepted_scale=scale.px_per_cm is not None
    ref=scale.reference_points_px if accepted_scale else np.empty((0,2),dtype=np.float32)
    contour=_select_object_contour(rgb,ref,effective or 100.0,semantic)
    original=None if contour is None else detect_threaded_shank(contour)
    auxiliary=None if contour is None else detect_local_shank_regime(contour)
    orig=summary(original,effective)
    aux=summary(auxiliary,effective)
    vec_delta=None
    if orig and aux:
       vec_delta=float(np.rad2deg(np.arccos(np.clip(abs(np.dot(original.axis,auxiliary.axis)),0,1))))
    baseline={s["purpose"]:s["value_mm"] for s in prod["geometry_steps"]}
    if name in ("B","C","D"):
       for dim in ("D","P"):
          if baseline.get(dim)!=case["baseline"].get(dim):
             raise AssertionError(f"{name}: production {dim} changed: {baseline} vs {case['baseline']}")
    report={
      "case":name,"photo_sha256":sha,"source":case["source"],
      "image_url":case["image_url"],"size_px":[w,h],
      "catalog_not_measured_gt":case["ground_truth"],"ruler_separated_from_screw":"visual_pre-screened",
      "formal_scale":{"system":scale.system,"source":scale.source,"px_per_cm":scale.px_per_cm,
                       "reason_codes":scale.reason_codes},
      "controlled_ruler_scale_used_only_for_diagnostic":None if accepted_scale else ruler_only,
      "production_geometry_steps":prod["geometry_steps"],
      "production_values_mm":baseline,
      "baseline_regression":case.get("baseline"),
      "original_shank":orig,"local_width_auxiliary":aux,
      "axis_disagreement_deg":vec_delta,
      "auxiliary_observes_width_regime":bool(aux),
      "auxiliary_overrides_production":False,
    }
    overlay=bgr.copy()
    if contour is not None:
      cv2.drawContours(overlay,[contour],-1,(0,180,0),1)
      for profile,color in ((original,(255,0,0)),(auxiliary,(255,0,255))):
        if profile is None:continue
        center=profile.center
        tip=center+profile.axis*profile.tip_s
        transition=center+profile.axis*profile.transition_s
        cv2.line(overlay,tuple(np.rint(tip).astype(int)),tuple(np.rint(transition).astype(int)),color,2)
        cv2.circle(overlay,tuple(np.rint(transition).astype(int)),4,color,-1)
    cv2.imwrite(str(OUT/(name+"-sidecar-overlay.png")),overlay)
    if name=="E":(OUT/"E-original.jpg").write_bytes(data)
    (OUT/(name+"-sidecar.json")).write_text(json.dumps(report,indent=2,default=obj))
    records.append(report)
    print(json.dumps({"case":name,"image_sha256":sha,"production":baseline,
                      "formal_scale":scale.system,
                      "original":orig,"auxiliary":aux,"axis_delta_deg":vec_delta,
                      "sidecar_only":True},default=obj))
(OUT/"width-regime-comparison.json").write_text(json.dumps(records,indent=2,default=obj))
