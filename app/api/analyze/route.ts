import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'

const MAX_IMAGE_LENGTH = 7_000_000

const REFERENCE_IMAGE_FILES = [
  'IMG_5213.jpeg',
  'left-hand-thread(1).jpg',
  'm8-vs-5-16-visual(1).jpg',
  'metric-coarse-fine(1).jpg',
  'pipe-thread-examples(1).jpg',
  'unified-coarse-fine(1).jpg',
]

async function loadReferenceParts() {
  const referenceRoot = path.join(
    process.cwd(),
    'data',
    'screw-reference'
  )

  const referenceText = await readFile(
    path.join(referenceRoot, 'screw-reference.md'),
    'utf8'
  )

  const parts: any[] = [
    {
      text: `
以下是 HCSI 的固定螺絲辨識 reference knowledge。

這些內容是辨識教材，不是本次待辨識物件。

請遵守 reference 中的 evidence gating：
- reference 中的規格數值是知識，不代表使用者照片已經觀察到該尺寸。
- 沒有可靠比例尺時，不可從 pixel size 推導實際 mm / inch。
- 可以在影像品質足夠時使用相對幾何，例如 thread spacing 相對於可見螺紋直徑。
- 可以使用實際可見的 morphological evidence，例如左右旋、頭型、驅動槽、標記與 pipe fitting morphology。
- 不可只因「看起來像 reference image」就宣稱精確規格。

以下是 reference text：

----- REFERENCE TEXT START -----

${referenceText}

----- REFERENCE TEXT END -----
`,
    },
    {
      text: `
接下來的圖片全部都是固定教材參考圖，不是本次使用者要辨識的物件。

請只把它們用來理解：
- thread family
- relative geometry
- coarse / fine thread
- left / right hand thread
- pipe-thread morphology
- 容易混淆的候選案例

禁止把 reference image 的像素大小、畫面大小或表觀尺寸直接套用到使用者照片。

reference text 中若存在無法直接開啟的 Markdown 圖片路徑，請忽略那些路徑，因為真正的 reference images 會在下面直接提供。
`,
    },
  ]

  for (const fileName of REFERENCE_IMAGE_FILES) {
    const filePath = path.join(referenceRoot, 'images', fileName)
    const imageBase64 = await readFile(filePath, 'base64')

    const mimeType = fileName.toLowerCase().endsWith('.jpeg')
      ? 'image/jpeg'
      : 'image/jpeg'

    parts.push({
      text: `Reference image: ${fileName}`,
    })

    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: imageBase64,
      },
    })
  }

  return parts
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const image =
      typeof body.image === 'string'
        ? body.image
        : ''

    if (
      !image ||
      image.length > MAX_IMAGE_LENGTH ||
      !/^[A-Za-z0-9+/=]+$/.test(image)
    ) {
      return NextResponse.json(
        {
          error: '影像格式不正確或檔案過大。',
        },
        {
          status: 400,
        }
      )
    }

    const apiKey = process.env.GEMINI_API_KEY

    if (!apiKey) {
      return NextResponse.json(
        {
          error: '分析服務尚未完成設定。',
        },
        {
          status: 503,
        }
      )
    }

    const referenceParts = await loadReferenceParts()

    const userImageNotice = {
      text: `
----- REFERENCE MATERIAL END -----

以下才是本次真正需要辨識的使用者照片。

請只根據這張使用者照片中實際可觀察到的證據，
結合前面的 reference knowledge 進行判斷。

不要把 reference 圖中的物件誤認為本次待辨識物件。
`,
    }

    const userImagePart = {
      inline_data: {
        mime_type: 'image/jpeg',
        data: image,
      },
    }

    const identificationPrompt = {
      text: `
請分析上面的「使用者照片」。

你是一位具備現場經驗的專業五金工程師。

使用繁體中文輸出純文字、結構化且保守的結果。

請依序包含：

零件種類：

預估尺寸規格：

螺紋系統／候選：

材質／外觀特徵：

主要判斷證據：

仍無法確認的部分：

判讀信心：

重要規則：

1. reference 中的數值只是工程知識，除非使用者照片存在可靠尺寸證據，否則不可說照片已證明該實際尺寸。

2. 沒有尺或卡尺時，不可從 pixel width 推導真正的 mm / inch。

3. 但若照片角度、解析度與螺紋清晰度足夠，可以使用相對牙密度、pitch-to-diameter relationship 等相對幾何證據。

4. 左右旋、頭型、驅動槽、標記、牙型與 pipe-fitting morphology 等，在實際可見時可以作為判斷證據。

5. 若 M8、5/16 或其他近似候選無法可靠區分，要保留候選與不確定性，不要硬選。

6. 不要因為某個規格比較常見就把它當作照片已經證明。

7. 不要捏造精確尺寸。

8. HCSI 採 one-shot identification。不要只因為沒有尺、沒有卡尺、無法得到精確 pitch 或存在多個候選，就要求使用者補拍。

9. 只有照片嚴重模糊、失焦、過暗、遮擋，或可見零件細節不足到無法做出有意義辨識時，才說影像無法辨識。
`,
    }

    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },

        body: JSON.stringify({
          contents: [
            {
              parts: [
                ...referenceParts,
                userImageNotice,
                userImagePart,
                identificationPrompt,
              ],
            },
          ],

          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 900,

            thinkingConfig: {
              thinkingLevel: 'minimal',
            },
          },
        }),
      }
    )

    if (!geminiResponse.ok) {
      const upstreamError =
        await geminiResponse.text()

      console.error(
        '[v0] Gemini request failed:',
        geminiResponse.status,
        upstreamError.slice(0, 1000)
      )

      return NextResponse.json(
        {
          error:
            'AI 分析服務暫時無法使用，請稍後再試。',
        },
        {
          status: 502,
        }
      )
    }

    const geminiData =
      await geminiResponse.json()

    const result =
      geminiData?.candidates?.[0]
        ?.content?.parts?.[0]?.text

    if (
      typeof result !== 'string' ||
      !result.trim()
    ) {
      return NextResponse.json(
        {
          error: 'AI 未能產生有效辨識結果。',
        },
        {
          status: 502,
        }
      )
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL

    const supabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(
        supabaseUrl,
        supabaseKey
      )

      const { error } = await supabase
        .from('hardware_logs')
        .insert({
          result_text:
            result.slice(0, 12000),
        })

      if (error) {
        console.error(
          '[v0] hardware log insert failed:',
          error.message
        )
      }
    }

    return NextResponse.json({
      result: result.slice(0, 12000),
    })
  } catch (error) {
    console.error(
      '[v0] analyze route failed:',
      error
    )

    return NextResponse.json(
      {
        error:
          '請求格式不正確，請重新上傳影像。',
      },
      {
        status: 400,
      }
    )
  }
}
