# HCSI — Hardware & Construction Supply Identifier

HCSI 是一個面向居家 DIY 與工地情境的通用五金／水電零件影像辨識實驗工具。

同一張照片可以分別交給 **Gemini、OpenAI、Grok** 三個 provider，比較模型在相同辨識流程、reference 與 deterministic measurement evidence 下的差異。

## 現行辨識架構

每個 provider 都走相同的兩階段 LLM 流程：

1. **Category Router**：先把主要物件暫時分到緊固／固定件、水管／管件、電氣／配線、裝潢／建築五金、通用維修件或 unknown。
2. **Specialist Identification**：載入共用辨識原則與該類別的精簡 reference，再由同一個 provider 重新看原圖並做最終判斷。

第一階段分類只負責挑選 reference；第二階段模型可以推翻路由結果。程式不以傳統規則引擎替模型決定零件種類或規格。

## Ruler measurement PoC

`feature/ruler-measurement-poc` 加入獨立的 Python measurement service：

```text
compressed user image
        ↓
Measurement Preflight
├─ RulerNet ONNX：公制尺 centimeter marks / image scale
├─ OpenCV：主要五金 contour
├─ PCA / minAreaRect：pixel geometry
└─ evidence gate：判斷是否可安全輸出實際尺寸
        ↓
measurement JSON
        ↓
Gemini / OpenAI / Grok
```

Measurement 與 LLM 辨識刻意分離。Vision LLM 不得只靠 pixel 大小或主觀目測自行產生 mm / cm / inch 數值。

### Preflight 三態

- `valid` → `measurement_assisted`：尺與幾何證據足以產生 `length_mm` / `width_mm`，尺寸證據可交給 LLM。
- `no_reference` → `appearance_only`：目前沒有建立出可確認尺度；仍可辨識種類與結構，但不提供實際尺寸。
- `unreliable` → `appearance_only`：有尺度／幾何線索，但不足以可靠量測；UI 建議重拍，且失敗的 diagnostics 不得當成尺寸證據。

`measurement_valid=false` 時所有絕對尺寸欄位保持 `null`。量測服務本身不可用屬於 infrastructure error，與 `no_reference` 分開處理，避免錯怪使用者照片。

### 第一版拍攝條件

- 五金與尺應放在同一平面。
- 優先近似垂直俯拍。
- 公制尺至少露出多個完整公分刻度。
- 尺與五金主要方向接近平行會降低透視風險，但**不是單獨的 hard gate**。
- RulerNet 能建模尺方向上的透視 progression，但一把一維尺不等於完整 2D 平面標定；強透視時系統不輸出絕對尺寸。
- 第一版假設單一主要五金、背景相對簡單；OpenCV contour 不穩時才考慮加入 SAM / Grounded SAM 2。

### RulerNet license

PoC 使用 `ymp5078/RulerNet` 的官方 ONNX 模型。模型與相關材料標示為 **CC BY-NC 4.0**，因此本分支只定位為研究／PoC。未來若商業化，需要取得商用授權或替換 implementation。

模型不直接 commit 進 HCSI repo。可設定：

```bash
RULERNET_MODEL_PATH=/models/model.onnx
```

PoC / CI 若要明確允許下載非商用模型，可設定：

```bash
RULERNET_ALLOW_NONCOMMERCIAL_DOWNLOAD=true
```

## Measurement service

```bash
cd measurement-service
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

Next.js server 端設定：

```bash
HCSI_MEASUREMENT_SERVICE_URL=http://localhost:8000
HCSI_MEASUREMENT_TOKEN=
```

`HCSI_MEASUREMENT_TOKEN` 若有設定，Next.js 與 Python service 之間使用 Bearer token。量測結果含輸入 JPEG 的 SHA-256，Next.js 會驗證結果是否屬於同一張影像。

## Measurement benchmark

`benchmark/measurement-poc` 會計算實際值與量測值的誤差，例如：

```text
actual_length_mm = 40.0
measured_length_mm = 39.7
absolute_error_mm = 0.3
relative_error_pct = 0.75%
```

GitHub Actions 另有 synthetic/unit/integration tests 與官方 RulerNet ONNX smoke test。真正的產品準確度仍需以包含 ground truth 的真實拍攝資料集評估，不能只用 synthetic tests 證明。

## Structured Output

三個 provider 共用同一份 JSON schema，主要欄位包含：

- category / item name / common names
- visible features / material / subtype
- flexible specifications + evidence level
- most likely identification
- confusable candidate + key differentiator
- uncertain fields
- typical use
- purchase description
- safety note

`measured`、`observed`、`estimated`、`unconfirmed` 分別表示 HCSI deterministic 系統實測、照片直接可見、非尺寸屬性的合理推論，以及目前證據無法確認。沒有可信 deterministic measurement 時，Vision LLM 不得自行產生數值 mm / cm / inch 尺寸。

## Reference packs

```text
data/reference/
├── core/
├── fasteners/
├── plumbing/
├── electrical/
├── building-hardware/
└── general-repair/
```

Reference 只提供辨識原則與具有辨識力的提示，不作為完整百科或規則引擎。

## Environment variables

```bash
GEMINI_API_KEY=
OPENAI_API_KEY=
XAI_API_KEY=

HCSI_MEASUREMENT_SERVICE_URL=
HCSI_MEASUREMENT_TOKEN=

# optional logging
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

目前 provider：

- Gemini: `gemini-3.7-flash`
- OpenAI: `gpt-5.6-sol`
- Grok: `grok-4.6`

## Development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.
