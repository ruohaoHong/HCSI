# HCSI — Hardware & Construction Supply Identifier

HCSI 是一個面向居家 DIY 與工地情境的通用五金／水電零件影像辨識實驗工具。

同一張照片可以分別交給 **Gemini、OpenAI、Grok** 三個 provider，方便比較模型在相同辨識流程與相同輸出 schema 下的差異。

## 現行架構

每個 provider 都走相同的兩階段流程：

1. **Category Router**：先把主要物件暫時分到緊固／固定件、水管／管件、電氣／配線、裝潢／建築五金、通用維修件或 unknown。
2. **Specialist Identification**：載入共用辨識原則與該類別的精簡 reference，再由同一個 provider 重新看原圖並做最終判斷。

第一階段分類只負責挑選 reference；第二階段模型可以推翻路由結果。程式不以傳統規則引擎替模型決定零件種類或規格。

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

`observed`、`estimated`、`unconfirmed` 用來區分照片直接證據、合理目測與照片無法確認的規格。

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

Reference 只提供辨識原則與具有辨識力的提示，不作為完整百科或規則引擎。舊的螺絲專用 reference、thread geometry benchmark 與相關 CI 已移除，新的 HCSI 從通用零件架構重新開始。

## Environment variables

```bash
GEMINI_API_KEY=
OPENAI_API_KEY=
XAI_API_KEY=

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
