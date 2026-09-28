import type { HardwareCategory, SemanticVisionContext } from './identification'

type LocalizationProvider = 'openai' | 'gemini' | 'grok'

export interface SemanticLocalizationResult {
  category: HardwareCategory
  object_hint: string
  semantic_vision: SemanticVisionContext
}

const PROVIDER_CONFIG = {
  openai: { envKey: 'OPENAI_API_KEY', model: 'gpt-5.6-sol', label: 'OpenAI' },
  gemini: { envKey: 'GEMINI_API_KEY', model: 'gemini-3.7-flash', label: 'Gemini' },
  grok: { envKey: 'XAI_API_KEY', model: 'grok-4.6', label: 'Grok' },
} as const

const REGION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    present: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    x_min: { type: 'number', minimum: 0, maximum: 1000 },
    y_min: { type: 'number', minimum: 0, maximum: 1000 },
    x_max: { type: 'number', minimum: 0, maximum: 1000 },
    y_max: { type: 'number', minimum: 0, maximum: 1000 },
  },
  required: ['present', 'confidence', 'x_min', 'y_min', 'x_max', 'y_max'],
} as const

const LOCALIZATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: {
      type: 'string',
      enum: ['fasteners', 'plumbing', 'electrical', 'building-hardware', 'general-repair', 'unknown'],
    },
    object_hint: { type: 'string' },
    semantic_vision: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target_region: REGION_SCHEMA,
        reference_region: REGION_SCHEMA,
        head_style: {
          type: 'string',
          enum: ['hex', 'flat_countersunk', 'pan', 'button', 'socket_cap', 'round', 'other', 'unknown'],
        },
      },
      required: ['target_region', 'reference_region', 'head_style'],
    },
  },
  required: ['category', 'object_hint', 'semantic_vision'],
} as const

const LOCALIZATION_PROMPT = `
你是 HCSI 的 semantic localization 階段。你只負責告訴 deterministic CV：
1. 主要五金物件在哪裡。
2. 尺、捲尺或其他尺度參考物在哪裡。
3. 若主要物件是螺絲，照片可見的粗略頭型類別。

這不是規格辨識，也不是尺寸量測。禁止輸出或推測任何 mm、cm、inch、TPI、公稱牙徑、牙距、長度或商品規格。

座標規則：
- target_region：主要五金的粗略 bounding box。
- reference_region：尺度參考物的粗略 bounding box；沒有可信參考物時 present=false。
- 所有座標使用整張圖片的 0..1000 正規化座標，左上 (0,0)，右下 (1000,1000)。
- bounding box 要完整包住語義物件並留少量安全邊界，但不要把整張圖都框入。
- target_region 與 reference_region 要盡量區分五金和尺，避免互相吞併。
- confidence 只表示「框到正確語義物件」的信心，不代表量測精度。
- head_style 只從 hex / flat_countersunk / pan / button / socket_cap / round / other / unknown 選一個。
- 看不清楚就 unknown，不要為了讓後續量測成功而硬猜。

你的輸出只用於 ROI / reference exclusion；deterministic CV 仍會自行決定 pixel ownership、尺度與尺寸。
`

export async function localizeForMeasurement(
  image: string,
  provider: LocalizationProvider = 'openai',
): Promise<SemanticLocalizationResult> {
  const config = PROVIDER_CONFIG[provider]
  const apiKey = process.env[config.envKey]
  if (!apiKey) throw new Error(`${config.label} semantic localization 尚未完成設定。`)

  const raw = provider === 'gemini'
    ? await runGemini(apiKey, config.model, image)
    : await runResponses(provider, apiKey, config.model, image)

  if (!isLocalizationResult(raw)) {
    throw new Error(`${config.label} semantic localization 結果格式不完整`)
  }
  return raw
}

async function runResponses(
  provider: 'openai' | 'grok',
  apiKey: string,
  model: string,
  image: string,
): Promise<unknown> {
  const isGrok = provider === 'grok'
  const endpoint = isGrok ? 'https://api.x.ai/v1/responses' : 'https://api.openai.com/v1/responses'
  const label = isGrok ? 'Grok' : 'OpenAI'
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 1400,
      text: {
        format: {
          type: 'json_schema',
          name: 'hcsi_semantic_localization',
          schema: LOCALIZATION_SCHEMA,
          strict: true,
        },
      },
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: LOCALIZATION_PROMPT },
          { type: 'input_image', image_url: `data:image/jpeg;base64,${image}`, detail: 'high' },
        ],
      }],
    }),
  })
  if (!response.ok) {
    const upstream = await response.text()
    console.error(`[HCSI] ${label} localization upstream error:`, response.status, upstream.slice(0, 1200))
    throw new Error(`${label} semantic localization 暫時無法使用。`)
  }
  const data = await response.json()
  const text = data?.output?.flatMap((item: any) => item?.content ?? [])
    .find((item: any) => item?.type === 'output_text')?.text
  return parseJson(text, label)
}

async function runGemini(apiKey: string, model: string, image: string): Promise<unknown> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: LOCALIZATION_PROMPT },
            { inline_data: { mime_type: 'image/jpeg', data: image } },
          ],
        }],
        generationConfig: {
          maxOutputTokens: 1400,
          responseMimeType: 'application/json',
          responseJsonSchema: LOCALIZATION_SCHEMA,
          thinkingConfig: { thinkingLevel: 'low' },
        },
      }),
    },
  )
  if (!response.ok) {
    const upstream = await response.text()
    console.error('[HCSI] Gemini localization upstream error:', response.status, upstream.slice(0, 1200))
    throw new Error('Gemini semantic localization 暫時無法使用。')
  }
  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts
    ?.find((part: any) => typeof part?.text === 'string')?.text
  return parseJson(text, 'Gemini')
}

function parseJson(text: unknown, label: string): unknown {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error(`${label} semantic localization 沒有回傳可解析結果`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} semantic localization JSON 無法解析`)
  }
}

function isRegion(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.present !== 'boolean' || typeof v.confidence !== 'number') return false
  if (v.confidence < 0 || v.confidence > 1) return false
  for (const key of ['x_min', 'y_min', 'x_max', 'y_max']) {
    const coordinate = v[key]
    if (typeof coordinate !== 'number' || !Number.isFinite(coordinate) ||
        coordinate < 0 || coordinate > 1000) return false
  }
  if (v.present && ((v.x_max as number) <= (v.x_min as number) ||
                    (v.y_max as number) <= (v.y_min as number))) return false
  return true
}

function isLocalizationResult(value: unknown): value is SemanticLocalizationResult {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, any>
  const categories = new Set([
    'fasteners', 'plumbing', 'electrical', 'building-hardware', 'general-repair', 'unknown',
  ])
  const heads = new Set([
    'hex', 'flat_countersunk', 'pan', 'button', 'socket_cap', 'round', 'other', 'unknown',
  ])
  return categories.has(v.category) &&
    typeof v.object_hint === 'string' &&
    !!v.semantic_vision &&
    isRegion(v.semantic_vision.target_region) &&
    isRegion(v.semantic_vision.reference_region) &&
    heads.has(v.semantic_vision.head_style)
}
