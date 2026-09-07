import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MAX_IMAGE_LENGTH = 7_000_000
const MAX_ROUNDS = 3

type Provider = 'gemini' | 'openai'
type FieldStatus = 'confirmed' | 'unknown'
type FieldValue = { value: string | null; status: FieldStatus }
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
}

const emptyField = (): FieldValue => ({ value: null, status: 'unknown' })
const EMPTY_STATE: IdentificationState = {
  round: 0, purchase_ready: false, purchase_spec: '',
  fields: { part_type: emptyField(), thread_system: emptyField(), nominal_size: emptyField(), length: emptyField(), pitch_tpi: emptyField(), head_type: emptyField(), drive: emptyField(), material_finish: emptyField() },
  missing_for_purchase: [], next_action: null, summary: '',
}

function promptFor(round: number, previousState: IdentificationState | null) {
  const previous = previousState
    ? `\n上一輪狀態：\n${JSON.stringify(previousState)}\n\n新照片是追加證據。把上一輪已確認資訊視為可修正的工作狀態；優先利用新照片解決 missing fields，若新證據更強可以修正舊判斷。`
    : '\n這是第一輪。從目前普通照片開始主動分析，不要等到有尺或第二張照片才進行深入辨識。'

  return `你是 HCSI 五金辨識引擎。目標是提供足以拿給一般五金行購買正確替代品的資訊，不是工程檢驗報告。${previous}

核心工作方式：每一輪都先主動榨取目前照片中最有辨識力的資訊，再決定是否真的需要下一張照片。不要把「照片不理想」直接等同於「無法判斷」。

規則：
1. 只有 confirmed / unknown 兩種狀態，禁止使用 inferred、possible、likely 等第三種狀態逃避決策。
2. confirmed 的產品意義是：依目前全部影像與你的五金知識，這是 HCSI 願意交給使用者作為目前最佳決策的結果；不要求實驗室級或量測儀器級證明。
3. 第一輪就必須進行 Active Visual Analysis：主動找出最有辨識力的區域，例如頭部、驅動槽、連續螺紋、端部、桿徑與長度比例、表面處理、可見文字或尺度參照，優先從這些區域提取資訊。
4. 對照片中的每個限制，不要先問「能不能精密量測」，而是先問「即使不完美，仍能提取哪些有用資訊？」。利用多個弱證據交叉驗證；如果多項證據共同支持同一答案且形成明顯最佳候選，就應做出 confirmed 決策。
5. 當影像已清楚支持零件類型、頭型、驅動方式、全牙/半牙、表面處理，或 thread_system 有明顯最佳答案時，必須 confirmed。不要僅因缺少尺寸參照就把這些欄位降成 unknown。
6. 不要為了填滿欄位硬猜精確尺寸。尺度不足時，nominal_size、length、pitch_tpi 可以 unknown，但仍要保留其他已確認資訊。
7. 如果照片中有尺、捲尺、固定尺寸參照物或其他可建立尺度的物件，主動利用它。尺與零件不完全平行、距離稍遠或有輕微透視，不代表資訊完全無效；先評估哪些局部比例與累積量仍可合理使用。
8. 判讀螺紋牙距時，若連續螺紋清楚，優先跨越盡可能多個完整牙距做累積判讀，而不是只嘗試量單一牙距。利用一段連續螺紋的總距離與牙數推回平均 pitch / TPI，再與其他尺寸證據一起比較。
9. 尺度觀察與標準規格身分要分開。先形成物理觀察，例如約略直徑、頭下長度、平均牙距或比例，再判斷標準規格；不要因為某個常見標準看起來順眼就直接吸附。
10. 當存在尺寸接近的公制與 Unified inch、粗牙與細牙或其他合理近似規格時，才啟動 candidate comparison。至少在內部比較目前最佳候選與最強競爭候選，不要把候選清單輸出給使用者。
11. candidate comparison 的目標不是把競爭候選「完全排除」，而是判斷哪一個候選受到目前全部視覺證據明顯更好的支持。比較直徑、長度、累積牙距、頭部比例、螺紋外觀及制式一致性等多項證據的整體吻合度。
12. 如果一個候選只是因為較常見而勝出，不足以 confirmed；但如果它在多項可見證據上的總體吻合明顯優於競爭候選，就應 confirmed，即使照片不是完美量測環境。
13. 只有在主動局部分析、尺度利用、多證據交叉驗證與候選比較後，兩個或多個購買規格仍然沒有明顯優劣，才把購買關鍵欄位保留 unknown 並要求下一步。
14. 如果真的需要下一張照片，next_action 只能有一個，而且必須直接針對最能區分目前候選的視覺證據。例如牙距是唯一關鍵差異，就要求「螺紋近拍 + 清楚刻度與螺紋同平面」，而不是泛泛要求再拍一張。
15. 不要描述自己執行了不存在的影像工具，例如實際 crop、透視校正、邊緣偵測或像素量測。可以仔細聚焦、重新檢查與比較原始高解析影像中的局部區域，但不要虛構工具操作。
16. purchase_ready 不是所有工程細節全確認，而是一般五金行已足以理解並提供主要規格正確的替代品。如果購買關鍵規格已有明顯最佳且整體一致的答案，就應 purchase_ready=true。
17. purchase_ready=true 時 next_action 必須 null，立即停止，不得再要求更精確或補拍。
18. purchase_ready=false 時，只列真正阻礙購買的 missing_for_purchase；DIN/ISO、鍍層厚度、精確材料牌號通常不是完成條件。
19. material_finish 只有真的影響替代品選購時才阻礙 purchase_ready。
20. purchase_spec 永遠寫目前已確認資訊能支持的最實用五金行說法；未知尺寸可以明寫「尺寸待確認」。
21. 每輪最多一個 next_action，選使用者成本最低且一次能消除最多缺口的操作。優先一般人容易取得的 mm 尺、捲尺、固定尺寸硬幣；不要預設有卡尺或牙規。
22. 不使用外部 reference material、候選清單或預先規格表；依模型自身視覺與五金知識。
23. 不輸出信心百分比。
24. 現在第 ${round} 輪，最多 ${MAX_ROUNDS} 輪。第 3 輪仍不足也停止追問，next_action=null，保留最佳已確認資訊與缺口。

只輸出合法 JSON object，不要 Markdown/code fence/額外文字：
{"round":${round},"purchase_ready":boolean,"purchase_spec":string,"fields":{"part_type":{"value":string|null,"status":"confirmed"|"unknown"},"thread_system":{"value":string|null,"status":"confirmed"|"unknown"},"nominal_size":{"value":string|null,"status":"confirmed"|"unknown"},"length":{"value":string|null,"status":"confirmed"|"unknown"},"pitch_tpi":{"value":string|null,"status":"confirmed"|"unknown"},"head_type":{"value":string|null,"status":"confirmed"|"unknown"},"drive":{"value":string|null,"status":"confirmed"|"unknown"},"material_finish":{"value":string|null,"status":"confirmed"|"unknown"}},"missing_for_purchase":string[],"next_action":{"type":string,"instruction":string}|null,"summary":string}`
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
