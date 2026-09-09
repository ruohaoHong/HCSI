import base64
import hashlib
import html
import json
import os
import pathlib
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent
DATASET = ROOT / "dataset.json"
RESULTS = ROOT / "results.json"
API_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp", "GIF": "image/gif"}
USER_AGENT = "Mozilla/5.0 HCSI-Taiwan-Common-10/1.0"


def request_bytes(url: str, accept: str, timeout: int = 30) -> tuple[bytes, str]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        return resp.read(), content_type


def resolve_image_url(case: dict) -> str:
    if case.get("image_url"):
        return case["image_url"]

    source_page = case["source_page"]
    raw, content_type = request_bytes(source_page, "text/html,application/xhtml+xml,*/*;q=0.8")
    if content_type and "html" not in content_type:
        raise ValueError(f"source page returned non-HTML Content-Type: {content_type}")
    text = raw.decode("utf-8", errors="replace")
    text = html.unescape(text).replace("\\/", "/")

    candidates = []
    patterns = [
        r'''(?:src|data-src|data-original|href|content)\s*=\s*["']([^"']+)["']''',
        r'''https?://[^"'<>\s]+''',
    ]
    for pattern in patterns:
        for value in re.findall(pattern, text, flags=re.IGNORECASE):
            value = value.strip()
            if not value:
                continue
            absolute = urllib.parse.urljoin(source_page, value)
            path = urllib.parse.urlparse(absolute).path.lower()
            if any(ext in path for ext in (".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif")):
                if absolute not in candidates:
                    candidates.append(absolute)

    hint = str(case.get("image_hint") or "").lower()
    if hint:
        hinted = [url for url in candidates if hint in url.lower()]
        if hinted:
            return hinted[0]

    og_patterns = [
        r'''<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']''',
        r'''<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']''',
    ]
    for pattern in og_patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return urllib.parse.urljoin(source_page, html.unescape(match.group(1)))

    if candidates:
        return candidates[0]
    raise ValueError("could not resolve a product image from source page")


