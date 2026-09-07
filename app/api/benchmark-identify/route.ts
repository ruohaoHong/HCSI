import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MAX_IMAGE_LENGTH = 7_000_000
const MAX_ROUNDS = 3

type Provider = 'gemini' | 'openai'
type FieldStatus = 'confirmed' | 'inferred' | 'unknown'
type FieldValue = { value: string | null; status: FieldStatus }
type IdentificationState = {
  round: number
  purchase_ready: boolean
  purchase_spec: string
  fields: {
    part_type: FieldValue
    thread_system: FieldValue
    nominal_size: FieldValue
    length: FieldValue
    pitch_tpi: FieldValue
    head_type: FieldValue
    drive: FieldValue
    material_finish: FieldValue
  }
  missing_for_purchase: string[]
  next_action: { type: string; instruction: string } | null
  summary: string
}

const EMPTY_STATE: IdentificationState = {
  round: 0,
  purchase_ready: false,
  purchase_spec: '',
  fields: {
    part_type: { value: null, status: 'unknown' },
    thread_system: { value: null, status: 'unknown' },
    nominal_size: { value: null, status: 'unknown' },
    length: { value: null, status: 'unknown' },
    pitch_tpi: { value: null, status: 'unknown' },
    head_type: { value: null, status: 'unknown' },
    drive: { value: null, status: 'unknown' },
    material_finish: { value: null, status: 'unknown' },
  },
  missing_for_purchase: [],
  next_action: null,
  summary: '',
}

function promptFor(round: number, previousState: IdentificationState | null) {
  const previous = previousState
    ? `\n上一輪精簡狀態：\n${JSON.stringify(previousState)}\n\n新照片是追加證據。利用它補足缺失欄位，也可以在新證據明確矛盾時修正舊判斷。不要只是重複上一輪。`
    : '\n這是第一輪。只根據目前這張普通照片，最大化可合理得到的辨識資訊。'

  return `
你是 HCSI 的五金辨識引擎。目標是協助一般使用者取得「足以拿給一般五金行購買正確替代品」的資訊，而不是完成工程檢驗報告。
${previous}

核心規則：
1. 決策優先：目前證據足以判斷的欄位就必須做判斷，不要因為仍有其他不確定欄位而全部回答未知。
2. 不准硬湊：目前證據不能可靠支持的欄位可標 unknown；若有合理但非直接確認的最佳判斷，可標 inferred。
3. confirmed = 目前影像證據可直接支持；inferred = 綜合外觀與五金知識得到的最佳判斷；unknown = 目前沒有足夠依據。
4. purchase_ready 的意思不是所有工程細節 100% 確認，而是目前資訊已足以讓一般五金行理解並提供正確功能與主要規格的替代品。
5. 一旦 purchase_ready=true，next_action 必須是 null，禁止再要求更精確、再拍、再量或繼續驗證。
6. 如果 purchase_ready=false，只列出真正阻礙購買的 missing_for_purchase。不要把 DIN/ISO 編號、鍍層厚度、精確材料牌號等非必要細節當成必填。
7. 每輪最多只能給一個 next_action，而且要選「使用者成本最低、同時最能補足 missing fields」的一個操作。不要一次列多個要求。
8. 優先考慮一般人容易取得的參照物或工具，例如有 mm 刻度的直尺／捲尺、常見且尺寸固定的硬幣。若要求參照照片，要說明零件與參照物需盡量同平面、清楚入鏡。
9. 不要預設使用者有游標卡尺、牙規或專業量具；除非沒有更低成本的方法且它確實阻礙購買，否則不要要求。
10. 不要使用外部 reference material、候選清單或預先提供的規格表。依靠模型自身視覺與五金知識。
11. 不要輸出信心百分比。
12. 這是第 ${round} 輪，最多 ${MAX_ROUNDS} 輪。若已到最後一輪仍不足，next_action 必須為 null，停止追問，保留目前最佳 purchase_spec 與 missing_for_purchase。
13. material_finish 只有在購買替代品確實需要時才影響 purchase_ready；不要為了辨識鍍層而無限迭代。
14. purchase_spec 必須永遠填寫目前「已知資訊能支持的最實用五金行說法」，即使 purchase_ready=false 也不能留白。例如「公制十字盤頭機械螺絲（尺寸待確認）」。

只輸出一個合法 JSON object，不要 Markdown，不要 code fence，不要額外說明。Schema：
{
  "round": ${round},
  "purchase_ready": boolean,
  "purchase_spec": string,
  "fields": {
    "part_type": {"value": string|null, "status": "confirmed"|"inferred"|"unknown"},
    "thread_system": {"value": string|null, "status": "confirmed"|"inferred"|"unknown"},
    "nominal_size": {"value": string|null, "status": "confirmed"|"inferred"|"unknown"},
    "length": {"value": string|null, "status": "confirmed"|"inferred"|"unknown"},
    "pitch_tpi": {"value": string|null, "status": "confirmed"|"inferred"|"unknown"},
    "head_type": {"value": string|null, "status": "confirmed"|"inferred"|"unknown"},
    "drive": {"value": string|null, "status": "confirmed"|"inferred"|"unknown"},
    "material_finish": {"value": string|null, "status": "confirmed"|"inferred"|"unknown"}
  },
  "missing_for_purchase": string[],
  "next_action": {"type": string, "instruction": string}|null,
  "summary": string
}
`
}

