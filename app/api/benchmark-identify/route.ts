import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
const MAX_IMAGE_LENGTH = 7_000_000
const MAX_ROUNDS = 3
const MAX_VARIANTS = 2

type Provider = 'gemini' | 'openai'
type FieldStatus = 'confirmed' | 'unknown'
type FieldValue = { value: string | null; status: FieldStatus }
type Observation = {
  scale_reference_present: boolean
  thread_span_in: number | null
  thread_span_mm: number | null
  pitch_intervals: number | null
  diameter_to_pitch_ratio_min: number | null
  diameter_to_pitch_ratio_max: number | null
  length_in: number | null
  length_mm: number | null
  notes: string[]
}
type DerivedGeometry = {
  tpi: number | null
  pitch_mm: number | null
  diameter_in_min: number | null
  diameter_in_max: number | null
  diameter_mm_min: number | null
  diameter_mm_max: number | null
  source: string[]
}
type Diagnostic = {
  observation: Observation
  derived: DerivedGeometry
  decision_note: string | null
}
type IdentificationState = {
  round: number
  purchase_ready: boolean
  purchase_spec: string
  fields: {
    part_type: FieldValue; thread_system: FieldValue; nominal_size: FieldValue; length: FieldValue
    pitch_tpi: FieldValue; head_type: FieldValue; drive: FieldValue; material_finish: FieldValue
  }
  missing_for_purchase: string[]
  next_action: { type: string; instruction: string } | null
  summary: string
  diagnostic: Diagnostic
}

type ObservationResponse = {
  observation: Observation
  appearance: {
    part_type: string | null
    head_type: string | null
    drive: string | null
    material_finish: string | null
  }
}

const emptyField = (): FieldValue => ({ value: null, status: 'unknown' })
const EMPTY_OBSERVATION: Observation = { scale_reference_present: false, thread_span_in: null, thread_span_mm: null, pitch_intervals: null, diameter_to_pitch_ratio_min: null, diameter_to_pitch_ratio_max: null, length_in: null, length_mm: null, notes: [] }
const EMPTY_DERIVED: DerivedGeometry = { tpi: null, pitch_mm: null, diameter_in_min: null, diameter_in_max: null, diameter_mm_min: null, diameter_mm_max: null, source: [] }
const EMPTY_DIAGNOSTIC: Diagnostic = { observation: EMPTY_OBSERVATION, derived: EMPTY_DERIVED, decision_note: null }
const EMPTY_STATE: IdentificationState = { round: 0, purchase_ready: false, purchase_spec: '', fields: { part_type: emptyField(), thread_system: emptyField(), nominal_size: emptyField(), length: emptyField(), pitch_tpi: emptyField(), head_type: emptyField(), drive: emptyField(), material_finish: emptyField() }, missing_for_purchase: [], next_action: null, summary: '', diagnostic: EMPTY_DIAGNOSTIC }

function observationPrompt(round: number, previousState: IdentificationState | null, variantCount: number) {
  const previous = previousState ? `\n上一輪結果只作為照片脈絡，不可用其規格名稱反推本輪量測：${JSON.stringify(previousState.fields)}` : ''
  const variants = variantCount ? `\n原圖後另有 ${variantCount} 張同源的對比／灰階處理視圖。它們只能幫助看清既有邊界、牙峰與刻度，不是獨立證據；若與原圖衝突，以原圖為準。` : ''
  return `你是 HCSI 的視覺觀察階段。這一階段禁止命名或選擇任何標準螺紋規格，例如 M6、M8、1/4-20、5/16-24、UNC、UNF。你的工作只有從影像回報原始幾何 observation。${previous}${variants}

第 ${round} 輪。請觀察：
1. 若有可用尺／參照尺度，估計一段清楚連續螺紋的實際跨度 thread_span，優先使用長跨度；英吋可填 thread_span_in，公制可填 thread_span_mm，可同時填但必須代表同一段。
2. 對同一段 thread_span，數完整 pitch intervals，填 pitch_intervals。不要把牙峰數直接當 interval 數。
3. 直接從影像比較螺紋外徑與平均 pitch，回報 diameter_to_pitch_ratio_min/max。這是純比例，不需要知道規格。
4. 若可可靠判讀頭下承面到末端的總長，填 length_in 或 length_mm。
5. 零件類型、頭型、驅動、材質／表面只做外觀描述。

重要限制：
- 不要計算 TPI、pitch mm、diameter mm/inch；後端程式會計算。
- 不要說最符合哪個標準，不要把觀察值調整到某個常見規格。
- 不要從模糊頭部刻印判斷公英制。
- 看不清就 null。近似可用合理數值，但不要假精度。
- notes 只寫實際視覺觀察。

只輸出 JSON：
{"observation":{"scale_reference_present":boolean,"thread_span_in":number|null,"thread_span_mm":number|null,"pitch_intervals":number|null,"diameter_to_pitch_ratio_min":number|null,"diameter_to_pitch_ratio_max":number|null,"length_in":number|null,"length_mm":number|null,"notes":string[]},"appearance":{"part_type":string|null,"head_type":string|null,"drive":string|null,"material_finish":string|null}}`
}

