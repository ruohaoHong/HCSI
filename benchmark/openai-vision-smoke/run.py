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
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 HCSI-Benchmark/1.0",
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                },
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                original = resp.read()
            if not original:
                raise ValueError("empty response body")
            dest.write_bytes(original)

            # Decode actual bytes. HTML error pages, corrupt files, etc. fail here even when HTTP was 200.
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

            # AVIF and other decodable real-photo formats are transcoded only for API compatibility.
            # This is deterministic format conversion, not image generation or synthetic augmentation.
            if final_mime is None:
                with Image.open(dest) as img:
                    if getattr(img, "n_frames", 1) > 1:
                        img.seek(0)
                    rgb = img.convert("RGB")
                    rgb.save(dest, format="JPEG", quality=95, subsampling=0)
                converted = True
                final_format = "JPEG"
                final_mime = "image/jpeg"

            final_bytes = dest.read_bytes()
            with Image.open(dest) as img:
                final_width, final_height = img.size
                img.verify()

            return {
                "original_bytes": len(original),
                "original_sha256": hashlib.sha256(original).hexdigest(),
                "original_format": original_format,
                "content_type": content_type,
                "converted_for_api": converted,
                "api_bytes": len(final_bytes),
                "api_sha256": hashlib.sha256(final_bytes).hexdigest(),
                "width": final_width,
                "height": final_height,
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

    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    data_url = f"data:{mime};base64,{encoded}"
    prompt = (
        "You are testing a hardware/component image identifier. Inspect only the supplied real photograph. "
        "Do not assume dimensions, ratings, material grade, brand, model, thread standard, or other hidden specifications "
        "unless visibly supported. Return JSON only with keys: category, item_name, confidence, visible_evidence, "
        "uncertain_fields. category must be one of fasteners, plumbing, electrical, building-hardware, general-repair, unknown."
    )
    payload = {
        "model": "gpt-5.6-sol",
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": data_url, "detail": "high"},
                ],
            }
        ],
        "max_output_tokens": 1200,
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            status = resp.status
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read().decode("utf-8", errors="replace")
    data = json.loads(raw)
    if status < 200 or status >= 300:
        err = data.get("error", {})
        raise RuntimeError(f"OpenAI HTTP {status}: {err.get('code')} {err.get('message')}")

    text = ""
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                text += content.get("text", "")
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return json.loads(text.strip())


def normalize(s: str) -> str:
    return " ".join((s or "").lower().replace("_", "-").replace("/", " ").split())


def token_match(expected: str, actual: str) -> bool:
    e = set(normalize(expected).replace("-", " ").split())
    a = set(normalize(actual).replace("-", " ").split())
    if not e or not a:
        return False
    return len(e & a) / len(e) >= 0.6 or len(e & a) / len(a) >= 0.6


def evaluate(case: dict, answer: dict) -> dict:
    category_ok = normalize(answer.get("category")) == normalize(case["category"])
    item = answer.get("item_name", "")
    name_ok = any(token_match(name, item) for name in case["expected_names"])
    return {"category_ok": category_ok, "name_ok": name_ok}


def main() -> int:
    dataset = json.loads(DATASET.read_text(encoding="utf-8"))
    if dataset.get("policy", {}).get("generated_images_allowed") is not False:
        raise SystemExit("Dataset policy must explicitly forbid generated images")

    results = {"dataset_version": dataset["version"], "generated_images_used": False, "cases": []}
    failures = 0

    with tempfile.TemporaryDirectory(prefix="hcsi-vision-") as tmp:
        tmpdir = pathlib.Path(tmp)
        for case in dataset["cases"]:
            row = {
                "id": case["id"],
                "expected_category": case["category"],
                "source": case["source"],
                "image_url": case["image_url"],
            }
            print(f"\n=== {case['id']} ===")
            path = tmpdir / f"{case['id']}.img"
            try:
                validation = download_image(case["image_url"], path)
                row["image_validation"] = {"status": "ok", **validation}
                print(
                    f"image ok: original={validation['original_format']} api={validation['format']} "
                    f"{validation['width']}x{validation['height']} converted={validation['converted_for_api']} "
                    f"sha256={validation['original_sha256'][:12]}..."
                )
            except Exception as exc:
                row["image_validation"] = {"status": "download_failed", "error": str(exc)}
                row["api_status"] = "skipped"
                results["cases"].append(row)
                failures += 1
                print(f"download_failed: {exc}")
                continue

            try:
                answer = openai_identify(path, validation["mime"])
                row["api_status"] = "ok"
                row["answer"] = answer
                row["evaluation"] = evaluate(case, answer)
                print("answer:", json.dumps(answer, ensure_ascii=False))
                print("evaluation:", row["evaluation"])
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
