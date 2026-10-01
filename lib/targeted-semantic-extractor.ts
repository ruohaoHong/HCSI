import {
  SEMANTIC_SENSOR_OBSERVATION_JSON_SCHEMA,
  type RawSemanticSensorObservation,
  type SemanticObservation,
  type SemanticEvidenceV1,
} from './semantic-evidence-v1'
import { sanitizeRawSemanticSensorOutput, validateSemanticObservationV1 } from './semantic-evidence-validator'
import { SEMANTIC_FEATURE_DEFINITIONS } from './semantic-taxonomy-v1'
import type { TargetedSemanticRequest } from './targeted-semantic-request'

export const TARGETED_SEMANTIC_EVIDENCE_SCHEMA = 'hcsi.targeted-semantic-evidence.v1' as const
export const TARGETED_SEMANTIC_PROMPT_VERSION = 'hcsi.targeted-semantic.prompt.v1' as const

export interface TargetedSemanticEvidence {
  schema_version: typeof TARGETED_SEMANTIC_EVIDENCE_SCHEMA
  observation_stage: 'targeted_discriminator_pass'
  observation_id: string
  refines_observation_id: string | null
  supersedes_for_latest_view: boolean
  observation: SemanticObservation
  provenance: {
    sensor_type: 'vlm'
    model: string
    model_version: string
    prompt_version: typeof TARGETED_SEMANTIC_PROMPT_VERSION
    crop_ref: string
    image_sha256: string
  }
}

export function targetedSemanticSensorJsonSchema(request: TargetedSemanticRequest) {
  return {
    type:'object',additionalProperties:false,
    properties:{
      ...SEMANTIC_SENSOR_OBSERVATION_JSON_SCHEMA.properties,
      feature_id:{type:'string',enum:[request.feature_id]},
      value:{type:'string',enum:request.allowed_values},
    },
    required:[...SEMANTIC_SENSOR_OBSERVATION_JSON_SCHEMA.required],
  } as const
}

export function buildTargetedSemanticPrompt(request: TargetedSemanticRequest): string {
  return `You are inspecting exactly one observable semantic feature.

Feature: ${request.feature_id}
Allowed values: ${request.allowed_values.join(' / ')}

${request.question}

Rules:
- Report only this feature.
- Use the controlled state, visibility, reason-code and taxonomy fields in the response schema.
- Do not identify the fastener standard or thread designation.
- Do not infer metric versus inch, ISO/ASME/Unified identity, nominal diameter, pitch, TPI or length.
- Do not choose, rank, compare or vote for candidates.
- Do not infer an expected answer from engineering commonness.
- If the feature is not visible, ambiguous, unknown, or outside the taxonomy, say so explicitly.
- calibration_status must be uncalibrated and calibrated_probability must be null.
- raw_text is literal OCR transcription only when the requested feature is markings.ocr.
`
}

export function buildTargetedSemanticEvidence(
  rawObservation: RawSemanticSensorObservation,
  request: TargetedSemanticRequest,
  firstPass: SemanticEvidenceV1 | null,
  provenance: {model:string;model_version:string},
): TargetedSemanticEvidence {
  if (rawObservation.feature_id !== request.feature_id) throw new Error('targeted_semantic_feature_mismatch')
  const rawValidation=validateSemanticObservationV1(rawObservation,true)
  if (!rawValidation.valid) throw new Error(`invalid_targeted_raw_observation:${rawValidation.errors.join('|')}`)
  const sanitized=sanitizeRawSemanticSensorOutput({
    observations:[rawObservation],
    quality:{status:'usable',reason_codes:[]},
  }).observations[0]
  const processedValidation=validateSemanticObservationV1(sanitized,false)
  if (!processedValidation.valid) throw new Error(`invalid_targeted_semantic_observation:${processedValidation.errors.join('|')}`)

  const cropRef=request.semantic_roi.crop_ref
  const first=firstPass?.observations.find(o=>o.feature_id===request.feature_id) ?? null
  const firstObservationId=first ? `first-pass:${first.source}:${first.feature_id}` : null
  const observation:SemanticObservation={
    ...sanitized,
    feature_family:SEMANTIC_FEATURE_DEFINITIONS[request.feature_id].family,
    source:`targeted:${request.feature_id}`,
    evidence_refs:[cropRef],
    // Same image + same crop deliberately shares the same group identity.
    independence_group:first && firstPass?.observation_scope.target_region_ref===cropRef
      ? first.independence_group
      : cropRef,
  }
  return {
    schema_version:TARGETED_SEMANTIC_EVIDENCE_SCHEMA,
    observation_stage:'targeted_discriminator_pass',
    observation_id:`targeted:${request.feature_id}:${cropRef}`,
    refines_observation_id:firstObservationId,
    supersedes_for_latest_view:Boolean(first),
    observation,
    provenance:{
      sensor_type:'vlm',model:provenance.model,model_version:provenance.model_version,
      prompt_version:TARGETED_SEMANTIC_PROMPT_VERSION,crop_ref:cropRef,image_sha256:request.image.image_sha256,
    },
  }
}