function finiteNumber(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null }
function round(value: number, digits = 4) { const f = 10 ** digits; return Math.round(value * f) / f }

function parseObservation(text: string): ObservationResponse {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const first = trimmed.indexOf('{'); const last = trimmed.lastIndexOf('}')
  let parsed: any
  try { parsed = JSON.parse(first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed) } catch { throw new Error('MODEL_JSON_PARSE_FAILED') }
  const o = parsed?.observation ?? {}
  let ratioMin = finiteNumber(o.diameter_to_pitch_ratio_min); let ratioMax = finiteNumber(o.diameter_to_pitch_ratio_max)
  if (ratioMin && ratioMax && ratioMin > ratioMax) [ratioMin, ratioMax] = [ratioMax, ratioMin]
  return {
    observation: {
      scale_reference_present: o.scale_reference_present === true,
      thread_span_in: finiteNumber(o.thread_span_in), thread_span_mm: finiteNumber(o.thread_span_mm), pitch_intervals: finiteNumber(o.pitch_intervals),
      diameter_to_pitch_ratio_min: ratioMin, diameter_to_pitch_ratio_max: ratioMax,
      length_in: finiteNumber(o.length_in), length_mm: finiteNumber(o.length_mm),
      notes: Array.isArray(o.notes) ? o.notes.map(String).slice(0, 8) : [],
    },
    appearance: {
      part_type: parsed?.appearance?.part_type ? String(parsed.appearance.part_type) : null,
      head_type: parsed?.appearance?.head_type ? String(parsed.appearance.head_type) : null,
      drive: parsed?.appearance?.drive ? String(parsed.appearance.drive) : null,
      material_finish: parsed?.appearance?.material_finish ? String(parsed.appearance.material_finish) : null,
    },
  }
}

function deriveGeometry(o: Observation): DerivedGeometry {
  const source: string[] = []
  let tpi: number | null = null; let pitchMm: number | null = null
  if (o.pitch_intervals && o.thread_span_in) { tpi = o.pitch_intervals / o.thread_span_in; pitchMm = 25.4 / tpi; source.push(`tpi = ${o.pitch_intervals} / ${o.thread_span_in} in`) }
  else if (o.pitch_intervals && o.thread_span_mm) { pitchMm = o.thread_span_mm / o.pitch_intervals; tpi = 25.4 / pitchMm; source.push(`pitch_mm = ${o.thread_span_mm} / ${o.pitch_intervals}`) }
  let diameterInMin: number | null = null; let diameterInMax: number | null = null
  if (tpi && o.diameter_to_pitch_ratio_min) { diameterInMin = o.diameter_to_pitch_ratio_min / tpi; source.push('diameter = D/P ratio / TPI') }
  if (tpi && o.diameter_to_pitch_ratio_max) diameterInMax = o.diameter_to_pitch_ratio_max / tpi
  if (diameterInMin && !diameterInMax) diameterInMax = diameterInMin
  if (diameterInMax && !diameterInMin) diameterInMin = diameterInMax
  return {
    tpi: tpi ? round(tpi, 3) : null,
    pitch_mm: pitchMm ? round(pitchMm, 4) : null,
    diameter_in_min: diameterInMin ? round(diameterInMin, 4) : null,
    diameter_in_max: diameterInMax ? round(diameterInMax, 4) : null,
    diameter_mm_min: diameterInMin ? round(diameterInMin * 25.4, 3) : null,
    diameter_mm_max: diameterInMax ? round(diameterInMax * 25.4, 3) : null,
    source,
  }
}