function parseState(text: string, round: number): IdentificationState {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const parsed = JSON.parse(cleaned)
  const state = { ...EMPTY_STATE, ...parsed, round } as IdentificationState
  if (round >= MAX_ROUNDS || state.purchase_ready) state.next_action = null
  if (!state.purchase_spec?.trim()) state.purchase_spec = '目前已辨識零件，但購買規格仍待補足。'
  return state
}

async function callOpenAI(images: string[], prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-5.6-sol', reasoning: { effort: 'medium' }, max_output_tokens: 1600,
      input: [{ role: 'user', content: [
        ...images.map((image) => ({ type: 'input_image', image_url: `data:image/jpeg;base64,${image}`, detail: 'high' })),
        { type: 'input_text', text: prompt },
      ] }],
    }),
  })
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 500)}`)
  const data = await response.json()
  const text = data?.output?.flatMap((item: any) => item?.content ?? [])?.find((item: any) => item?.type === 'output_text')?.text
  if (typeof text !== 'string' || !text.trim()) throw new Error('OpenAI returned no text')
  return text
}

async function callGemini(images: string[], prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [
        ...images.map((image) => ({ inline_data: { mime_type: 'image/jpeg', data: image } })),
        { text: prompt },
      ] }],
      generationConfig: { maxOutputTokens: 1600, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'medium' } },
    }),
  })
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${(await response.text()).slice(0, 500)}`)
  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text)?.filter(Boolean)?.join('\n')
  if (typeof text !== 'string' || !text.trim()) throw new Error('Gemini returned no text')
  return text
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const image = typeof body.image === 'string' ? body.image : ''
    const originalImage = typeof body.original_image === 'string' ? body.original_image : ''
    const provider: Provider = body.provider === 'openai' ? 'openai' : 'gemini'
    const previousState = body.previous_state && typeof body.previous_state === 'object' ? body.previous_state as IdentificationState : null
    const round = Math.min(Math.max((previousState?.round ?? 0) + 1, 1), MAX_ROUNDS)

    for (const candidate of [image, originalImage].filter(Boolean)) {
      if (candidate.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(candidate)) {
        return NextResponse.json({ error: '影像格式不正確或檔案過大。' }, { status: 400 })
      }
    }
    if (!image) return NextResponse.json({ error: '請提供本輪影像。' }, { status: 400 })

    const images = round > 1 && originalImage ? [originalImage, image] : [image]
    const prompt = promptFor(round, previousState)
    const raw = provider === 'openai' ? await callOpenAI(images, prompt) : await callGemini(images, prompt)
    const state = parseState(raw, round)

    return NextResponse.json({ provider, state })
  } catch (error) {
    console.error('[HCSI progressive benchmark] error:', error)
    return NextResponse.json({ error: '漸進式辨識執行失敗。' }, { status: 500 })
  }
}
