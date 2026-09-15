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
import { resolveMeasurementPlan } from '@/lib/measurement-plan-resolver'
import { runMeasurementPreflight, MeasurementServiceError } from '@/lib/measurement-client'
import { buildMeasurementEvidencePrompt } from '@/lib/measurement-prompt'
import type { MeasurementResult } from '@/lib/measurement'
import { loadReferencePack } from '@/lib/reference-loader'

const MAX_IMAGE_LENGTH = 7_000_000
const PROVIDER_CONFIG = {
  gemini: { envKey: 'GEMINI_API_KEY', model: 'gemini-3.7-flash', label: 'Gemini' },
  openai: { envKey: 'OPENAI_API_KEY', model: 'gpt-5.6-sol', label: 'OpenAI' },
  grok: { envKey: 'XAI_API_KEY', model: 'grok-4.6', label: 'Grok' },
} as const

type JsonSchema = Record<string, unknown>
type MeasurementServiceFallback = { code: string; message: string } | null

export async function handleIdentificationRequest(request: Request, provider: Provider) {
  try {
    const body = await request.json()
    const image = typeof body.image === 'string' ? body.image : ''
    if (!image || image.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(image)) return NextResponse.json({ error: '影像格式不正確或檔案過大。' }, { status: 400 })

    const config = PROVIDER_CONFIG[provider]
    const apiKey = process.env[config.envKey]
    if (!apiKey) return NextResponse.json({ error: `${config.label} 分析服務尚未完成設定。` }, { status: 503 })

    const routingRaw = await runStructuredProvider({ provider, apiKey, model: config.model, image, prompt: buildRoutingPrompt(), schemaName: 'hcsi_semantic_measurement_planner', schema: ROUTING_JSON_SCHEMA as unknown as JsonSchema, maxOutputTokens: 1400 })
    if (!isRoutingResult(routingRaw)) throw new Error(`${config.label} 語義量測規劃輸出格式不完整`)

    // Deterministic capability boundary. The LLM may propose anything useful;
    // only steps the current registry understands become executable.
    const resolvedMeasurementPlan = resolveMeasurementPlan(routingRaw.measurement_plan)

    // The geometry plan now drives deterministic measurement. This is the
    // vertical slice from semantic executable_steps to actual pixel/mm evidence.
    let measurement: MeasurementResult | null = null
    let measurementServiceError: MeasurementServiceFallback = null
    try {
      measurement = await runMeasurementPreflight(image, resolvedMeasurementPlan.executable_steps)
    } catch (error) {
      if (error instanceof MeasurementServiceError) {
        measurementServiceError = { code: error.code, message: error.message }
        console.warn(`[HCSI] ${provider} continuing without deterministic measurement:`, error.code)
      } else {
        measurementServiceError = { code: 'measurement_unexpected_error', message: '量測服務目前無法使用。' }
        console.warn(`[HCSI] ${provider} continuing without deterministic measurement: unexpected error`)
      }
    }

    const reference = await loadReferencePack(routingRaw.category)
    const measurementPrompt = buildMeasurementEvidencePrompt(measurement, measurementServiceError?.code)
    const resolverPrompt = buildResolverEvidencePrompt(resolvedMeasurementPlan)

    const identificationRaw = await runStructuredProvider({
      provider, apiKey, model: config.model, image,
      prompt: `${buildIdentificationPrompt(routingRaw, reference.core, reference.category)}\n${resolverPrompt}\n${measurementPrompt}`,
      schemaName: 'hcsi_hardware_identification', schema: IDENTIFICATION_JSON_SCHEMA as unknown as JsonSchema, maxOutputTokens: 2400,
    })
    if (!isIdentificationResult(identificationRaw)) throw new Error(`${config.label} 最終辨識輸出格式不完整`)

    await logResult(provider, config.model, routingRaw.category, identificationRaw, measurement)
    return NextResponse.json({ provider, model: config.model, routing: routingRaw, resolved_measurement_plan: resolvedMeasurementPlan, result: identificationRaw, measurement, measurement_service_error: measurementServiceError })
  } catch (error) {
    console.error(`[HCSI] ${provider} analyze failed:`, error)
    return NextResponse.json({ error: error instanceof Error ? error.message : '辨識時發生未預期錯誤。' }, { status: 502 })
  }
}

