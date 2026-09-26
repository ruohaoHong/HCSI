import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { Provider, IdentificationResult } from '@/lib/identification'
import { isIdentificationResult } from '@/lib/identification'
import { CV_FIRST_IDENTIFICATION_JSON_SCHEMA, buildCvFirstIdentificationPrompt } from '@/lib/cv-first-identification'
import { runMeasurementPreflight, MeasurementServiceError } from '@/lib/measurement-client'
import { verifyMeasurementProof } from '@/lib/measurement-proof'
import { selectLengthFromCv } from '@/lib/cv-length-policy'
import type { MeasurementResult, FixedDimension } from '@/lib/measurement'
import { loadReferencePack } from '@/lib/reference-loader'

const MAX_IMAGE_LENGTH = 7_000_000
const PROVIDER_CONFIG = {
  gemini: { envKey: 'GEMINI_API_KEY', model: 'gemini-3.7-flash', label: 'Gemini' },
  openai: { envKey: 'OPENAI_API_KEY', model: 'gpt-5.6-sol', label: 'OpenAI' },
  grok: { envKey: 'XAI_API_KEY', model: 'grok-4.6', label: 'Grok' },
} as const
type JsonSchema = Record<string, unknown>
type MeasurementServiceFallback = { code: string; message: string } | null

const REQUIRED_DIMENSIONS: FixedDimension[] = ['D','P','L_underhead','L_overall','B','K','DK']

export async function handleIdentificationRequest(request: Request, provider: Provider) {
  try {
    const body = await request.json()
    const image = typeof body.image === 'string' ? body.image : ''
    if (!image || image.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(image)) {
      return NextResponse.json({ error: '影像格式不正確或檔案過大。' }, { status: 400 })
    }
    const config = PROVIDER_CONFIG[provider]
    const apiKey = process.env[config.envKey]
    if (!apiKey) return NextResponse.json({ error: `${config.label} 分析服務尚未完成設定。` }, { status: 503 })

    let measurement: MeasurementResult | null = null
    let measurementServiceError: MeasurementServiceFallback = null
    const proofValid = verifyMeasurementProof(body.measurement, body.measurement_proof, image)
    if (proofValid) {
      measurement = body.measurement as MeasurementResult
    } else {
      try {
        // CV executes its fixed acquisition BEFORE the single vision LLM call.
        // Old planner output or client-supplied untrusted evidence has no veto.
        measurement = await runMeasurementPreflight(image)
      } catch (error) {
        if (error instanceof MeasurementServiceError) {
          measurementServiceError = { code: error.code, message: error.message }
        } else {
          measurementServiceError = { code: 'measurement_unexpected_error', message: '量測服務無法使用。' }
        }
      }
    }
    const cvComplete = !!measurement?.dimensions && REQUIRED_DIMENSIONS.every(key => !!measurement?.dimensions?.[key])
    if (measurement && !cvComplete) throw new Error('CV-first 回傳缺少固定六項測量槽位')

    const reference = await loadReferencePack('fasteners')
    const identificationRaw = await runStructuredProvider({
      provider, apiKey, model: config.model, image,
      prompt: buildCvFirstIdentificationPrompt(measurement, measurementServiceError?.code ?? null,
        reference.core, reference.category),
      schemaName: 'hcsi_cv_first_identification',
      schema: CV_FIRST_IDENTIFICATION_JSON_SCHEMA as unknown as JsonSchema,
      maxOutputTokens: 4600,
    })
    if (!isIdentificationResult(identificationRaw) ||
        !identificationRaw.fastener_interpretation ||
        typeof identificationRaw.fastener_interpretation.head_style !== 'string') {
      throw new Error(`${config.label} CV-first 語義辨識結果格式不完整`)
    }
    // Nominal identification never edits the signed raw CV observations.
    const selectedLength = selectLengthFromCv(identificationRaw.fastener_interpretation.head_style, measurement)
    identificationRaw.fastener_interpretation.length_convention = selectedLength.convention
    const haveMetricEvidence = !!measurement?.dimensions &&
      ['D', 'P', 'L_underhead', 'L_overall'].some(
        key => measurement?.dimensions?.[key as FixedDimension]?.status === 'measured'
      )
    if (!haveMetricEvidence) {
      identificationRaw.fastener_interpretation.nominal_specification = ''
      identificationRaw.purchase_description = `${identificationRaw.item_name}（尺寸未經可信尺度驗證；請補拍含尺照片或持實物至五金行核對）`
    }
    identificationRaw.specifications = identificationRaw.specifications.filter(
      spec => !/^S\s*[:：／]?|驅動槽尺寸|槽孔尺寸/i.test(spec.label)
    )
    identificationRaw.specifications.push({
      label: 'S 驅動槽尺寸',
      value: '待確認：目前沒有已核實的標準型號與相應標準規格表，不是照片實測。',
      evidence_level: 'unconfirmed',
    })
    const dimensions = measurement?.dimensions ?? {}
    const response = {
      provider, model: config.model, result: identificationRaw, measurement,
      specification_evidence: {
        cv_raw_measurements: dimensions,
        llm_inferred_nominal: identificationRaw.fastener_interpretation.nominal_specification,
        standard_table_derived: [], // No verified standards table is wired in v1.
        not_obtained: [
          ...REQUIRED_DIMENSIONS.filter(key => dimensions[key]?.status !== 'measured'),
          'S',
        ],
        not_implemented: ['T'],
      },
      selected_length: selectedLength,
      measurement_source: proofValid ? 'signed_preflight_reused' : measurement ? 'server_cv_executed' : 'service_unavailable',
      measurement_service_error: measurementServiceError,
      schema_version: 'hcsi.cv-first.v1',
    }
    await logResult(provider, config.model, identificationRaw.category, identificationRaw, measurement)
    return NextResponse.json(response)
  } catch (error) {
    console.error(`[HCSI] ${provider} analyze failed:`, error)
    return NextResponse.json({ error: error instanceof Error ? error.message : '辨識失敗' }, { status: 502 })
  }
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
