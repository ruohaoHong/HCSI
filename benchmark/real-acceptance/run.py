"""Two real-photo baseline cases. Production modules are imported unchanged."""
import base64, dataclasses, hashlib, json, os, pathlib, sys, time, urllib.request
import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "measurement-service"))
from app import measure_rgb
from rulernet import infer_ruler, local_px_per_cm
from scale_reference import resolve_scale_reference
from geometry import extract_object_geometry
from geometry_executor import execute_geometry_steps, _select_object_contour
from scale_units import infer_visual_scale

OUT = pathlib.Path(os.environ.get("ACCEPTANCE_OUT", str(ROOT / "acceptance-results")))
OUT.mkdir(parents=True, exist_ok=True)
CASES = [
 {"id":"A", "url":"https://mossmotors.com/media/catalog/product/3/2/322-945_1.jpg",
 "source":"https://mossmotors.com/322-945-screw-10-32-x-7-8-pan-head",
 "ground_truth":{"D_mm":4.826,"P_mm":0.79375,"L_mm":22.225,"head_style":"pan"},
 "target":[120,240,450,450], "reference":[185,155,1000,750]},
 {"id":"B", "url":"https://cdn11.bigcommerce.com/s-1ygf19te2/images/stencil/1280x1280/products/20420/89736/r20b002-5__33578.1667485725.jpg?c=2?imbypass=on",
 "source":"https://www.dougdeals.com/box-of-1-000-m6-1-0-x-40mm-din-965-phillips-flat-head-machine-screws-zinc/",
 "ground_truth":{"D_mm":6.0,"P_mm":1.0,"L_mm":40.0,"head_style":"flat_countersunk"},
 "target":[50,245,970,515], "reference":[50,535,1000,850]},
]
def convert(x):
 if dataclasses.is_dataclass(x): return dataclasses.asdict(x)
 if isinstance(x,np.ndarray): return x.tolist()
 if isinstance(x,np.generic): return x.item()
 raise TypeError(type(x).__name__)
def save(name, obj):
 (OUT/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2,default=convert))
def region(a):
 return dict(present=True,confidence=0.95,**dict(zip(["x_min","y_min","x_max","y_max"],a)))
def analyze(c, rgb, sem, steps, label):
 obs=infer_ruler(rgb); scale=resolve_scale_reference(rgb,obs)
 record={"semantic_input":sem,"steps_input":steps,"rulernet":obs,"visual_scale":infer_visual_scale(rgb),"scale_reference":scale}
 record["baseline_measurement"]=measure_rgb(rgb, c["sha256"], steps, sem)
 if scale.px_per_cm:
  geo=extract_object_geometry(rgb,scale.reference_points_px,scale.px_per_cm,scale.direction_xy,semantic_vision=sem)
  effective=scale.px_per_cm
  if scale.source in {"rulernet_cm","rulernet_cm+imperial_ticks"} and geo.center_xy:
   effective=local_px_per_cm(scale.reference_points_px,geo.center_xy) or effective
  record["geometry"]=geo
  record["conditional_executor_not_acceptance"]=execute_geometry_steps(rgb,scale.reference_points_px,effective,steps,semantic_vision=sem)
  contour=_select_object_contour(rgb,scale.reference_points_px,effective,semantic_vision=sem)
  overlay=cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR)
  if contour is not None:
   record["selected_contour_bbox_xywh"]=cv2.boundingRect(contour)
   record["selected_contour_points"]=contour
   cv2.drawContours(overlay,[contour],-1,(0,200,0),2)
  for p in scale.reference_points_px:
   cv2.circle(overlay,tuple(np.rint(p).astype(int)),4,(0,0,255),-1)
  for step in record["conditional_executor_not_acceptance"]:
   for name,p in step.get("landmarks",{}).items():
    if p.get("x_px") is not None and p.get("y_px") is not None:
     xy=(int(p["x_px"]),int(p["y_px"]))
     cv2.circle(overlay,xy,5,(255,0,0),-1)
     cv2.putText(overlay,name,xy,cv2.FONT_HERSHEY_SIMPLEX,0.35,(255,0,0),1)
  cv2.imwrite(str(OUT/f'{c["id"]}-{label}-overlay.png'),overlay)
 save(f'{c["id"]}-{label}.json',record)
 print(c["id"],label,json.dumps(record["baseline_measurement"],ensure_ascii=False),flush=True)

for c in CASES:
 local=os.environ.get("ACCEPTANCE_INPUT_DIR")
 if local: raw=(pathlib.Path(local)/f'case-{c["id"].lower()}.jpg').read_bytes()
 else: raw=urllib.request.urlopen(c["url"],timeout=60).read()
 c["sha256"]=hashlib.sha256(raw).hexdigest()
 (OUT/f'{c["id"]}-original.jpg').write_bytes(raw)
 rgb=cv2.cvtColor(cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR),cv2.COLOR_BGR2RGB)
 c["width_px"]=rgb.shape[1]; c["height_px"]=rgb.shape[0]
 if os.environ.get("ACCEPTANCE_RUN_API")=="1":
  req=urllib.request.Request("http://127.0.0.1:3000/api/analyze-openai",data=json.dumps({"image":base64.b64encode(raw).decode()}).encode(),headers={"Content-Type":"application/json"})
  try:
   with urllib.request.urlopen(req,timeout=300) as r: api={"http_status":r.status,"body":json.load(r)}
  except urllib.error.HTTPError as e:
   api={"http_status":e.code,"body":e.read().decode()[:5000]}
  except Exception as e:
   api={"error_type":type(e).__name__,"error":str(e)}
  save(f'{c["id"]}-api.json',api)
  print(c["id"],"API",json.dumps(api,ensure_ascii=False),flush=True)
  body=api.get("body")
  if isinstance(body,dict) and body.get("routing") and body.get("resolved_measurement_plan"):
   analyze(c,rgb,body["routing"]["semantic_vision"],body["resolved_measurement_plan"]["executable_steps"],"vlm")
 # Explicitly controlled semantic input; this is NOT a VLM or end-to-end test.
 sem={"target_region":region(c["target"]),"reference_region":region(c["reference"]),"head_style":c["ground_truth"]["head_style"]}
 anchor="head_top" if sem["head_style"]=="flat_countersunk" else "head_underface"
 steps=[{"operation":"outer_width","inputs":["threaded_shank"],"purpose":"D"},
 {"operation":"periodicity","inputs":["threaded_shank"],"purpose":"P"},
 {"operation":"axial_distance","inputs":["object_tip",anchor],"purpose":"L"}]
 try: analyze(c,rgb,sem,steps,"controlled")
 except Exception as e:
  save(f'{c["id"]}-controlled-error.json',{"error_type":type(e).__name__,"error":str(e)})
  print(c["id"],"measurement_error",type(e).__name__,str(e),flush=True)
save("cases.json",CASES)
