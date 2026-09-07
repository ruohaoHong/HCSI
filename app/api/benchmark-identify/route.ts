import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
const MAX_IMAGE_LENGTH = 7_000_000
const MAX_ROUNDS = 3
const MAX_VARIANTS = 2

type Provider = 'gemini' | 'openai'
type FieldStatus = 'confirmed' | 'unknown'
type FieldValue = { value: string | null; status: FieldStatus }
type Diagnostic = { scale_reference_present: boolean; relative_geometry_used: boolean; visible_thread_span: string | null; estimated_thread_count: number | null; diameter_to_pitch_ratio: string | null; length_to_diameter_ratio: string | null; scale_observations: string[]; strongest_system_evidence: string | null }
type IdentificationState = { round: number; purchase_ready: boolean; purchase_spec: string; fields: { part_type: FieldValue; thread_system: FieldValue; nominal_size: FieldValue; length: FieldValue; pitch_tpi: FieldValue; head_type: FieldValue; drive: FieldValue; material_finish: FieldValue }; missing_for_purchase: string[]; next_action: { type: string; instruction: string } | null; summary: string; diagnostic: Diagnostic }

const emptyField = (): FieldValue => ({ value: null, status: 'unknown' })
const EMPTY_DIAGNOSTIC: Diagnostic = { scale_reference_present: false, relative_geometry_used: false, visible_thread_span: null, estimated_thread_count: null, diameter_to_pitch_ratio: null, length_to_diameter_ratio: null, scale_observations: [], strongest_system_evidence: null }
const EMPTY_STATE: IdentificationState = { round: 0, purchase_ready: false, purchase_spec: '', fields: { part_type: emptyField(), thread_system: emptyField(), nominal_size: emptyField(), length: emptyField(), pitch_tpi: emptyField(), head_type: emptyField(), drive: emptyField(), material_finish: emptyField() }, missing_for_purchase: [], next_action: null, summary: '', diagnostic: EMPTY_DIAGNOSTIC }

function promptFor(round: number, previousState: IdentificationState | null, variantCount: number) {
  const previous = previousState ? `\n上一輪狀態：\n${JSON.stringify(previousState)}\n\n新照片是追加證據；上一輪結果可修正。` : '\n這是第一輪。直接從目前照片開始。'
  const preprocessing = variantCount > 0 ? `\n本輪除了原始最佳化影像，後面另附 ${variantCount} 張由同一張照片自動產生的視覺版本（對比／灰階增強）。它們不是新的獨立證據，也沒有新增任何真實細節。請把它們當作同一影像的不同觀看方式：只在原圖與處理版共同支持某個牙峰、邊界或刻度時提高採信；若處理版產生光暈、假邊緣或與原圖衝突，以原圖為準。` : ''
  return `你是 HCSI 五金辨識引擎。目標是提供足以拿給一般五金行購買正確替代品的資訊。${previous}${preprocessing}

本測試重點是改善視覺 perception，而不是增加規格先驗。先觀察幾何，再命名規格。
A. 找最清楚的連續螺紋區，利用多個連續牙距形成平均 pitch，不要只盯單一牙距。
B. 比較螺紋外徑與平均 pitch 的相對跨度，估 diameter/pitch ratio，也就是一個外徑約容納幾個平均 pitch。這個比例不需要絕對尺度。
C. 若有尺，使用跨多格的長跨度建立尺度，再用長跨度與完整 pitch intervals 估 pitch/TPI；尺的單位不代表螺紋制式。
D. 原圖與處理版要交叉看：處理版的用途是讓既有牙峰、牙谷、外徑邊界和尺刻度更容易辨認，不可把濾鏡產生的假邊緣當成新牙紋。
E. 最後才把 diameter/pitch ratio、累積牙數、length/diameter 與絕對尺度一起對照標準規格。

規則：
1. 只有 confirmed / unknown；confirmed 是目前影像支持的最佳購買決策，unknown 只在真的無法合理區分時使用。
2. diameter_to_pitch_ratio 與 estimated_thread_count 必須先由影像觀察，不得先選規格再填理論值。
3. 不用模糊文字、頭面刻印或疑似強度標記作為 thread_system 主要證據。
4. 不因規格常見就選它；幾何整體有明顯最佳答案就決定。
5. 不宣稱執行不存在的 pixel measurement、透視校正、edge detection；本輪只有模型看原圖與預處理視圖。
6. 近似值可用合理範圍；看不清就 null，不製造高精度。
7. purchase_ready=true 時 next_action=null；false 時最多一個低成本 next_action。
8. diagnostic 誠實記錄實際採用的牙數、ratio、尺度觀察，也可在 scale_observations 註明預處理視圖是否真的幫助辨認。
9. 現在第 ${round} 輪，最多 ${MAX_ROUNDS} 輪；第 3 輪停止追問。

只輸出合法 JSON object，不要 Markdown、code fence 或額外文字：
{"round":${round},"purchase_ready":boolean,"purchase_spec":string,"fields":{"part_type":{"value":string|null,"status":"confirmed"|"unknown"},"thread_system":{"value":string|null,"status":"confirmed"|"unknown"},"nominal_size":{"value":string|null,"status":"confirmed"|"unknown"},"length":{"value":string|null,"status":"confirmed"|"unknown"},"pitch_tpi":{"value":string|null,"status":"confirmed"|"unknown"},"head_type":{"value":string|null,"status":"confirmed"|"unknown"},"drive":{"value":string|null,"status":"confirmed"|"unknown"},"material_finish":{"value":string|null,"status":"confirmed"|"unknown"}},"missing_for_purchase":string[],"next_action":{"type":string,"instruction":string}|null,"summary":string,"diagnostic":{"scale_reference_present":boolean,"relative_geometry_used":boolean,"visible_thread_span":string|null,"estimated_thread_count":number|null,"diameter_to_pitch_ratio":string|null,"length_to_diameter_ratio":string|null,"scale_observations":string[],"strongest_system_evidence":string|null}}
}`
}

