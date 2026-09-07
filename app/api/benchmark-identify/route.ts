import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MAX_IMAGE_LENGTH = 7_000_000
const MAX_ROUNDS = 3

type Provider = 'gemini' | 'openai'
type FieldStatus = 'confirmed' | 'unknown'
type FieldValue = { value: string | null; status: FieldStatus }
type Diagnostic = {
  scale_reference_present: boolean
  relative_geometry_used: boolean
  visible_thread_span: string | null
  estimated_thread_count: number | null
  diameter_to_pitch_ratio: string | null
  length_to_diameter_ratio: string | null
  scale_observations: string[]
  strongest_system_evidence: string | null
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

const emptyField = (): FieldValue => ({ value: null, status: 'unknown' })
const EMPTY_DIAGNOSTIC: Diagnostic = {
  scale_reference_present: false, relative_geometry_used: false, visible_thread_span: null,
  estimated_thread_count: null, diameter_to_pitch_ratio: null, length_to_diameter_ratio: null,
  scale_observations: [], strongest_system_evidence: null,
}
const EMPTY_STATE: IdentificationState = {
  round: 0, purchase_ready: false, purchase_spec: '',
  fields: { part_type: emptyField(), thread_system: emptyField(), nominal_size: emptyField(), length: emptyField(), pitch_tpi: emptyField(), head_type: emptyField(), drive: emptyField(), material_finish: emptyField() },
  missing_for_purchase: [], next_action: null, summary: '', diagnostic: EMPTY_DIAGNOSTIC,
}

function promptFor(round: number, previousState: IdentificationState | null) {
  const previous = previousState
    ? `\n上一輪狀態：\n${JSON.stringify(previousState)}\n\n新照片是追加證據。上一輪結果是可修正的工作狀態；這一輪重新套用相同方法。`
    : '\n這是第一輪。直接從目前照片開始套用相同方法。若使用者提供的是放大的螺紋照片，充分利用放大後清楚的牙紋與桿徑比例。'

  return `你是 HCSI 五金辨識引擎。目標是提供足以拿給一般五金行購買正確替代品的資訊。${previous}

每一輪都使用同一個簡單幾何方法：先利用跨度大、容易看清楚的結構，再由比例推回較小尺寸。這一版特別測試一個尺度不變的判讀：一個螺紋外徑大約等於幾個平均 pitch。

通用流程：
A. 找清楚的連續螺紋區段。不要只目測單一牙距；利用多個連續牙距形成平均 pitch 的視覺尺度。
B. 直接比較「螺紋外徑」與「平均 pitch」在同一張影像中的相對跨度，估計 diameter / pitch ratio，也就是一個螺紋外徑大約能容納幾個平均牙距。這個比例不需要知道毫米或英吋，也不需要尺。
C. 若照片是局部放大圖，優先利用放大後清楚的牙峰、牙谷與螺紋上下外徑邊界來估這個比例。可用合理範圍，例如約 7–8 個 pitch；不要假裝有不存在的像素量測工具，也不要輸出影像不支持的小數精度。
D. 若照片同時有尺或其他尺度，再用長跨度建立 absolute scale，並用「長跨度 ÷ 完整 pitch intervals」估平均 pitch/TPI。尺的單位只提供尺度，不代表零件制式。
E. 將 diameter/pitch ratio、累積牙數、長度/直徑比例與可用的絕對尺度一起對照標準規格。幾何觀察在前，規格命名在後；不要先猜規格再反向修改觀察。

規則：
1. 只有 confirmed / unknown。confirmed 是依目前影像得到的最佳購買決策；unknown 只用在真的無法合理區分時。
2. 精確尺寸與 thread_system 優先依尺度、螺紋與幾何比例判讀。零件類型、頭型、驅動、全牙/半牙、表面處理可依清楚外觀 confirmed。
3. 本輪的局部聚焦與交叉驗證集中在螺紋幾何。不要用模糊文字、頭面刻印、疑似強度標記作為 thread_system 的主要證據。
4. diameter_to_pitch_ratio 必須是你從目前影像本身觀察到的比例，不得先選 M6、1/4、5/16 等規格後，再填入該規格理論上的 ratio。
5. estimated_thread_count 同樣只記錄影像實際可辨識的完整 pitch intervals；牙峰數與 pitch intervals 可能差 1。
6. 如果能清楚估計 diameter/pitch ratio，應讓它實際參與 Metric / Unified、粗牙 / 細牙候選判斷；不要只在 diagnostic 顯示後忽略。
7. 照片不完美時先利用仍可辨認的比例，不因輕微角度或透視直接放棄；但不要宣稱執行 crop、透視校正、edge detection 或 pixel measurement 等不存在的工具。
8. 近似觀察可用範圍，不要製造虛假高精度。若 ratio 本身看不清楚就填 null，不要用標準規格反推一個漂亮數字。
9. 不因某規格比較常見就選它；若目前幾何整體已有明顯最佳答案就做決定，不要求完全排除所有理論可能性。
10. purchase_ready 是一般五金行已足以提供主要規格正確的替代品；purchase_ready=true 時 next_action=null 並停止。
11. purchase_ready=false 時只列真正阻礙購買的 missing_for_purchase，每輪最多一個 next_action，直接取得最能補足尺度或螺紋幾何的照片。
12. purchase_spec 寫目前已確認資訊能支持的實用五金行說法；未知尺寸可明寫尺寸待確認。
13. 不輸出信心百分比。
14. diagnostic 是測試資料。誠實記錄本輪實際看到的 ratio、牙數與尺度觀察；沒有可靠觀察就填 null/false/[]。
15. 現在第 ${round} 輪，最多 ${MAX_ROUNDS} 輪。第 3 輪仍不足也停止追問。

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
  for (const key of Object.keys(normalizedFields) as Array<keyof typeof normalizedFields>) {
    const incoming = state.fields?.[key]
    normalizedFields[key] = incoming?.value ? { value: String(incoming.value), status: incoming.status === 'unknown' ? 'unknown' : 'confirmed' } : emptyField()
  }
  state.fields = normalizedFields
  if (!Array.isArray(state.missing_for_purchase)) state.missing_for_purchase = []
  const incomingDiagnostic = state.diagnostic && typeof state.diagnostic === 'object' ? state.diagnostic : EMPTY_DIAGNOSTIC
  state.diagnostic = {
    scale_reference_present: incomingDiagnostic.scale_reference_present === true,
    relative_geometry_used: incomingDiagnostic.relative_geometry_used === true,
    visible_thread_span: incomingDiagnostic.visible_thread_span ? String(incomingDiagnostic.visible_thread_span) : null,
    estimated_thread_count: typeof incomingDiagnostic.estimated_thread_count === 'number' && Number.isFinite(incomingDiagnostic.estimated_thread_count) ? incomingDiagnostic.estimated_thread_count : null,
    diameter_to_pitch_ratio: incomingDiagnostic.diameter_to_pitch_ratio ? String(incomingDiagnostic.diameter_to_pitch_ratio) : null,
    length_to_diameter_ratio: incomingDiagnostic.length_to_diameter_ratio ? String(incomingDiagnostic.length_to_diameter_ratio) : null,
    scale_observations: Array.isArray(incomingDiagnostic.scale_observations) ? incomingDiagnostic.scale_observations.map(String).slice(0, 8) : [],
    strongest_system_evidence: incomingDiagnostic.strongest_system_evidence ? String(incomingDiagnostic.strongest_system_evidence) : null,
  }
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
  if (typeof text !== 'string' || !text.trim()) {
    if (data?.status === 'incomplete') throw new Error(`OPENAI_INCOMPLETE_${data?.incomplete_details?.reason ?? 'UNKNOWN'}`)
    throw new Error('OPENAI_EMPTY_OUTPUT')
  }
  return text
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function callGemini(images: string[], prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY; if (!apiKey) throw new Error('GEMINI_API_KEY_MISSING')
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent'
  const requestBody = JSON.stringify({ contents: [{ parts: [...images.map((image) => ({ inline_data: { mime_type: 'image/jpeg', data: image } })), { text: prompt }] }], generationConfig: { maxOutputTokens: 3000, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'medium' } } })
  let response: Response | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: requestBody })
    if (response.status !== 503) break
    if (attempt === 0) await wait(900)
  }
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
    const provider: Provider = body.provider === 'openai' ? 'openai' : 'gemini'; const previousState = body.previous_state && typeof body.previous_state === 'object' ? body.previous_state as IdentificationState : null
    const round = Math.min(Math.max((previousState?.round ?? 0) + 1, 1), MAX_ROUNDS)
    for (const candidate of [image, originalImage].filter(Boolean)) if (candidate.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(candidate)) return NextResponse.json({ error: '影像格式不正確或檔案過大。' }, { status: 400 })
    if (!image) return NextResponse.json({ error: '請提供本輪影像。' }, { status: 400 })
    const images = round > 1 && originalImage ? [originalImage, image] : [image]; const prompt = promptFor(round, previousState)
    const raw = provider === 'openai' ? await callOpenAI(images, prompt) : await callGemini(images, prompt); const state = parseState(raw, round)
    return NextResponse.json({ provider, state })
  } catch (error) { console.error('[HCSI progressive benchmark] error:', error); return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 }) }
}