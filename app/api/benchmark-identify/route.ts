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
    ? `\n上一輪狀態：\n${JSON.stringify(previousState)}\n\n新照片是追加證據。優先解決 missing fields；若新證據明確推翻舊判斷，可以修正。`
    : '\n這是第一輪。只根據目前普通照片，最大化可合理得到的辨識資訊。'

  return `你是 HCSI 五金辨識引擎。目標是提供足以拿給一般五金行購買正確替代品的資訊，不是工程檢驗報告。${previous}

規則：
1. 只有 confirmed / unknown 兩種狀態，禁止使用 inferred、possible、likely 等第三種狀態逃避決策。
2. confirmed 的產品意義是：依目前影像與你的五金知識，你願意把這個欄位交給使用者作為目前決策資訊；它不要求實驗室級 100% 證明。
3. 當影像已清楚支持某制式、零件類型、頭型或驅動方式時，必須 confirmed。不要僅因缺少尺寸參照就把清楚可辨的欄位降成 unknown。
4. 真正沒有足夠依據才用 unknown。不要為了填滿欄位硬猜尺寸。
5. purchase_ready 不是所有工程細節全確認，而是一般五金行已足以理解並提供主要規格正確的替代品。
6. purchase_ready=true 時 next_action 必須 null，立即停止，不得再要求更精確或補拍。
7. purchase_ready=false 時，只列真正阻礙購買的 missing_for_purchase；DIN/ISO、鍍層厚度、精確材料牌號通常不是完成條件。
8. 每輪最多一個 next_action，選使用者成本最低且一次能消除最多缺口的操作。優先一般人容易取得的 mm 尺、捲尺、固定尺寸硬幣；不要預設有卡尺或牙規。
9. 若要求參照照片，要求零件與參照物盡量同平面且刻度清楚。
10. 不使用外部 reference material、候選清單或預先規格表；依模型自身視覺與五金知識。
11. 不輸出信心百分比。
12. 現在第 ${round} 輪，最多 ${MAX_ROUNDS} 輪。第 3 輪仍不足也停止追問，next_action=null，保留最佳已確認資訊與缺口。
13. material_finish 只有真的影響替代品選購時才阻礙 purchase_ready。
14. purchase_spec 永遠寫目前已確認資訊能支持的最實用五金行說法；未知尺寸可以明寫「尺寸待確認」。
15. 尺度觀察與標準規格身分必須分開思考。影像顯示約 8 mm，不等於零件必然是 M8；英制尺寸換算後也可能落在相同物理尺寸附近。不要因為某個常見標準規格看起來合理，就直接吸附到該規格。
16. 在確認 nominal_size、thread_system、pitch_tpi、length 等購買關鍵規格前，先在內部形成至少一個最強競爭候選（若存在合理競爭候選）。比較目前影像對兩者真正具有區別力的證據，而不是只比較哪個規格較常見。不要把候選清單輸出給使用者。
17. 必須特別檢查公制與 Unified inch 是否存在物理尺寸近似的競爭解釋。直徑或長度接近不能單獨證明制式；需要利用牙距/TPI、刻度、比例及其他可見特徵做整體一致性判斷。
18. purchase_ready=true 前必須通過 candidate-discrimination gate：問自己「目前證據是否足以排除會導致不同購買規格的最強合理競爭候選？」若不能排除，就不得 purchase_ready=true，也不得把僅靠常見度勝出的規格 confirmed。
19. 若最強候選之間的關鍵差異是目前照片看不清的牙距/TPI、直徑或長度，將該欄位保留 unknown，並把唯一 next_action 指向最能區分候選的追加證據。例如需要區分相近牙距時，優先要求螺紋近拍並讓清楚毫米/英吋刻度與螺紋同平面，而不是重複要求一般全景尺照。
20. candidate-discrimination gate 不是要求無限追求確定性。如果目前影像已提供足以合理排除主要競爭規格的辨識證據，就應做出 confirmed 決策並在購買資訊完整時 STOP；不得僅因理論上仍存在極低可能性而繼續追問。

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
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: 'gpt-5.6-sol', reasoning: { effort: 'medium' }, max_output_tokens: 1600, input: [{ role: 'user', content: [...images.map((image) => ({ type: 'input_image', image_url: `data:image/jpeg;base64,${image}`, detail: 'high' })), { type: 'input_text', text: prompt }] }] }) })
  if (!response.ok) throw new Error(`OPENAI_UPSTREAM_${response.status}`)
  const data = await response.json(); const text = data?.output?.flatMap((item: any) => item?.content ?? [])?.find((item: any) => item?.type === 'output_text')?.text
  if (typeof text !== 'string' || !text.trim()) throw new Error('OPENAI_EMPTY_OUTPUT'); return text
}

async function callGemini(images: string[], prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY; if (!apiKey) throw new Error('GEMINI_API_KEY_MISSING')
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify({ contents: [{ parts: [...images.map((image) => ({ inline_data: { mime_type: 'image/jpeg', data: image } })), { text: prompt }] }], generationConfig: { maxOutputTokens: 1600, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'medium' } } }) })
  if (!response.ok) throw new Error(`GEMINI_UPSTREAM_${response.status}`)
  const data = await response.json(); const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text)?.filter(Boolean)?.join('\n')
  if (typeof text !== 'string' || !text.trim()) throw new Error('GEMINI_EMPTY_OUTPUT'); return text
}

function safeErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : 'UNKNOWN'
  if (code === 'OPENAI_API_KEY_MISSING') return '此 Preview 環境沒有 OPENAI_API_KEY。請在 Vercel 將 OPENAI_API_KEY 套用到 Preview 環境後重新部署。'
  if (code === 'GEMINI_API_KEY_MISSING') return '此 Preview 環境沒有 GEMINI_API_KEY。請在 Vercel 將 GEMINI_API_KEY 套用到 Preview 環境後重新部署。'
  if (code === 'MODEL_JSON_PARSE_FAILED') return 'AI 已回傳內容，但格式解析失敗。請再試一次。'
  if (code.startsWith('OPENAI_UPSTREAM_')) return `OpenAI API 呼叫失敗（HTTP ${code.replace('OPENAI_UPSTREAM_', '')}）。`
  if (code.startsWith('GEMINI_UPSTREAM_')) return `Gemini API 呼叫失敗（HTTP ${code.replace('GEMINI_UPSTREAM_', '')}）。`
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
