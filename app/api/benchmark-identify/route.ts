import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
const MAX_IMAGE_LENGTH = 7_000_000

type Provider = 'gemini' | 'openai' | 'xai'

type NakedResult = {
  thread_system: string
  best_spec: string
  closest_competitor: string
  key_difference: string
  size_estimate: string
  conclusion: string
  diagnostic: {
    visual_observations: string[]
    evidence_for_system: string[]
    evidence_for_size: string[]
    evidence_against_best_spec: string[]
    decisive_evidence: string[]
    possible_failure_modes: string[]
  }
}

const PROMPT = `
請分析這張使用者照片。

你是一位具備螺絲、螺紋與五金現場辨識經驗的專業人員。
這是一個「裸測」：
- 不使用任何外部 reference material。
- 不提供候選規格表。
- 不提供 CV、像素量測、尺度前處理或其他輔助數據。
- 只依靠你原本的視覺辨識能力與螺紋知識。

你的任務不是列出很多可能性，而是選出你認為最可能的一個答案。
照片沒有尺時，也不要因此拒絕估計尺寸；可以目測，但必須標示為目測。
如果照片真的模糊到無法做有意義比較，才可以回答無法辨識。

請依序完成：
1. 判斷最可能的螺紋制式。
2. 判斷最可能的完整規格。
3. 找出一個最容易混淆的競爭規格。
4. 說出兩者最有辨識力的差異。
5. 回看照片，說明哪些可見證據支持你的選擇。
6. 另外列出哪些可見或不可見因素，可能讓你的答案出錯。

重要：
- 不要輸出隱藏推理過程或逐步內在思考。
- diagnostic 只輸出可檢驗的「觀察、判斷依據、反證與可能失敗原因」。
- 不要用信心百分比。
- 不要把沒有直接看到的尺寸寫成量測值；只能寫目測估計。

只輸出合法 JSON，格式固定為：
{
  "thread_system": "最可能的制式／螺紋系統",
  "best_spec": "最可能的完整規格名稱",
  "closest_competitor": "最接近的競爭規格",
  "key_difference": "兩者最關鍵的辨識差異",
  "size_estimate": "直徑、長度、牙距／TPI 等目測估計",
  "conclusion": "一到兩句明確結論",
  "diagnostic": {
    "visual_observations": ["只寫照片直接可見的事實"],
    "evidence_for_system": ["哪些可見證據讓你偏向此制式"],
    "evidence_for_size": ["哪些比例或牙密度讓你偏向此尺寸"],
    "evidence_against_best_spec": ["照片中哪些地方其實不完全符合最佳答案"],
    "decisive_evidence": ["最後真正拉開最佳答案與競爭規格的可見證據"],
    "possible_failure_modes": ["哪些視覺錯覺、尺度缺失、透視、反光或其他因素可能導致誤判"]
  }
}
`

function parseJson(text: string): NakedResult {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  try {
    return JSON.parse(first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned)
  } catch {
    throw new Error('MODEL_JSON_PARSE_FAILED')
  }
}

function extractResponsesText(data: any) {
  return data?.output?.flatMap((x: any) => x?.content ?? [])?.find((x: any) => x?.type === 'output_text')?.text
}

async function callOpenAI(image: string) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING')
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-5.6-sol',
      reasoning: { effort: 'medium' },
      max_output_tokens: 3000,
      input: [{ role: 'user', content: [
        { type: 'input_image', image_url: `data:image/jpeg;base64,${image}`, detail: 'high' },
        { type: 'input_text', text: PROMPT },
      ] }],
    }),
  })
  if (!response.ok) throw new Error(`OPENAI_UPSTREAM_${response.status}`)
  const text = extractResponsesText(await response.json())
  if (typeof text !== 'string' || !text.trim()) throw new Error('OPENAI_EMPTY_OUTPUT')
  return text
}

async function callXAI(image: string) {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) throw new Error('XAI_API_KEY_MISSING')
  const response = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'grok-4.6',
      reasoning: { effort: 'medium' },
      max_output_tokens: 3000,
      input: [{ role: 'user', content: [
        { type: 'input_image', image_url: `data:image/jpeg;base64,${image}`, detail: 'high' },
        { type: 'input_text', text: PROMPT },
      ] }],
    }),
  })
  if (!response.ok) throw new Error(`XAI_UPSTREAM_${response.status}`)
  const text = extractResponsesText(await response.json())
  if (typeof text !== 'string' || !text.trim()) throw new Error('XAI_EMPTY_OUTPUT')
  return text
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function callGemini(image: string) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY_MISSING')
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent'
  const requestBody = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: image } }, { text: PROMPT }] }],
    generationConfig: { maxOutputTokens: 1800, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'medium' } },
  })
  let response: Response | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: requestBody })
    if (response.status !== 503) break
    if (attempt === 0) await wait(900)
  }
  if (!response || !response.ok) throw new Error(response?.status === 503 ? 'GEMINI_UNAVAILABLE_503' : `GEMINI_UPSTREAM_${response?.status ?? 'UNKNOWN'}`)
  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text)?.filter(Boolean)?.join('\n')
  if (typeof text !== 'string' || !text.trim()) throw new Error('GEMINI_EMPTY_OUTPUT')
  return text
}

function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : 'UNKNOWN'
  if (code === 'OPENAI_API_KEY_MISSING') return '此 Preview 環境沒有 OPENAI_API_KEY。'
  if (code === 'GEMINI_API_KEY_MISSING') return '此 Preview 環境沒有 GEMINI_API_KEY。'
  if (code === 'XAI_API_KEY_MISSING') return '此 Preview 環境沒有 XAI_API_KEY。'
  if (code === 'MODEL_JSON_PARSE_FAILED') return 'AI 已回傳內容，但 JSON 格式解析失敗。'
  if (code.startsWith('OPENAI_UPSTREAM_')) return `OpenAI API 呼叫失敗（HTTP ${code.replace('OPENAI_UPSTREAM_', '')}）。`
  if (code.startsWith('GEMINI_UPSTREAM_')) return `Gemini API 呼叫失敗（HTTP ${code.replace('GEMINI_UPSTREAM_', '')}）。`
  if (code.startsWith('XAI_UPSTREAM_')) return `xAI API 呼叫失敗（HTTP ${code.replace('XAI_UPSTREAM_', '')}）。`
  if (code === 'GEMINI_UNAVAILABLE_503') return 'Gemini API 暫時無法服務（HTTP 503）。'
  if (code === 'XAI_EMPTY_OUTPUT') return 'xAI 已回傳，但沒有可用的文字輸出。'
  return '裸測辨識執行失敗。'
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const image = typeof body.image === 'string' ? body.image : ''
    const provider: Provider = body.provider === 'openai' ? 'openai' : body.provider === 'xai' ? 'xai' : 'gemini'
    if (!image || image.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(image)) {
      return NextResponse.json({ error: '影像格式不正確或檔案過大。' }, { status: 400 })
    }
    const raw = provider === 'openai' ? await callOpenAI(image) : provider === 'xai' ? await callXAI(image) : await callGemini(image)
    const result = parseJson(raw)
    return NextResponse.json({ provider, result, raw_output: raw })
  } catch (error) {
    console.error('[HCSI naked diagnostic benchmark] error:', error)
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 })
  }
}