function buildResolverEvidencePrompt(plan: ReturnType<typeof resolveMeasurementPlan>) {
  const executable = plan.executable_steps.map((s) => `${s.operation}(${s.inputs.join(', ')})`).join(', ') || '無'
  const unsupported = plan.unsupported_steps.map((s) => `${s.operation} [${s.unsupported_terms.join(', ')}]`).join(', ') || '無'
  return `===== Geometry Plan Resolver =====\n目前 Engine 可執行：${executable}\n目前 unsupported / proposed：${unsupported}\nfully_supported=${plan.fully_supported}\n注意：可執行只代表 Engine 具備該 geometry vocabulary；是否真的量到數值，必須以下方 deterministic measurement 的 geometry_steps status 為準。unsupported 更不得當成 measured evidence。`
}

async function runStructuredProvider(args: { provider: Provider; apiKey: string; model: string; image: string; prompt: string; schemaName: string; schema: JsonSchema; maxOutputTokens: number }) {
  if (args.provider === 'gemini') return runGemini(args)
  return runResponsesApi(args)
}

async function runGemini(args: { apiKey: string; model: string; image: string; prompt: string; schemaName: string; schema: JsonSchema; maxOutputTokens: number }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${args.model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: args.image } }, { text: args.prompt }] }], generationConfig: { maxOutputTokens: args.maxOutputTokens, responseMimeType: 'application/json', responseJsonSchema: args.schema, thinkingConfig: { thinkingLevel: 'medium' } } }),
  })
  if (!response.ok) { const upstreamError = await response.text(); console.error('[HCSI] Gemini upstream error:', response.status, upstreamError.slice(0, 1600)); throw new Error('Gemini 分析服務暫時無法使用。') }
  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts?.find((part: any) => typeof part?.text === 'string')?.text
  return parseJsonText(text, 'Gemini')
}

async function runResponsesApi(args: { provider: Provider; apiKey: string; model: string; image: string; prompt: string; schemaName: string; schema: JsonSchema; maxOutputTokens: number }) {
  const isGrok = args.provider === 'grok'
  const endpoint = isGrok ? 'https://api.x.ai/v1/responses' : 'https://api.openai.com/v1/responses'
  const label = isGrok ? 'Grok' : 'OpenAI'
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${args.apiKey}` },
    body: JSON.stringify({ model: args.model, store: false, reasoning: { effort: 'medium' }, max_output_tokens: args.maxOutputTokens, text: { format: { type: 'json_schema', name: args.schemaName, schema: args.schema, strict: true } }, input: [{ role: 'user', content: [{ type: 'input_image', image_url: `data:image/jpeg;base64,${args.image}`, detail: 'high' }, { type: 'input_text', text: args.prompt }] }] }),
  })
  if (!response.ok) { const upstreamError = await response.text(); console.error(`[HCSI] ${label} upstream error:`, response.status, upstreamError.slice(0, 1600)); throw new Error(`${label} 分析服務暫時無法使用。`) }
  const data = await response.json()
  const text = data?.output?.flatMap((item: any) => item?.content ?? []).find((item: any) => item?.type === 'output_text')?.text
  return parseJsonText(text, label)
}

function parseJsonText(text: unknown, label: string) {
  if (typeof text !== 'string' || !text.trim()) throw new Error(`${label} 沒有回傳可解析的結果`)
  try { return JSON.parse(text) } catch { throw new Error(`${label} 回傳的 JSON 無法解析`) }
}

async function logResult(provider: Provider, model: string, category: string, result: IdentificationResult, measurement: MeasurementResult | null) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) return
  try {
    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
    await supabase.from('identification_logs').insert({ provider, model, category, item_name: result.item_name, identification_status: result.identification_status, result, measurement })
  } catch (error) { console.warn('[HCSI] unable to persist identification log:', error) }
}