def download_image(url: str, dest: pathlib.Path) -> dict:
    last_error = None
    for attempt in range(1, 4):
        try:
            original, content_type = request_bytes(
                url,
                "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                timeout=30,
            )
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
    prompt = """你正在協助台灣使用者辨識照片中的常見五金、水電、電料、建築五金或維修零件，目的是讓使用者能拿你的答案去台灣五金行／水電材料行／電料行購買可用的替代品。

只根據這張真實照片判斷。不要使用外部商品頁、品牌資料或 Ground Truth。不要因為需要完整答案而猜測照片無法支持的尺寸、牙規、材質或型號；無法可靠判斷時請明確寫 unknown，並指出購買前還需要量測或確認什麼。

名稱優先使用台灣常見的繁體中文購買用語；如果你知道其他常見台灣稱呼可以一起列出。品牌或型號不是必要答案。

只輸出 JSON，格式如下：
{
  "answer": {
    "category": "fasteners|plumbing|electrical|building-hardware|general-repair|unknown",
    "item_name_zh_tw": "最適合拿去台灣店家詢問的名稱",
    "common_names_zh_tw": ["其他常見稱呼"],
    "technical_name_en": "technical English name",
    "specifications": {"relevant_field": "visible/inferable value or unknown"},
    "purchase_phrase_zh_tw": "使用者可以直接對店員說的一句話；無法確定的必要規格不要亂補",
    "missing_purchase_info": ["若要確保買對，照片還不足以確認的資訊"],
    "confidence": 0.0
  },
  "diagnostic": {
    "key_visual_evidence": ["簡短、可觀察到的視覺依據"],
    "spec_reasoning": {"field_name": "該規格由什麼可見線索支持，或為何無法判斷"},
    "uncertain_points": ["重要的不確定處或容易混淆的候選"]
  }
}

Diagnostic 只提供簡潔、可見的判斷依據與不確定性，不要輸出隱藏 chain-of-thought，也不要捏造照片中不存在的證據。"""
    payload = {
        "model": "gpt-5.6-sol",
        "input": [{
            "role": "user",
            "content": [
                {"type": "input_text", "text": prompt},
                {"type": "input_image", "image_url": data_url, "detail": "high"},
            ],
        }],
        "max_output_tokens": 2000,
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
    answer = response.get("answer", {}) or {}
    return {
        "category_match_strict": norm(gt["category"]) == norm(answer.get("category")),
        "ground_truth_purchase_name": gt["taiwan_purchase_name"],
        "accepted_ground_truth_names": gt.get("accepted_names_zh_tw", []),
        "ai_purchase_name": answer.get("item_name_zh_tw"),
        "ground_truth_specifications": gt.get("specifications", {}),
        "ai_specifications": answer.get("specifications", {}),
        "ai_purchase_phrase": answer.get("purchase_phrase_zh_tw"),
        "ai_missing_purchase_info": answer.get("missing_purchase_info", []),
        "note": "No semantic pass/fail judge is used for item names or specs. Review Ground Truth vs AI Answer vs Diagnostic directly. Strict category match is informational only because some parts cross store/category boundaries."
    }


def main() -> int:
    dataset = json.loads(DATASET.read_text(encoding="utf-8"))
    policy = dataset.get("policy", {})
    if policy.get("generated_images_allowed") is not False:
        raise SystemExit("Dataset must explicitly forbid generated images")
    if policy.get("ground_truth_required") is not True:
        raise SystemExit("Dataset must explicitly require ground truth")
    if policy.get("ground_truth_established_before_inference") is not True:
        raise SystemExit("Ground truth must be established before inference")
    for case in dataset.get("cases", []):
        if not case.get("ground_truth"):
            raise SystemExit(f"{case.get('id')} has no ground truth")

    results = {
        "dataset_version": dataset["version"],
        "model": "gpt-5.6-sol",
        "generated_images_used": False,
        "benchmark_goal": "Taiwan purchase-oriented common-part identification",
        "cases": [],
    }

    with tempfile.TemporaryDirectory(prefix="hcsi-tw-common-10-") as tmp:
        tmpdir = pathlib.Path(tmp)
        prepared = {}
        preflight_failed = False

        # Global preflight: resolve and validate every real image before spending any API inference.
        for case in dataset["cases"]:
            row = {
                "id": case["id"],
                "category_group": case.get("category_group"),
                "source_page": case["source_page"],
                "source_type": case.get("source_type"),
                "ground_truth": case["ground_truth"],
            }
            print(f"\n=== PRE-FLIGHT {case['id']} ===")
            path = tmpdir / f"{case['id']}.img"
            try:
                resolved_url = resolve_image_url(case)
                validation = download_image(resolved_url, path)
                row["image"] = {
                    "resolved_url": resolved_url,
                    "validation": {"status": "ok", **validation},
                }
                prepared[case["id"]] = (case, path, validation, row)
                print(f"image ok: {validation['original_format']} {validation['width']}x{validation['height']} sha256={validation['original_sha256'][:12]}...")
                print(f"resolved image: {resolved_url}")
            except Exception as exc:
                row["image"] = {"validation": {"status": "preflight_failed", "error": str(exc)}}
                row["api_status"] = "skipped_global_preflight"
                results["cases"].append(row)
                preflight_failed = True
                print(f"preflight_failed: {exc}")

        if preflight_failed:
            for case_id, (_, _, _, row) in prepared.items():
                row["api_status"] = "skipped_global_preflight"
                results["cases"].append(row)
            results["preflight"] = "failed_no_api_calls_made"
            results["cases"] = sorted(results["cases"], key=lambda x: x["id"])
            RESULTS.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
            print("\nGlobal preflight failed. No OpenAI image inference calls were made.")
            print(f"Wrote {RESULTS}")
            return 1

        results["preflight"] = "passed_all_images"
        for case in dataset["cases"]:
            case, path, validation, row = prepared[case["id"]]
            print(f"\n=== INFERENCE {case['id']} ===")
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
                print(f"api_failed: {exc}")
            results["cases"].append(row)

    results["cases"] = sorted(results["cases"], key=lambda x: x["id"])
    RESULTS.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    failures = [row for row in results["cases"] if row.get("api_status") != "ok"]
    print(f"\nWrote {RESULTS}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
