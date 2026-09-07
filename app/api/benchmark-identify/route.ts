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
  scale_reference_present: false,
  relative_geometry_used: false,
  visible_thread_span: null,
  estimated_thread_count: null,
  diameter_to_pitch_ratio: null,
  length_to_diameter_ratio: null,
  scale_observations: [],
  strongest_system_evidence: null,
}
const EMPTY_STATE: IdentificationState = {
  round: 0, purchase_ready: false, purchase_spec: '',
  fields: { part_type: emptyField(), thread_system: emptyField(), nominal_size: emptyField(), length: emptyField(), pitch_tpi: emptyField(), head_type: emptyField(), drive: emptyField(), material_finish: emptyField() },
  missing_for_purchase: [], next_action: null, summary: '', diagnostic: EMPTY_DIAGNOSTIC,
}

function promptFor(round: number, previousState: IdentificationState | null) {
  const previous = previousState
    ? `\n上一輪狀態：\n${JSON.stringify(previousState)}\n\n新照片是追加證據。上一輪結果是可修正的工作狀態；這一輪重新套用相同的通用量測方法，優先補足 missing fields。`
    : '\n這是第一輪。直接從目前照片開始套用相同的通用量測方法；不要等到第二張照片才做幾何分析。'

  return `你是 HCSI 五金辨識引擎。目標是提供足以拿給一般五金行購買正確替代品的資訊，不是工程檢驗報告。${previous}

每一輪都使用同一個通用方法：盡量先量影像中「跨度最大、最容易辨認」的東西，再由大尺度除回小尺度。不要優先直接目測很小的單一牙距。

通用量測流程：
A. 先找本輪最長且最清楚、最適合當基準的幾何跨度，例如頭下承面到末端、可清楚追蹤的一整段連續螺紋、或參照物上跨越多格的刻度。若有尺或已知尺寸參照物，先用較長的刻度跨度建立尺度，不要只盯單一小刻度。
B. 對螺紋，優先找最長的清楚連續區段並計算完整牙距數。注意牙峰數與牙距區間數可能差 1；要以實際完整 pitch intervals 為準。若可建立絕對尺度，用「連續螺紋總跨度 ÷ 完整牙距區間數」反推平均 pitch / TPI。
C. 沒有絕對尺度時，也不要停止。利用尺度不變的比例，例如「螺紋外徑 ÷ 平均牙距」、「頭下長度 ÷ 螺紋外徑」、「頭寬 ÷ 螺紋外徑」，以及可見牙數，判斷哪些標準規格較吻合。
D. 有尺度時，除了總跨度 ÷ 牙數得到 pitch，也可用「已估出的較長尺寸 ÷ 影像中的長徑比」反推直徑。優先從較容易看準的大跨度推回較小尺寸，而不是直接猜小尺寸。
E. 完成上述幾何觀察後，才把約略 length、diameter、pitch/TPI、比例與牙數一起對照最接近的標準規格。若一個規格明顯比其他合理近似規格更符合全部幾何觀察，就做出 confirmed 決策；若仍真正接近才保留 unknown。

規則：
1. 只有 confirmed / unknown 兩種狀態。confirmed 是 HCSI 根據目前全部影像做出的最佳購買決策，不要求實驗室級證明；unknown 只用在目前證據真的無法合理區分時。
2. 零件類型、頭型、驅動方式、全牙/半牙、表面處理等清楚外觀可直接 confirmed，但精確尺寸與 thread_system 優先依尺度、螺紋和幾何比例判讀。
3. 局部聚焦與多證據交叉驗證集中用在尺度、幾何、螺紋與比例。不要把模糊文字、刻印、頭面痕跡或疑似強度標記放大解讀成 thread_system 的主要證據；本測試的公英制判斷以幾何為主。
4. 尺的單位不代表零件的制式。英吋尺旁的零件仍可能是公制，毫米尺旁的零件也可能是英制；尺只提供尺度。
5. 照片不完美時，不要因為有角度差、輕微透視或參照物不完全平行就立刻放棄。先使用仍可辨識的長跨度、累積牙距與比例；但不要假裝進行不存在的透視校正、像素量測或其他影像工具操作。
6. 近似量測可以用合理範圍或約略值，不要輸出影像不支持的虛假高精度。diagnostic 要誠實記錄本輪實際使用的牙數、比例與尺度觀察。
7. 不要先猜某個標準規格，再用該規格反向修正你看到的尺寸。幾何觀察在前，標準規格命名在後。
8. 不要因為某規格比較常見就選它；但也不要要求把其他理論可能性完全排除。若目前幾何整體已有明顯最佳答案，就應做決定。
9. 不要為了填滿欄位硬猜。即使 nominal_size、length 或 pitch_tpi 暫時 unknown，也要保留其他已確認資訊。
10. purchase_ready 的標準是一般五金行已足以提供主要規格正確的替代品，不要求 DIN/ISO、鍍層厚度或精確材料牌號等非必要資訊。
11. purchase_ready=true 時 next_action 必須 null，立即停止。
12. purchase_ready=false 時，只列真正阻礙購買的 missing_for_purchase，並且每輪最多一個 next_action。下一步要直接取得最能補足目前尺度/幾何缺口的照片或參照，優先一般人容易取得的尺、捲尺或固定尺寸物件。
13. purchase_spec 永遠寫目前已確認資訊能支持的最實用五金行說法；未知尺寸可以明寫「尺寸待確認」。
14. 不輸出信心百分比。
15. diagnostic 是暫時測試資料，不是終端購買結論。沒有可靠觀察就填 null/false/[]，不要補造數字。
16. 現在第 ${round} 輪，最多 ${MAX_ROUNDS} 輪。第 3 輪仍不足也停止追問，next_action=null，保留最佳已確認資訊與缺口。

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
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: 'gpt-5.6-sol', reasoning: { effort: 'medium' }, max_output_tokens: 4000, input: [{ role: 'user', content: [...images.map((image) => ({ type: 'input_image', image_url: `data:image/jpeg;base64,${image}`, detail: 'high' })), { type: 'input_text', text: prompt }] }] }) })
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
  if (!response.ok) {
    if (response.status === 503) throw new Error('GEMINI_UNAVAILABLE_503')
    throw new Error(`GEMINI_UPSTREAM_${response.status}`)
  }
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