function decisionPrompt(roundNumber: number, previousState: IdentificationState | null, observed: ObservationResponse, derived: DerivedGeometry) {
  return `你是 HCSI 的規格決策階段。視覺觀察已經完成；不要重新看圖或重新估尺寸。你只能使用下列 observation、後端 deterministic math 結果，以及清楚的外觀描述來決定購買規格。

原始 observation：${JSON.stringify(observed.observation)}
後端計算 derived_geometry：${JSON.stringify(derived)}
外觀：${JSON.stringify(observed.appearance)}
上一輪狀態（如有，可修正）：${previousState ? JSON.stringify(previousState.fields) : 'null'}

規則：
1. derived_geometry 的算術結果優先於你自行心算；不要把它改成更常見的數字。
2. 先把 derived diameter、TPI/pitch、length 對照合理標準。若一個標準明顯最佳，confirmed；若觀察範圍跨越多個近似標準且無法合理區分，unknown。
3. 不因規格常見而選擇；尺的單位不代表螺紋制式。
4. 只有 confirmed / unknown。purchase_ready 表示一般五金行已足以提供主要規格正確替代品。
5. purchase_ready=true 時 next_action=null；false 時只列真正阻礙購買的欄位並最多一個低成本 next_action。
6. 材質或表面若僅憑銀白外觀無法可靠區分，可 unknown，不應因此阻止尺寸已足夠時的主要規格判斷；是否 purchase_ready 依功能替代所需資訊判斷。
7. 現在第 ${roundNumber} 輪，最多 ${MAX_ROUNDS} 輪；第3輪停止追問。

只輸出 JSON：
{"purchase_ready":boolean,"purchase_spec":string,"fields":{"part_type":{"value":string|null,"status":"confirmed"|"unknown"},"thread_system":{"value":string|null,"status":"confirmed"|"unknown"},"nominal_size":{"value":string|null,"status":"confirmed"|"unknown"},"length":{"value":string|null,"status":"confirmed"|"unknown"},"pitch_tpi":{"value":string|null,"status":"confirmed"|"unknown"},"head_type":{"value":string|null,"status":"confirmed"|"unknown"},"drive":{"value":string|null,"status":"confirmed"|"unknown"},"material_finish":{"value":string|null,"status":"confirmed"|"unknown"}},"missing_for_purchase":string[],"next_action":{"type":string,"instruction":string}|null,"summary":string,"decision_note":string|null}`
}

function parseDecision(text: string, roundNumber: number, diagnostic: Diagnostic): IdentificationState {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const first = trimmed.indexOf('{'); const last = trimmed.lastIndexOf('}')
  let parsed: any
  try { parsed = JSON.parse(first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed) } catch { throw new Error('MODEL_JSON_PARSE_FAILED') }
  const state = { ...EMPTY_STATE, ...parsed, round: roundNumber, diagnostic: { ...diagnostic, decision_note: parsed?.decision_note ? String(parsed.decision_note) : null } } as IdentificationState
  const fields = { ...EMPTY_STATE.fields }
  for (const key of Object.keys(fields) as Array<keyof typeof fields>) { const incoming = parsed?.fields?.[key]; fields[key] = incoming?.value ? { value: String(incoming.value), status: incoming.status === 'unknown' ? 'unknown' : 'confirmed' } : emptyField() }
  state.fields = fields
  if (!Array.isArray(state.missing_for_purchase)) state.missing_for_purchase = []
  if (roundNumber >= MAX_ROUNDS || state.purchase_ready) state.next_action = null
  if (!state.purchase_spec?.trim()) state.purchase_spec = '目前已辨識零件，但購買規格仍待補足。'
  if (typeof state.summary !== 'string') state.summary = ''
  return state
}

