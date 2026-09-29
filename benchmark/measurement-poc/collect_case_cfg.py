#!/usr/bin/env python3
"""Collect exact supplier photos for HCSI C/F/G without calling an LLM.

Photographs are retained as GitHub Actions artifacts, NOT committed to the
public repository. This script never reads or supplies GT to inference.
"""
import hashlib, json, os, pathlib, sys, time, urllib.error, urllib.request
from io import BytesIO
from PIL import Image, ImageOps, ImageStat

OUT=pathlib.Path("case-cfg-fixtures")
OUT.mkdir(exist_ok=True)
UA={"User-Agent":"Mozilla/5.0 (compatible; HCSI-fixture-verifier/1.0)",
    "Accept":"image/avif,image/webp,image/apng,image/*,*/*;q=0.8"}
CANDIDATES={
    "C": {
      "urls":[
        "https://cdn11.bigcommerce.com/s-1ygf19te2/images/stencil/1280x1280/products/20567/90373/r16b008-6__94664.1667485912.jpg?c=2%3Fimbypass%3Don",
        "https://cdn11.bigcommerce.com/s-1ygf19te2/images/stencil/1280x1280/products/20567/90373/r16b008-6__94664.1667485912.jpg"
      ],
      "expected_product":"DougDeals R16B008 / Nucor 4216546",
      "expected_sha_not":"3c52044724df828c971fee66c6b8f8dd4a684407d4b3c6b2ed2a75114a2fafa4"
    },
    "F": {
      "urls":[
        "https://cdn1.polaris.com/globalassets/pga/shop/7519/7519774_alt4.jpg?format=webp&v=c22cbf85%3Fheight%3D680",
        "https://cdn1.polaris.com/globalassets/pga/shop/7519/7519774_alt4.jpg?format=webp&height=680",
        "https://cdn1.polaris.com/globalassets/pga/shop/7519/7519774_alt4.jpg"
      ],
      "expected_product":"Polaris 7519774 button-head screw"
    },
    "G": {
      "urls":[
        "https://cdn11.bigcommerce.com/s-dtwuls/images/stencil/1280x1280/products/24209/13679/an526c1032r8__07759.1584998607.jpg?c=2",
        "https://cdn11.bigcommerce.com/s-dtwuls/images/stencil/1280x1280/products/24209/13679/an526c1032r8__07759.1584998607.jpg"
      ],
      "expected_product":"Univair AN526C1032R8 truss-head screw"
    }
}
VALID_FORMATS={"JPEG":".jpg","WEBP":".webp","PNG":".png"}
def get_photo(c):
    errors=[]
    for url in c["urls"]:
        try:
            req=urllib.request.Request(url,headers=UA)
            with urllib.request.urlopen(req,timeout=25) as resp:
                raw=resp.read(16_000_001)
                content_type=resp.headers.get("Content-Type","")
                resolved=resp.url
            if len(raw)>16_000_000:
                raise ValueError("image exceeds 16MB")
            im=Image.open(BytesIO(raw))
            im.verify()
            im=Image.open(BytesIO(raw))
            if im.format not in VALID_FORMATS:
                raise ValueError(f"unsupported image format: {im.format}")
            if min(im.size)<250:
                raise ValueError(f"image too small: {im.size}")
            return raw,im,{"request_url":url,"resolved_url":resolved,"content_type":content_type}
        except Exception as e:
            errors.append({"url":url,"error":str(e)[:300]})
    raise RuntimeError("No exact approved-image URL could be verified: "+json.dumps(errors))
def thumbnail_signature(im):
    gray=ImageOps.grayscale(im).resize((32,32))
    vals=list(gray.getdata())
    avg=sum(vals)/len(vals)
    return "".join("1" if p>=avg else "0" for p in vals)
def old_case_c_signature():
    directory=pathlib.Path("/tmp/hcsi-old-c")
    if not directory.exists(): return None
    expected="3c52044724df828c971fee66c6b8f8dd4a684407d4b3c6b2ed2a75114a2fafa4"
    found=[p for p in directory.rglob("*") if p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==expected]
    if len(found)!=1: return None
    image=Image.open(found[0])
    return thumbnail_signature(image)
all_meta={"collection_type":"HCSI exact image URL verification only; not an API inference",
          "image_ground_truth_is_not_supplied_to_inference":True,
          "cases":{}}
old_sig=old_case_c_signature()
for name,c in CANDIDATES.items():
    try:
        raw,im,source=get_photo(c)
        sha=hashlib.sha256(raw).hexdigest()
        if sha==c.get("expected_sha_not"):
            raise RuntimeError("New Case C URL serves the exact historical C bytes")
        suffix=VALID_FORMATS[im.format]
        dest=OUT/("case-"+name.lower()+suffix)
        dest.write_bytes(raw)
        sig=thumbnail_signature(im)
        meta={
          "status":"downloaded_and_bytes_verified",
          "image_file":dest.name,
          "image_sha256":sha,
          "image_width":im.width,"image_height":im.height,
          "image_format":im.format,
          "image_bytes":len(raw),
          "source":source,
          "expected_product":c["expected_product"],
          "photo_to_gt_pairing":"product URL and filename match supplier item; ruler composition still needs visual approval",
        }
        if name=="C":
            meta["distinct_bytes_from_old_case_c"]=True
            if old_sig:
                meta["old_c_mean_threshold_hash_hamming_distance"]=sum(a!=b for a,b in zip(sig,old_sig))
                meta["old_c_hash_bits"]=1024
                # Any low-distance image may be a resize/re-encode of the
                # same photo and must not be declared an independent case.
                meta["possible_same_composition_as_old_c"]=meta["old_c_mean_threshold_hash_hamming_distance"]<=110
        all_meta["cases"][name]=meta
        print(f"FIXTURE_{name}="+json.dumps(meta,ensure_ascii=False,sort_keys=True),flush=True)
    except Exception as e:
        err={"status":"failed","error":str(e)}
        all_meta["cases"][name]=err
        print(f"FIXTURE_{name}="+json.dumps(err,ensure_ascii=False),flush=True)
(OUT/"collection.json").write_text(json.dumps(all_meta,indent=2,ensure_ascii=False)+"\n")
print("COLLECTION_SUMMARY="+json.dumps(all_meta,ensure_ascii=False),flush=True)
if any(d.get("status")!="downloaded_and_bytes_verified" for d in all_meta["cases"].values()):
    sys.exit(1)
