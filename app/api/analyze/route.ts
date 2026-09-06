import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MAX_IMAGE_LENGTH = 7_000_000

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

    const userImagePart = {
      inline_data: {
        mime_type: 'image/jpeg',
        data: image,
      },
    }

    const identificationPrompt = {
      text: `
請分析上面的使用者照片。

你是一位具備螺絲、螺紋與五金現場辨識經驗的專業人員。

這是一個純辨識測試。

不要使用外部 reference material。
請直接依靠你本身已有的視覺辨識能力與螺紋知識判斷。

你的任務不是列出大量可能性，
而是經過比較後，選出你認為最可能的一個答案。

請在作答前自行完成以下判斷流程：

1. 先判斷這個螺紋最可能屬於哪一種制式或螺紋系統。
   常見可能包括公制 Metric、美制 Unified、英制 Whitworth，
   也可能是其他制式，不限於上述三種。

2. 根據照片中的外觀、螺紋比例、牙紋密度、牙型、頭型、
   驅動方式、螺桿比例與其他可見特徵，
   推測最可能的具體規格。

3. 找出一個最容易與這個規格混淆的競爭規格。

4. 問自己：
   「這兩個規格最重要、最有辨識力的差異是什麼？」

5. 回頭重新檢查照片中是否看得到這個差異。

6. 當兩個候選的絕對直徑非常接近、照片又沒有比例尺時，
   不要因此直接判定無法區分。

   檢查是否存在尺度無關的相對幾何特徵。
   例如，可以比較照片中的「牙距相對於螺紋外徑的比例」，
   或跨越多個完整牙距進行比較，
   以降低單一牙距的視覺誤差。

   如果這些相對幾何足以偏向其中一個候選，
   就選擇較符合者；
   只有影像本身無法可靠呈現這些差異時，
   才保留無法區分。

7. 根據上述比較重新評估兩個候選，
   最後選出你認為更可能的一個。

8. 不要因為照片沒有尺或卡尺，就拒絕估計尺寸。
   可以目測直徑、長度、牙距或 TPI。
   但如果不是實際量測值，要清楚標示為「目測估計」。

9. 不要只輸出「A 或 B」而停止判斷。
   即使不能 100% 確定，也必須選出較可能的一個，
   並說明最關鍵的判斷差異。

10. 不需要輸出信心百分比。

11. 如果照片真的嚴重模糊、失焦、遮擋，
    以至於連有意義的視覺比較都做不到，
    才可以回答無法辨識。

請使用繁體中文，固定依照以下格式輸出：

制式判斷：
[最可能的制式／螺紋系統]

這個螺絲應該會是：
[最可能的完整規格名稱]

最容易混淆的規格：
[一個最接近的競爭規格]

最關鍵的判斷差異：
[說明兩者最有辨識力的差異，以及照片中的特徵更偏向哪一個]

尺寸目測：
[直徑、長度、牙距／TPI 等可合理推估的內容；非量測值必須標示為目測]

結論：
[用一到兩句話明確說出最後判斷，例如：
「這個螺絲應該會是 XXX，主要因為 XXX。」]
`,
    }

    const geminiResponse = await fetch(
     'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent',
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
                userImagePart,
                identificationPrompt,
              ],
            },
          ],

          generationConfig: {
            maxOutputTokens: 900,

            thinkingConfig: {
              thinkingLevel: 'medium',
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