async function callOpenAI(images: string[], prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY; if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING')
  const content: any[] = [...images.map((image) => ({ type: 'input_image', image_url: `data:image/jpeg;base64,${image}`, detail: 'high' })), { type: 'input_text', text: prompt }]
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: 'gpt-5.6-sol', reasoning: { effort: 'medium' }, max_output_tokens: 8000, input: [{ role: 'user', content }] }) })
  if (!response.ok) throw new Error(`OPENAI_UPSTREAM_${response.status}`)
  const data = await response.json(); const text = data?.output?.flatMap((item: any) => item?.content ?? [])?.find((item: any) => item?.type === 'output_text')?.text
  if (typeof text !== 'string' || !text.trim()) { if (data?.status === 'incomplete') throw new Error(`OPENAI_INCOMPLETE_${data?.incomplete_details?.reason ?? 'UNKNOWN'}`); throw new Error('OPENAI_EMPTY_OUTPUT') }
  return text
}
async function callOpenAIText(prompt: string) { return callOpenAI([], prompt) }

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function callGemini(images: string[], prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY; if (!apiKey) throw new Error('GEMINI_API_KEY_MISSING')
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent'
  const requestBody = JSON.stringify({ contents: [{ parts: [...images.map((image) => ({ inline_data: { mime_type: 'image/jpeg', data: image } })), { text: prompt }] }], generationConfig: { maxOutputTokens: 4000, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'medium' } } })
  let response: Response | null = null
  for (let attempt = 0; attempt < 2; attempt++) { response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: requestBody }); if (response.status !== 503) break; if (attempt === 0) await wait(900) }
  if (!response) throw new Error('GEMINI_EMPTY_OUTPUT')
  if (!response.ok) { if (response.status === 503) throw new Error('GEMINI_UNAVAILABLE_503'); throw new Error(`GEMINI_UPSTREAM_${response.status}`) }
  const data = await response.json(); const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text)?.filter(Boolean)?.join('\n')
  if (typeof text !== 'string' || !text.trim()) throw new Error('GEMINI_EMPTY_OUTPUT')
  return text
}
async function callGeminiText(prompt: string) { return callGemini([], prompt) }

function safeErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : 'UNKNOWN'
  if (code === 'OPENAI_API_KEY_MISSING') return '此 Preview 環境沒有 OPENAI_API_KEY。'
  if (code === 'GEMINI_API_KEY_MISSING') return '此 Preview 環境沒有 GEMINI_API_KEY。'
  if (code === 'MODEL_JSON_PARSE_FAILED') return 'AI 已回傳內容，但 JSON 格式解析失敗。請再試一次。'
  if (code.startsWith('OPENAI_UPSTREAM_')) return `OpenAI API 呼叫失敗（HTTP ${code.replace('OPENAI_UPSTREAM_', '')}）。`
  if (code === 'GEMINI_UNAVAILABLE_503') return 'Gemini API 暫時無法服務（HTTP 503）；已自動重試一次。'
  if (code.startsWith('GEMINI_UPSTREAM_')) return `Gemini API 呼叫失敗（HTTP ${code.replace('GEMINI_UPSTREAM_', '')}）。`
  if (code.startsWith('OPENAI_INCOMPLETE_')) return `OpenAI 輸出未完成（${code.replace('OPENAI_INCOMPLETE_', '')}）。`
  if (code === 'OPENAI_EMPTY_OUTPUT') return 'OpenAI API 沒有回傳可用文字。'
  if (code === 'GEMINI_EMPTY_OUTPUT') return 'Gemini API 沒有回傳可用文字。'
  return '漸進式辨識執行失敗。'
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const image = typeof body.image === 'string' ? body.image : ''
    const originalImage = typeof body.original_image === 'string' ? body.original_image : ''
    const variants = Array.isArray(body.image_variants) ? body.image_variants.filter((v: unknown): v is string => typeof v === 'string').slice(0, MAX_VARIANTS) : []
    const provider: Provider = body.provider === 'openai' ? 'openai' : 'gemini'
    const previousState = body.previous_state && typeof body.previous_state === 'object' ? body.previous_state as IdentificationState : null
    const roundNumber = Math.min(Math.max((previousState?.round ?? 0) + 1, 1), MAX_ROUNDS)
    for (const candidate of [image, originalImage, ...variants].filter(Boolean)) if (candidate.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(candidate)) return NextResponse.json({ error: '影像格式不正確或檔案過大。' }, { status: 400 })
    if (!image) return NextResponse.json({ error: '請提供本輪影像。' }, { status: 400 })

    const images = roundNumber > 1 && originalImage ? [originalImage, image, ...variants] : [image, ...variants]
    const observePrompt = observationPrompt(roundNumber, previousState, variants.length)
    const observationRaw = provider === 'openai' ? await callOpenAI(images, observePrompt) : await callGemini(images, observePrompt)
    const observed = parseObservation(observationRaw)
    const derived = deriveGeometry(observed.observation)
    const diagnostic: Diagnostic = { observation: observed.observation, derived, decision_note: null }

    const decidePrompt = decisionPrompt(roundNumber, previousState, observed, derived)
    const decisionRaw = provider === 'openai' ? await callOpenAIText(decidePrompt) : await callGeminiText(decidePrompt)
    const state = parseDecision(decisionRaw, roundNumber, diagnostic)
    return NextResponse.json({ provider, state })
  } catch (error) {
    console.error('[HCSI two-stage benchmark] error:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}