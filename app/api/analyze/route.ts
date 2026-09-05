import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const MAX_IMAGE_LENGTH = 7_000_000

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const image = typeof body.image === 'string' ? body.image : ''
    if (!image || image.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(image)) return NextResponse.json({ error: '影像格式不正確或檔案過大。' }, { status: 400 })
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: '分析服務尚未完成設定。' }, { status: 503 })

    const prompt = `你是一位具備現場經驗的專業五金工程師。請分析這張五金元件照片，使用繁體中文輸出純文字、結構化且保守的結果。請依序包含：\n零件種類：\n預估尺寸規格：\n材質／外觀特徵：\n判讀信心：\n若照片無法確認，請明確標註「無法由影像確認」，不要捏造精確數值。`
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: image } }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 700, thinkingConfig: { thinkingBudget: 0 } } }) })
    if (!geminiResponse.ok) {
      const upstreamError = await geminiResponse.text()
      console.error('[v0] Gemini request failed:', geminiResponse.status, upstreamError.slice(0, 1000))
      return NextResponse.json({ error: 'AI 分析服務暫時無法使用，請稍後再試。' }, { status: 502 })
    }
    const geminiData = await geminiResponse.json()
    const result = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof result !== 'string' || !result.trim()) return NextResponse.json({ error: 'AI 未能產生有效辨識結果。' }, { status: 502 })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey)
      const { error } = await supabase.from('hardware_logs').insert({ result_text: result.slice(0, 12000) })
      if (error) console.error('[v0] hardware log insert failed:', error.message)
    }
    return NextResponse.json({ result: result.slice(0, 12000) })
  } catch (error) {
    console.error('[v0] analyze route failed:', error)
    return NextResponse.json({ error: '請求格式不正確，請重新上傳影像。' }, { status: 400 })
  }
}
