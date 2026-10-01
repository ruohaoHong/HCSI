import type { Provider } from './identification'
import {
  candidateBlindSemanticPromptContext,
  type CandidateBlindSemanticRequest,
} from './candidate-blind-semantic-request'
import {
  SEMANTIC_FEATURE_IDS,
  SEMANTIC_FEATURE_DEFINITIONS,
} from './semantic-taxonomy-v1'
import {
  SEMANTIC_OBSERVATION_REASON_CODES,
  SEMANTIC_QUALITY_REASON_CODES,
} from './semantic-reason-codes-v1'
import {
  SEMANTIC_SENSOR_OUTPUT_JSON_SCHEMA,
  SEMANTIC_EXTRACTOR_VERSION,
  type RawSemanticSensorOutput,
  type SemanticEvidenceV1,
} from './semantic-evidence-v1'
import {
  buildSemanticEvidenceV1,
  sanitizeRawSemanticSensorOutput,
  validateRawSemanticSensorOutput,
} from './semantic-evidence-validator'

const PROVIDER_CONFIG = {
  openai:{envKey:'OPENAI_API_KEY',model:'gpt-5.6-sol',label:'OpenAI'},
  gemini:{envKey:'GEMINI_API_KEY',model:'gemini-3.7-flash',label:'Gemini'},
  grok:{envKey:'XAI_API_KEY',model:'grok-4.6',label:'Grok'},
} as const

function taxonomyPrompt(): string {
  return SEMANTIC_FEATURE_IDS.map(id =>
    `- ${id}: ${SEMANTIC_FEATURE_DEFINITIONS[id].values.join(' / ')}`
  ).join('\n')
}

export function buildCandidateBlindSemanticPrompt(request: CandidateBlindSemanticRequest): string {
  return `
You are HCSI's candidate-blind semantic visual sensor.

Your only job is to report observable morphology from the supplied image and spatial ROI.
You are NOT a measurement system, standards solver, product selector, or purchasing authority.

STRICT BLINDNESS / RESPONSIBILITY RULES:
- Report only observable semantic morphology.
- Do not infer or output a nominal thread designation.
- Do not infer metric vs inch / imperial standards identity.
- Do not infer diameter, pitch, TPI, nominal length, head dimensions, or any physical measurement.
- Do not choose, compare, rank, or vote for a standards candidate.
- Do not convert visual features into product specifications.
- Do not mention a candidate ID, standards designation, residual, rank, legacy nominal, ground truth, or expected case result.
- If evidence is insufficient use unknown / ambiguous / not_visible / open_set.
- "not_visible" means the relevant surface/feature cannot be seen. It does NOT mean the feature is absent.
- "not_observed" means the relevant region is visible and the feature is not observed. Do not substitute this for not_visible.
- Open-set is valid. Do not force a nearest taxonomy class when morphology falls outside the finite taxonomy.
- raw_score is not calibrated probability. For this VLM first pass, set raw_score=null unless the provider supplies an actual numeric sensor score independent of your prose.
- calibrated_probability MUST be null and calibration_status MUST be "uncalibrated".
- For OCR/markings, raw_text is literal transcription only. Literal compact markings such as "10.9", "A2", "304", manufacturer/logo text are allowed as observations; do not interpret what they mean.
- OCR raw_text must never contain your own interpretation such as "probably metric", "looks like ISO", "likely UNC", "candidate", "winner", "best match", or ranking language.
- normalized_text is not an interpretation field. Give only a whitespace-normalized literal copy of raw_text; deterministic code will recompute it.
- freeform_description is allowed ONLY for open_set morphology and must remain purely visual. Never mention metric/imperial/inch/Unified/UNC/UNF/UNEF/ISO/ASME, candidates, winners, ranks, nominal designations, dimensions, or TPI.

Return exactly one observation for every feature_id below:
${taxonomyPrompt()}

reason_codes are controlled metadata, not prose. Use ONLY these observation reason codes, or []:
${SEMANTIC_OBSERVATION_REASON_CODES.join(' / ')}

quality.reason_codes also use ONLY this controlled vocabulary, or []:
${SEMANTIC_QUALITY_REASON_CODES.join(' / ')}

Do not invent reason-code strings. Codes FORBIDDEN_CLAIM_REMOVED and
UNCALIBRATED_PROBABILITY_REMOVED are reserved for deterministic sanitizer use.

State/visibility consistency:
- state=not_visible => visibility=not_visible and use that feature's not-visible taxonomy value.
- state=open_set => value=open_set and provide a short morphology-only freeform_description.
- state=unknown => value=unknown.
- OCR fields raw_text/normalized_text/character_confidence are only for markings.ocr; all other observations must set them to null.

Spatial context is ONLY to tell you where the target is; it contains no physical measurement:
${JSON.stringify(candidateBlindSemanticPromptContext(request), null, 2)}

Output only the requested structured JSON.
`.trim()
}