function parseState(text: string, round: number): IdentificationState {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const firstBrace = trimmed.indexOf('{'); const lastBrace = trimmed.lastIndexOf('}')
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed
  let parsed: Partial<IdentificationState>
  try { parsed = JSON.parse(jsonText) } catch { throw new Error('MODEL_JSON_PARSE_FAILED') }
  const state = { ...EMPTY_STATE, ...parsed, round } as IdentificationState
  const normalizedFields = { ...EMPTY_STATE.fields }
  for (const key of Object.keys(normalizedFields) as Array<keyof typeof normalizedFields>) { const incoming = state.fields?.[key]; normalizedFields[key] = incoming?.value ? { value: String(incoming.value), status: incoming.status === 'unknown' ? 'unknown' : 'confirmed' } : emptyField() }
  state.fields = normalizedFields
  if (!Array.isArray(state.missing_for_purchase)) state.missing_for_purchase = []
  const d = state.diagnostic && typeof state.diagnostic === 'object' ? state.diagnostic : EMPTY_DIAGNOSTIC
  state.diagnostic = { scale_reference_present: d.scale_reference_present === true, relative_geometry_used: d.relative_geometry_used === true, visible_thread_span: d.visible_thread_span ? String(d.visible_thread_span) : null, estimated_thread_count: typeof d.estimated_thread_count === 'number' && Number.isFinite(d.estimated_thread_count) ? d.estimated_thread_count : null, diameter_to_pitch_ratio: d.diameter_to_pitch_ratio ? String(d.diameter_to_pitch_ratio) : null, length_to_diameter_ratio: d.length_to_diameter_ratio ? String(d.length_to_diameter_ratio) : null, scale_observations: Array.isArray(d.scale_observations) ? d.scale_observations.map(String).slice(0, 8) : [], strongest_system_evidence: d.strongest_system_evidence ? String(d.strongest_system_evidence) : null }
  if (round >= MAX_ROUNDS || state.purchase_ready) state.next_action = null
  if (!state.purchase_spec?.trim()) state.purchase_spec = '目前已辨識零件，但購買規格仍待補足。'
  if (typeof state.summary !== 'string') state.summary = ''
  return state
}

