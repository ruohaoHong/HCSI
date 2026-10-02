import {
  SEMANTIC_OBSERVATION_STATES,
  SEMANTIC_TAXONOMY_VERSION,
  SEMANTIC_VISIBILITY_STATES,
  isSemanticFeatureId,
  isSemanticTaxonomyValue,
  type SemanticFeatureId,
  type SemanticObservationState,
  type SemanticVisibility,
} from './semantic-taxonomy-v1'
import { SEMANTIC_SENSOR_TYPES,type SemanticSensorType } from './semantic-evidence-v1'

export const SEMANTIC_SENSOR_OBSERVATION_RECORD_SCHEMA='hcsi.semantic-sensor-observation-record.v1' as const
export const SEMANTIC_OBSERVATION_STAGES=[
  'candidate_blind_first_pass','targeted_discriminator_pass','deterministic_classifier',
] as const
export type SemanticObservationStage=(typeof SEMANTIC_OBSERVATION_STAGES)[number]

export interface SemanticSensorObservationRecordV1 {
  schema_version:typeof SEMANTIC_SENSOR_OBSERVATION_RECORD_SCHEMA
  specimen_id:string
  image_id:string
  feature_id:SemanticFeatureId
  observation_stage:SemanticObservationStage
  sensor_type:SemanticSensorType
  model:string
  model_version:string
  prompt_version:string
  extractor_version:string
  taxonomy_version:string
  value:string
  state:SemanticObservationState
  visibility:SemanticVisibility
  raw_score:number|null
  observed_at:string
  run_id:string
  image_sha256:string
  crop_ref:string
  independence_group:string
  ground_truth_in_prompt:false
}

export interface SemanticSensorObservationRecordValidation {
  valid:boolean
  reason_codes:string[]
}

function nonEmpty(value:unknown):value is string{
  return typeof value==='string'&&value.trim().length>0
}

export function validateSemanticSensorObservationRecordV1(
  record:unknown,
):SemanticSensorObservationRecordValidation{
  const reasons:string[]=[]
  if(!record||typeof record!=='object'){
    return {valid:false,reason_codes:['observation_record_not_object']}
  }
  const r=record as Record<string,unknown>
  if(r.schema_version!==SEMANTIC_SENSOR_OBSERVATION_RECORD_SCHEMA) reasons.push('observation_schema_mismatch')
  if(!isSemanticFeatureId(r.feature_id)) reasons.push('observation_feature_id_invalid')
  if(!SEMANTIC_OBSERVATION_STATES.includes(r.state as SemanticObservationState)) reasons.push('observation_state_invalid')
  if(!SEMANTIC_VISIBILITY_STATES.includes(r.visibility as SemanticVisibility)) reasons.push('observation_visibility_invalid')
  if(!SEMANTIC_SENSOR_TYPES.includes(r.sensor_type as SemanticSensorType)) reasons.push('observation_sensor_type_invalid')
  if(!SEMANTIC_OBSERVATION_STAGES.includes(r.observation_stage as SemanticObservationStage)) reasons.push('observation_stage_invalid')
  if(isSemanticFeatureId(r.feature_id)&&!isSemanticTaxonomyValue(r.feature_id,r.value)){
    reasons.push('observation_taxonomy_value_invalid')
  }
  if(r.taxonomy_version!==SEMANTIC_TAXONOMY_VERSION) reasons.push('observation_taxonomy_version_invalid')
  if(r.ground_truth_in_prompt!==false) reasons.push('ground_truth_in_prompt_forbidden')
  if(typeof r.image_sha256!=='string'||!/^[a-f0-9]{64}$/i.test(r.image_sha256)) reasons.push('image_sha256_invalid')
  for(const field of [
    'specimen_id','image_id','run_id','observed_at','model','model_version','prompt_version',
    'extractor_version','crop_ref','independence_group',
  ]){
    if(!nonEmpty(r[field])) reasons.push(`observation_provenance_missing:${field}`)
  }
  if(r.raw_score!==null&&(
    typeof r.raw_score!=='number'||!Number.isFinite(r.raw_score)||r.raw_score<0||r.raw_score>1
  )){
    reasons.push('observation_raw_score_invalid')
  }
  const unique=[...new Set(reasons)]
  return {valid:unique.length===0,reason_codes:unique}
}

export function assertObservationCandidateBlind(record:SemanticSensorObservationRecordV1){
  const result=validateSemanticSensorObservationRecordV1(record)
  if(!result.valid) throw new Error(`semantic_observation_record_invalid:${result.reason_codes.join(',')}`)
  return record
}
