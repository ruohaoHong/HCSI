import base64
import hashlib
import json
import os
import pathlib
import sys
import tempfile
import time
import urllib.error
import urllib.request

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent
DATASET = ROOT / "dataset.json"
RESULTS = ROOT / "results.json"
API_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp", "GIF": "image/gif"}


def download_image(url: str, dest: pathlib.Path) -> dict:
    last_error = None
    for attempt in range(1, 4):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 HCSI-Benchmark/1.0",
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                original = resp.read()
            if not original:
                raise ValueError("empty response body")
            dest.write_bytes(original)
            with Image.open(dest) as img:
                img.verify()
            with Image.open(dest) as img:
                width, height = img.size
                original_format = (img.format or "").upper()
            if width < 200 or height < 200:
                raise ValueError(f"image too small: {width}x{height}")
            if content_type and not content_type.startswith("image/"):
                raise ValueError(f"non-image Content-Type: {content_type}")

            converted = False
            final_format = original_format
            final_mime = API_FORMATS.get(original_format)
            if final_mime is None:
                with Image.open(dest) as img:
                    if getattr(img, "n_frames", 1) > 1:
                        img.seek(0)
                    img.convert("RGB").save(dest, format="JPEG", quality=95, subsampling=0)
                converted = True
                final_format = "JPEG"
                final_mime = "image/jpeg"
            final_bytes = dest.read_bytes()
            return {
                "original_bytes": len(original),
                "original_sha256": hashlib.sha256(original).hexdigest(),
                "original_format": original_format,
                "content_type": content_type,
                "converted_for_api": converted,
                "api_bytes": len(final_bytes),
                "api_sha256": hashlib.sha256(final_bytes).hexdigest(),
                "width": width,
                "height": height,
                "format": final_format,
                "mime": final_mime,
            }
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt < 3:
                time.sleep(attempt * 2)
    raise RuntimeError(last_error or "download failed")


def openai_identify(image_path: pathlib.Path, mime: str) -> dict:
    api_key = os.environ["OPENAI_API_KEY"].strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is empty after trimming")
    data_url = f"data:{mime};base64,{base64.b64encode(image_path.read_bytes()).decode('ascii')}"
    prompt = """Identify the hardware/component in this real photograph as accurately and specifically as you can from the image alone.
Do not use any external product information or ground truth.
Return JSON only with this structure:
{
  "answer": {
    "category": "fasteners|plumbing|electrical|building-hardware|general-repair|unknown",
    "item_name": "your identification",
    "specifications": {"any_relevant_field": "your best answer or unknown"},
    "confidence": 0.0
  },
  "diagnostic": {
    "key_visual_evidence": ["short observable evidence used for the decision"],
    "spec_reasoning": {"field_name": "short explanation of what visual cue supports that field"},
    "uncertain_points": ["important uncertainty or ambiguity"]
  }
}
The diagnostic is a concise, user-visible explanation of evidence and uncertainty, not hidden chain-of-thought. Do not invent evidence that is not visible."""
    payload = {
        "model": "gpt-5.6-sol",
        "input": [{"role": "user", "content": [
            {"type": "input_text", "text": prompt},
            {"type": "input_image", "image_url": data_url, "detail": "high"},
        ]}],
        "max_output_tokens": 1800,
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            status, raw = resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        status, raw = exc.code, exc.read().decode("utf-8", errors="replace")
    data = json.loads(raw)
    if not 200 <= status < 300:
        err = data.get("error", {})
        raise RuntimeError(f"OpenAI HTTP {status}: {err.get('code')} {err.get('message')}")
    text = "".join(
        c.get("text", "")
        for item in data.get("output", [])
        for c in item.get("content", [])
        if c.get("type") == "output_text"
    ).strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return json.loads(text.strip())


def norm(value) -> str:
    return " ".join(str(value or "").lower().replace("-", " ").replace("_", " ").replace("×", "x").split())


def compare(case: dict, response: dict) -> dict:
    gt = case["ground_truth"]
    answer = response.get("answer", {})
    category_match = norm(gt["category"]) == norm(answer.get("category"))
    gt_name = set(norm(gt["item_name"]).split())
    ai_name = set(norm(answer.get("item_name")).split())
    item_name_match = bool(gt_name and ai_name and len(gt_name & ai_name) / min(len(gt_name), len(ai_name)) >= 0.5)
    spec_results = {}
    ai_specs = answer.get("specifications", {}) or {}
    for field, expected in gt.get("specifications", {}).items():
        actual = ai_specs.get(field, "<not provided>")
        spec_results[field] = {"ground_truth": expected, "ai_answer": actual}
    return {
        "category_match": category_match,
        "item_name_match": item_name_match,
        "specifications": spec_results,
        "note": "Specification values are preserved side-by-side for review; no semantic judge is used in this pilot."
    }


def main() -> int:
    dataset = json.loads(DATASET.read_text(encoding="utf-8"))
    policy = dataset.get("policy", {})
    if policy.get("generated_images_allowed") is not False:
        raise SystemExit("Dataset must explicitly forbid generated images")
    if policy.get("ground_truth_required") is not True:
        raise SystemExit("Dataset must explicitly require ground truth")
    for case in dataset.get("cases", []):
        if not case.get("ground_truth"):
            raise SystemExit(f"{case.get('id')} has no ground truth")

    results = {"dataset_version": dataset["version"], "model": "gpt-5.6-sol", "generated_images_used": False, "cases": []}
    failures = 0
    with tempfile.TemporaryDirectory(prefix="hcsi-pilot-") as tmp:
        tmpdir = pathlib.Path(tmp)
        for case in dataset["cases"]:
            row = {
                "id": case["id"],
                "image": {"url": case["image_url"], "source_page": case["source_page"]},
                "ground_truth": case["ground_truth"],
            }
            print(f"\n=== {case['id']} ===")
            path = tmpdir / f"{case['id']}.img"
            try:
                validation = download_image(case["image_url"], path)
                row["image"]["validation"] = {"status": "ok", **validation}
                print(f"image ok: {validation['original_format']} {validation['width']}x{validation['height']} sha256={validation['original_sha256'][:12]}...")
            except Exception as exc:
                row["image"]["validation"] = {"status": "download_failed", "error": str(exc)}
                row["api_status"] = "skipped"
                results["cases"].append(row)
                failures += 1
                print(f"download_failed: {exc}")
                continue
            try:
                response = openai_identify(path, validation["mime"])
                row["api_status"] = "ok"
                row["ai_response"] = response
                row["result"] = compare(case, response)
                print("ground_truth:", json.dumps(case["ground_truth"], ensure_ascii=False))
                print("ai_response:", json.dumps(response, ensure_ascii=False))
                print("result:", json.dumps(row["result"], ensure_ascii=False))
            except Exception as exc:
                row["api_status"] = "failed"
                row["api_error"] = str(exc)
                failures += 1
                print(f"api_failed: {exc}")
            results["cases"].append(row)

    RESULTS.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {RESULTS}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