async function callOpenAI(images: string[], prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY; if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING')
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: 'gpt-5.6-sol', reasoning: { effort: 'medium' }, max_output_tokens: 8000, input: [{ role: 'user', content: [...images.map((image) => ({ type: 'input_image', image_url: `data:image/jpeg;base64,${image}`, detail: 'high' })), { type: 'input_text', text: prompt }] }] }) })
  if (!response.ok) throw new Error(`OPENAI_UPSTREAM_${response.status}`)
  const data = await response.json(); const text = data?.output?.flatMap((item: any) => item?.content ?? [])?.find((item: any) => item?.type === 'output_text')?.text
  if (typeof text !== 'string' || !text.trim()) { if (data?.status === 'incomplete') throw new Error(`OPENAI_INCOMPLETE_${data?.incomplete_details?.reason ?? 'UNKNOWN'}`); throw new Error('OPENAI_EMPTY_OUTPUT') }
  return text
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function callGemini(images: string[], prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY; if (!apiKey) throw new Error('GEMINI_API_KEY_MISSING')
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent'
  const requestBody = JSON.stringify({ contents: [{ parts: [...images.map((image) => ({ inline_data: { mime_type: 'image/jpeg', data: image } })), { text: prompt }] }], generationConfig: { maxOutputTokens: 3000, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'medium' } } })
  let response: Response | null = null
  for (let attempt = 0; attempt < 2; attempt++) { response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: requestBody }); if (response.status !== 503) break; if (attempt === 0) await wait(900) }
  if (!response) throw new Error('GEMINI_EMPTY_OUTPUT')
  if (!response.ok) { if (response.status === 503) throw new Error('GEMINI_UNAVAILABLE_503'); throw new Error(`GEMINI_UPSTREAM_${response.status}`) }
  const data = await response.json(); const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text)?.filter(Boolean)?.join('\n')
  if (typeof text !== 'string' || !text.trim()) throw new Error('GEMINI_EMPTY_OUTPUT')
  return text
}

function safeErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : 'UNKNOWN'
  if (code === 'OPENAI_API_KEY_MISSING') return '此 Preview 環境沒有 OPENAI_API_KEY。請在 Vercel 將 OPENAI_API_KEY 套用到 Preview 環境後重新部署。'
  if (code === 'GEMINI_API_KEY_MISSING') return '此 Preview 環境沒有 GEMINI_API_KEY。請在 Vercel 將 GEMINI_API_KEY 套用到 Preview 環境後重新部署。'
  if (code === 'MODEL_JSON_PARSE_FAILED') return 'AI 已回傳內容，但格式解析失敗。請再試一次。'
  if (code.startsWith('OPENAI_UPSTREAM_')) return `OpenAI API 呼叫失敗（HTTP ${code.replace('OPENAI_UPSTREAM_', '')}）。`
  if (code === 'GEMINI_UNAVAILABLE_503') return 'Gemini API 暫時無法服務（HTTP 503）；系統已自動重試一次仍失敗。'
  if (code.startsWith('GEMINI_UPSTREAM_')) return `Gemini API 呼叫失敗（HTTP ${code.replace('GEMINI_UPSTREAM_', '')}）。`
  if (code.startsWith('OPENAI_INCOMPLETE_')) return `OpenAI 輸出未完成（${code.replace('OPENAI_INCOMPLETE_', '')}）。`
  if (code === 'OPENAI_EMPTY_OUTPUT') return 'OpenAI API 沒有回傳可用文字。'
  if (code === 'GEMINI_EMPTY_OUTPUT') return 'Gemini API 沒有回傳可用文字。'
  return '漸進式辨識執行失敗。'
}

export async function POST(request: Request) {
  try {
    const body = await request.json(); const image = typeof body.image === 'string' ? body.image : ''; const originalImage = typeof body.original_image === 'string' ? body.original_image : ''
    const variants = Array.isArray(body.image_variants) ? body.image_variants.filter((v: unknown): v is string => typeof v === 'string').slice(0, MAX_VARIANTS) : []
    const provider: Provider = body.provider === 'openai' ? 'openai' : 'gemini'; const previousState = body.previous_state && typeof body.previous_state === 'object' ? body.previous_state as IdentificationState : null
    const round = Math.min(Math.max((previousState?.round ?? 0) + 1, 1), MAX_ROUNDS)
    for (const candidate of [image, originalImage, ...variants].filter(Boolean)) if (candidate.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(candidate)) return NextResponse.json({ error: '影像格式不正確或檔案過大。' }, { status: 400 })
    if (!image) return NextResponse.json({ error: '請提供本輪影像。' }, { status: 400 })
    const images = round > 1 && originalImage ? [originalImage, image, ...variants] : [image, ...variants]
    const prompt = promptFor(round, previousState, variants.length)
    const raw = provider === 'openai' ? await callOpenAI(images, prompt) : await callGemini(images, prompt); const state = parseState(raw, round)
    return NextResponse.json({ provider, state })
  } catch (error) { console.error('[HCSI progressive benchmark] error:', error); return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 }) }
}