export async function extractCandidateBlindSemanticEvidence(
  request: CandidateBlindSemanticRequest,
  provider: Provider,
): Promise<SemanticEvidenceV1> {
  const config=PROVIDER_CONFIG[provider]
  const apiKey=process.env[config.envKey]
  if (!apiKey) throw new Error(`${config.label}_semantic_extractor_not_configured`)
  const raw=provider === 'gemini'
    ? await runGemini(apiKey,config.model,request)
    : await runResponses(provider,apiKey,config.model,request)
  const sanitized=sanitizeRawSemanticSensorOutput(raw)
  const validation=validateRawSemanticSensorOutput(sanitized)
  if (!validation.valid) throw new Error(`semantic_sensor_output_invalid:${validation.errors.join('|')}`)
  return buildSemanticEvidenceV1(sanitized,request,{
    model:config.model,
    model_version:config.model,
    sensor_type:'vlm',
  })
}

async function runResponses(
  provider:'openai'|'grok',
  apiKey:string,
  model:string,
  request:CandidateBlindSemanticRequest,
): Promise<RawSemanticSensorOutput> {
  const isGrok=provider === 'grok'
  const endpoint=isGrok ? 'https://api.x.ai/v1/responses' : 'https://api.openai.com/v1/responses'
  const label=isGrok ? 'Grok' : 'OpenAI'
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},
    body:JSON.stringify({
      model,
      store:false,
      reasoning:{effort:'low'},
      max_output_tokens:3600,
      text:{
        format:{
          type:'json_schema',
          name:'hcsi_candidate_blind_semantic_v1',
          schema:SEMANTIC_SENSOR_OUTPUT_JSON_SCHEMA,
          strict:true,
        },
      },
      input:[{
        role:'user',
        content:[
          {type:'input_text',text:buildCandidateBlindSemanticPrompt(request)},
          {type:'input_image',image_url:`data:${request.image.mime_type};base64,${request.image.base64}`,detail:'high'},
        ],
      }],
    }),
  })
  if (!response.ok) {
    const upstream=await response.text()
    console.error(`[HCSI] ${label} candidate-blind semantic upstream error:`,response.status,upstream.slice(0,1200))
    throw new Error(`${label}_candidate_blind_semantic_unavailable`)
  }
  const data=await response.json()
  const text=data?.output?.flatMap((item:any)=>item?.content ?? [])
    .find((item:any)=>item?.type === 'output_text')?.text
  return parseRaw(text,label)
}

async function runGemini(
  apiKey:string,
  model:string,
  request:CandidateBlindSemanticRequest,
): Promise<RawSemanticSensorOutput> {
  const response=await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
      body:JSON.stringify({
        contents:[{
          parts:[
            {text:buildCandidateBlindSemanticPrompt(request)},
            {inline_data:{mime_type:request.image.mime_type,data:request.image.base64}},
          ],
        }],
        generationConfig:{
          maxOutputTokens:3600,
          responseMimeType:'application/json',
          responseJsonSchema:SEMANTIC_SENSOR_OUTPUT_JSON_SCHEMA,
          thinkingConfig:{thinkingLevel:'low'},
        },
      }),
    },
  )
  if (!response.ok) {
    const upstream=await response.text()
    console.error('[HCSI] Gemini candidate-blind semantic upstream error:',response.status,upstream.slice(0,1200))
    throw new Error('Gemini_candidate_blind_semantic_unavailable')
  }
  const data=await response.json()
  const text=data?.candidates?.[0]?.content?.parts
    ?.find((part:any)=>typeof part?.text === 'string')?.text
  return parseRaw(text,'Gemini')
}

function parseRaw(text:unknown,label:string): RawSemanticSensorOutput {
  if (typeof text !== 'string' || !text.trim()) throw new Error(`${label}_semantic_output_empty`)
  let parsed:unknown
  try { parsed=JSON.parse(text) } catch { throw new Error(`${label}_semantic_output_invalid_json`) }
  const sanitized=sanitizeRawSemanticSensorOutput(parsed as RawSemanticSensorOutput)
  const validation=validateRawSemanticSensorOutput(sanitized)
  if (!validation.valid) throw new Error(`${label}_semantic_output_invalid:${validation.errors.join('|')}`)
  return sanitized
}

export const CANDIDATE_BLIND_SEMANTIC_EXTRACTOR_VERSION = SEMANTIC_EXTRACTOR_VERSION
