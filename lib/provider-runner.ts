import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  buildIdentificationPrompt,
  buildRoutingPrompt,
  IDENTIFICATION_JSON_SCHEMA,
  isIdentificationResult,
  isRoutingResult,
  ROUTING_JSON_SCHEMA,
  type IdentificationResult,
  type Provider,
} from '@/lib/identification'
import { loadReferencePack } from '@/lib/reference-loader'

const MAX_IMAGE_LENGTH = 7_000_000

const PROVIDER_CONFIG = {
  gemini: {
    envKey: 'GEMINI_API_KEY',
    model: 'gemini-3.7-flash',
    label: 'Gemini',
  },
  openai: {
    envKey: 'OPENAI_API_KEY',
    model: 'gpt-5.6-sol',
    label: 'OpenAI',
  },
  grok: {
    envKey: 'XAI_API_KEY',
    model: 'grok-4.6',
    label: 'Grok',
  },
} as const

type JsonSchema = Record<string, unknown>

export async function handleIdentificationRequest(request: Request, provider: Provider) {
  try {
    const body = await request.json()
    const image = typeof body.image === 'string' ? body.image : ''

    if (!image || image.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(image)) {
      return NextResponse.json({ error: '影像格式不正確或檔案過大。' }, { status: 400 })
    }

    const config = PROVIDER_CONFIG[provider]
    const apiKey = process.env[config.envKey]

    if (!apiKey) {
      return NextResponse.json({ error: `${config.label} 分析服務尚未完成設定。` }, { status: 503 })
    }

    const routingRaw = await runStructuredProvider({
      provider,
      apiKey,
      model: config.model,
      image,
      prompt: buildRoutingPrompt(),
      schemaName: 'hcsi_category_router',
      schema: ROUTING_JSON_SCHEMA as unknown as JsonSchema,
      maxOutputTokens: 900,
    })

    if (!isRoutingResult(routingRaw)) {
      throw new Error(`${config.label} 類別路由輸出格式不完整`)
    }

    const reference = await loadReferencePack(routingRaw.category)

    const identificationRaw = await runStructuredProvider({
      provider,
      apiKey,
      model: config.model,
      image,
      prompt: buildIdentificationPrompt(routingRaw, reference.core, reference.category),
      schemaName: 'hcsi_hardware_identification',
      schema: IDENTIFICATION_JSON_SCHEMA as unknown as JsonSchema,
      maxOutputTokens: 2400,
    })

    if (!isIdentificationResult(identificationRaw)) {
      throw new Error(`${config.label} 最終辨識輸出格式不完整`)
    }

    await logResult(provider, config.model, routingRaw.category, identificationRaw)

    return NextResponse.json({
      provider,
      model: config.model,
      routing: routingRaw,
      result: identificationRaw,
    })
  } catch (error) {
    console.error(`[HCSI] ${provider} analyze failed:`, error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '辨識時發生未預期錯誤。',
      },
      { status: 502 }
    )
  }
}

async function runStructuredProvider(args: {
  provider: Provider
  apiKey: string
  model: string
  image: string
  prompt: string
  schemaName: string
  schema: JsonSchema
  maxOutputTokens: number
}) {
  if (args.provider === 'gemini') return runGemini(args)
  return runResponsesApi(args)
}

async function runGemini(args: {
  apiKey: string
  model: string
  image: string
  prompt: string
  schemaName: string
  schema: JsonSchema
  maxOutputTokens: number
}) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${args.model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': args.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: args.image,
                },
              },
              { text: args.prompt },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: args.maxOutputTokens,
          responseMimeType: 'application/json',
          responseJsonSchema: args.schema,
          thinkingConfig: {
            thinkingLevel: 'medium',
          },
        },
      }),
    }
  )

  if (!response.ok) {
    const upstreamError = await response.text()
    console.error('[HCSI] Gemini upstream error:', response.status, upstreamError.slice(0, 1600))
    throw new Error('Gemini 分析服務暫時無法使用。')
  }

  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts?.find((part: any) => typeof part?.text === 'string')?.text
  return parseJsonText(text, 'Gemini')
}

async function runResponsesApi(args: {
  provider: Provider
  apiKey: string
  model: string
  image: string
  prompt: string
  schemaName: string
  schema: JsonSchema
  maxOutputTokens: number
}) {
  const isGrok = args.provider === 'grok'
  const endpoint = isGrok ? 'https://api.x.ai/v1/responses' : 'https://api.openai.com/v1/responses'
  const label = isGrok ? 'Grok' : 'OpenAI'

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      store: false,
      reasoning: {
        effort: 'medium',
      },
      max_output_tokens: args.maxOutputTokens,
      text: {
        format: {
          type: 'json_schema',
          name: args.schemaName,
          schema: args.schema,
          strict: true,
        },
      },
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${args.image}`,
              detail: 'high',
            },
            {
              type: 'input_text',
              text: args.prompt,
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const upstreamError = await response.text()
    console.error(`[HCSI] ${label} upstream error:`, response.status, upstreamError.slice(0, 1600))
    throw new Error(`${label} 分析服務暫時無法使用。`)
  }

  const data = await response.json()
  const text = data?.output
    ?.flatMap((item: any) => item?.content ?? [])
    ?.find((item: any) => item?.type === 'output_text')
    ?.text

  return parseJsonText(text, label)
}

function parseJsonText(text: unknown, label: string) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error(`${label} 未產生有效辨識結果。`)
  }

  try {
    return JSON.parse(text)
  } catch {
    console.error(`[HCSI] ${label} returned invalid JSON:`, text.slice(0, 1600))
    throw new Error(`${label} 回傳的結構化結果無法解析。`)
  }
}

async function logResult(
  provider: Provider,
  model: string,
  routedCategory: string,
  result: IdentificationResult
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return

  const supabase = createClient(supabaseUrl, supabaseKey)
  const payload = JSON.stringify({ provider, model, routedCategory, result })
  const { error } = await supabase.from('hardware_logs').insert({
    result_text: payload.slice(0, 12000),
  })

  if (error) {
    console.error('[HCSI] hardware log insert failed:', error.message)
  }
}
