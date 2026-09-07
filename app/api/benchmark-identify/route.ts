import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MAX_IMAGE_LENGTH = 7_000_000

type Provider = 'gemini' | 'openai'

function benchmarkPrompt(diameterMm: number, totalLengthMm: number) {
  return `
請辨識照片中的五金零件。

這是一個隔離的 benchmark。不要使用外部 reference material、候選清單或預先提供的規格表；請依靠你本身已有的視覺辨識能力與五金／螺紋知識。

使用者已經實際量測兩個數值：
- 螺紋外徑：${diameterMm} mm
- 總長：${totalLengthMm} mm

這兩個數值是實際量測輸入，不是目測估計。請優先相信它們，不要從照片重新估計外徑或總長，也不要擅自修改量測值。

你的目標不是列出大量可能性，而是綜合「照片 + 實測外徑 + 實測總長」，輸出足以讓使用者直接向一般五金行購買同規格替代品的資訊。

請自行判斷可能的制式或螺紋系統，不要假設只有 Metric 或 Unified；若其他標準更符合，也應考慮。

請盡可能判斷：
- 制式／螺紋系統
- 公稱尺寸
- 長度的標準表示
- 牙距或 TPI
- 頭型
- 驅動方式
- 螺絲／牙型用途
- 圖片能合理支持的材質或表面處理

如果某個次要欄位僅靠這些資訊無法可靠區分，請明確標示「無法由目前資訊可靠確認」，但不要要求使用者再量任何尺寸、補拍照片或提供更多資訊。

請使用繁體中文，固定輸出：

五金行購買規格：
[一行最實用的購買名稱]

規格拆解：
制式／螺紋系統：
公稱尺寸：
長度：
牙距／TPI：
頭型：
驅動方式：
類型／用途：
材質／表面處理：

無法可靠確認：
[沒有則寫「無」]

判斷依據：
[簡短說明照片特徵與兩個實測值如何支持上述答案]
`
}

async function callOpenAI(image: string, prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.6-sol',
      reasoning: { effort: 'medium' },
      max_output_tokens: 2000,
      input: [{
        role: 'user',
        content: [
          { type: 'input_image', image_url: `data:image/jpeg;base64,${image}`, detail: 'high' },
          { type: 'input_text', text: prompt },
        ],
      }],
    }),
  })

  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 500)}`)
  const data = await response.json()
  const text = data?.output
    ?.flatMap((item: any) => item?.content ?? [])
    ?.find((item: any) => item?.type === 'output_text')?.text
  if (typeof text !== 'string' || !text.trim()) throw new Error('OpenAI returned no text')
  return text.trim()
}

async function callGemini(image: string, prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: 'image/jpeg', data: image } },
          { text: prompt },
        ] }],
        generationConfig: {
          maxOutputTokens: 2000,
          thinkingConfig: { thinkingLevel: 'medium' },
        },
      }),
    }
  )

  if (!response.ok) throw new Error(`Gemini ${response.status}: ${(await response.text()).slice(0, 500)}`)
  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part: any) => part?.text)
    ?.filter(Boolean)
    ?.join('\n')
  if (typeof text !== 'string' || !text.trim()) throw new Error('Gemini returned no text')
  return text.trim()
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const image = typeof body.image === 'string' ? body.image : ''
    const diameterMm = Number(body.diameter_mm)
    const totalLengthMm = Number(body.total_length_mm)
    const provider: Provider = body.provider === 'openai' ? 'openai' : 'gemini'
    const runs = Math.min(Math.max(Number(body.runs) || 1, 1), 3)

    if (!image || image.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(image)) {
      return NextResponse.json({ error: '影像格式不正確或檔案過大。' }, { status: 400 })
    }
    if (!Number.isFinite(diameterMm) || diameterMm <= 0 || diameterMm > 200) {
      return NextResponse.json({ error: 'diameter_mm 必須是有效的正數毫米值。' }, { status: 400 })
    }
    if (!Number.isFinite(totalLengthMm) || totalLengthMm <= 0 || totalLengthMm > 2000) {
      return NextResponse.json({ error: 'total_length_mm 必須是有效的正數毫米值。' }, { status: 400 })
    }

    const prompt = benchmarkPrompt(diameterMm, totalLengthMm)
    const results: string[] = []
    for (let i = 0; i < runs; i += 1) {
      results.push(provider === 'openai'
        ? await callOpenAI(image, prompt)
        : await callGemini(image, prompt))
    }

    return NextResponse.json({
      benchmark: 'image+diameter+total_length',
      provider,
      inputs: { diameter_mm: diameterMm, total_length_mm: totalLengthMm },
      runs: results.map((result, index) => ({ run: index + 1, result })),
    })
  } catch (error) {
    console.error('[HCSI benchmark-identify] error:', error)
    return NextResponse.json({ error: 'Benchmark 執行失敗。' }, { status: 500 })
  }
}
