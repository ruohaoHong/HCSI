import {
  SEMANTIC_FEATURE_DEFINITIONS,
  SEMANTIC_FEATURE_IDS,
  SEMANTIC_OBSERVATION_STATES,
  SEMANTIC_TAXONOMY_VERSION,
  SEMANTIC_VISIBILITY_STATES,
  type SemanticFeatureFamily,
  type SemanticFeatureId,
  type SemanticObservationState,
  type SemanticVisibility,
} from './semantic-taxonomy-v1'
import {
  SEMANTIC_OBSERVATION_REASON_CODES,
  SEMANTIC_QUALITY_REASON_CODES,
  SEMANTIC_REASON_CODE_TAXONOMY_VERSION,
  type SemanticObservationReasonCode,
  type SemanticQualityReasonCode,
} from './semantic-reason-codes-v1'

export const SEMANTIC_EVIDENCE_SCHEMA = 'hcsi.semantic-evidence.v1' as const
export const SEMANTIC_EXTRACTOR_VERSION = 'hcsi.candidate-blind-vlm.v1' as const
export const SEMANTIC_PROMPT_VERSION = 'hcsi.semantic-first-pass.prompt.v1' as const

export type CalibrationStatus = 'uncalibrated' | 'calibrated'
export type SemanticSensorType = 'vlm' | 'deterministic_classifier' | 'ocr' | 'geometry_semantic_bridge'

export interface SemanticEvidenceSource {
  evidence_ref: string
  sensor_type: SemanticSensorType
  model: string
  model_version: string
  prompt_version: string
  crop_ref: string
  image_sha256: string
}

export interface SemanticIndependenceGroup {
  group_id: string
  crop_ref: string
  image_sha256: string
  description: string
}

export interface SemanticObservation {
  feature_id: SemanticFeatureId
  feature_family: SemanticFeatureFamily
  value: string
  state: SemanticObservationState
  visibility: SemanticVisibility
  raw_score: number | null
  calibrated_probability: number | null
  calibration_status: CalibrationStatus
  source: string
  evidence_refs: string[]
  independence_group: string
  reason_codes: SemanticObservationReasonCode[]
  freeform_description: string | null
  raw_text: string | null
  normalized_text: string | null
  character_confidence: number | null
}

export interface SemanticEvidenceV1 {
  schema_version: typeof SEMANTIC_EVIDENCE_SCHEMA
  taxonomy_version: typeof SEMANTIC_TAXONOMY_VERSION
  reason_code_taxonomy_version: typeof SEMANTIC_REASON_CODE_TAXONOMY_VERSION
  extractor_version: typeof SEMANTIC_EXTRACTOR_VERSION
  observation_scope: {
    mode: 'candidate_blind_first_pass'
    image_sha256: string
    target_region_ref: string
    physical_measurements_included: false
    standards_candidates_included: false
    legacy_nominal_included: false
    ground_truth_included: false
  }
  observations: SemanticObservation[]
  unknown_or_open_set: SemanticFeatureId[]
  evidence_sources: SemanticEvidenceSource[]
  independence_groups: SemanticIndependenceGroup[]
  quality: {
    status: 'usable' | 'limited' | 'insufficient'
    reason_codes: SemanticQualityReasonCode[]
  }
}

const allValues = [...new Set(
  SEMANTIC_FEATURE_IDS.flatMap(id => [...SEMANTIC_FEATURE_DEFINITIONS[id].values])
)]

const SENSOR_OBSERVATION_SCHEMA = {
  type:'object',
  additionalProperties:false,
  properties:{
    feature_id:{type:'string',enum:SEMANTIC_FEATURE_IDS},
    value:{type:'string',enum:allValues},
    state:{type:'string',enum:SEMANTIC_OBSERVATION_STATES},
    visibility:{type:'string',enum:SEMANTIC_VISIBILITY_STATES},
    raw_score:{type:['number','null'],minimum:0,maximum:1},
    calibrated_probability:{type:['number','null'],minimum:0,maximum:1},
    calibration_status:{type:'string',enum:['uncalibrated']},
    reason_codes:{type:'array',items:{type:'string',enum:SEMANTIC_OBSERVATION_REASON_CODES}},
    freeform_description:{type:['string','null']},
    raw_text:{type:['string','null']},
    normalized_text:{type:['string','null']},
    character_confidence:{type:['number','null'],minimum:0,maximum:1},
  },
  required:[
    'feature_id','value','state','visibility','raw_score','calibrated_probability',
    'calibration_status','reason_codes','freeform_description','raw_text',
    'normalized_text','character_confidence',
  ],
} as const

export const SEMANTIC_SENSOR_OUTPUT_JSON_SCHEMA = {
  type:'object',
  additionalProperties:false,
  properties:{
    observations:{
      type:'array',
      minItems:SEMANTIC_FEATURE_IDS.length,
      maxItems:SEMANTIC_FEATURE_IDS.length,
      items:SENSOR_OBSERVATION_SCHEMA,
    },
    quality:{
      type:'object',
      additionalProperties:false,
      properties:{
        status:{type:'string',enum:['usable','limited','insufficient']},
        reason_codes:{type:'array',items:{type:'string',enum:SEMANTIC_QUALITY_REASON_CODES}},
      },
      required:['status','reason_codes'],
    },
  },
  required:['observations','quality'],
} as const

export interface RawSemanticSensorObservation {
  feature_id: SemanticFeatureId
  value: string
  state: SemanticObservationState
  visibility: SemanticVisibility
  raw_score: number | null
  calibrated_probability: number | null
  calibration_status: 'uncalibrated'
  reason_codes: SemanticObservationReasonCode[]
  freeform_description: string | null
  raw_text: string | null
  normalized_text: string | null
  character_confidence: number | null
}

export interface RawSemanticSensorOutput {
  observations: RawSemanticSensorObservation[]
  quality: SemanticEvidenceV1['quality']
}
