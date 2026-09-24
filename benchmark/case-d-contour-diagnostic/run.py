"""Diagnose why real-photo Case D triggers object_contour_unstable."""
import dataclasses, json, pathlib, sys, urllib.request
import cv2
import numpy as np

ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"measurement-service"))

from rulernet import infer_ruler
from scale_reference import resolve_scale_reference
from semantic_regions import build_semantic_masks, apply_semantic_constraints
from geometry import (
    _background_distance, _edge_mask, _ruler_exclusion_mask,
    _candidate_from_mask, _geometry_from_contour, _contour_similarity,
    _contour_stability_summary, extract_object_geometry, MIN_CONTOUR_EDGE_SUPPORT,
)

OUT=ROOT/"acceptance-results"
OUT.mkdir(parents=True,exist_ok=True)
URL="https://cdn11.bigcommerce.com/s-dtwuls/images/stencil/1280x1280/products/25069/10465/nas220-6__83774.1494512951.jpg?c=2"

semantic={
    "target_region":{"present":True,"confidence":0.95,"x_min":285,"y_min":390,"x_max":735,"y_max":650},
    "reference_region":{"present":True,"confidence":0.95,"x_min":210,"y_min":615,"x_max":1000,"y_max":815},
    "head_style":"pan",
}

req=urllib.request.Request(URL,headers={"User-Agent":"Mozilla/5.0 HCSI diagnostic"})
raw=urllib.request.urlopen(req,timeout=60).read()
img=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR)
rgb=cv2.cvtColor(img,cv2.COLOR_BGR2RGB)

ruler=infer_ruler(rgb)
scale=resolve_scale_reference(rgb,ruler)
if not scale.px_per_cm:
    raise RuntimeError(f"scale unavailable: {scale}")

height,width=rgb.shape[:2]
semantic_masks=build_semantic_masks(rgb.shape,semantic)
distance,base_threshold=_background_distance(rgb)
edge_mask=_edge_mask(rgb)
exclusion,_=_ruler_exclusion_mask(rgb,scale.reference_points_px,scale.px_per_cm,semantic_masks)
close_kernel=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7))
open_kernel=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(3,3))

selected=[]
records=[]
for factor in (0.82,1.0,1.22):
    mask=(distance > base_threshold*factor).astype(np.uint8)*255
    mask[exclusion>0]=0
    mask=apply_semantic_constraints(mask,semantic_masks)
    mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,close_kernel,iterations=2)
    mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,open_kernel,iterations=1)
    mask=apply_semantic_constraints(mask,semantic_masks)
    mask[:2,:]=0; mask[-2:,:]=0; mask[:,:2]=0; mask[:,-2:]=0
    cand=_candidate_from_mask(mask,edge_mask,width,height)
    selected.append(cand)
    cv2.imwrite(str(OUT/f"mask-{factor:.2f}.png"),mask)
    if cand is None:
        records.append({"factor":factor,"candidate":None})
        continue
    center,axis,L,W,minL,minW=_geometry_from_contour(cand.contour)
    records.append({
        "factor":factor,
        "score":cand.score,
        "area_ratio":cand.area_ratio,
        "solidity":cand.solidity,
        "border":cand.border,
        "edge_support":cand.edge_support,
        "bbox_xywh":list(cv2.boundingRect(cand.contour)),
        "center_xy":center.tolist(),
        "principal_length":L,
        "principal_width":W,
        "min_area_length":minL,
        "min_area_width":minW,
    })

nominal=selected[1] or selected[0] or selected[2]
if nominal is None:
    raise RuntimeError("no nominal candidate")

for rec,cand in zip(records,selected):
    if cand is None:
        continue
    rec["is_nominal"]=cand is nominal
    rec["edge_support_gate"]=cand.edge_support>=MIN_CONTOUR_EDGE_SUPPORT
    if cand is not nominal:
        shift,ld,wd=_contour_similarity(nominal,cand)
        rec["similarity_vs_nominal"]={
            "center_shift":shift,"length_delta":ld,"width_delta":wd,
            "fails_center":shift>0.12,
            "fails_length":ld>0.16,
            "fails_width":wd>0.24,
        }

unstable,observations=_contour_stability_summary(nominal,selected)
result=extract_object_geometry(
    rgb,scale.reference_points_px,scale.px_per_cm,scale.direction_xy,semantic_vision=semantic
)

overlay=img.copy()
colors=[(255,0,0),(0,255,0),(0,0,255)]
for cand,color in zip(selected,colors):
    if cand is not None:
        cv2.drawContours(overlay,[cand.contour],-1,color,2)
cv2.imwrite(str(OUT/"candidate-overlay.png"),overlay)

out={
  "scale":dataclasses.asdict(scale),
  "base_threshold":base_threshold,
  "threshold_candidates":records,
  "stability":{"unstable":unstable,"observations":observations,"min_edge_support":MIN_CONTOUR_EDGE_SUPPORT},
  "geometry":dataclasses.asdict(result),
}
(OUT/"case-d-contour-diagnostic.json").write_text(json.dumps(out,indent=2))
print(json.dumps(out,indent=2))
