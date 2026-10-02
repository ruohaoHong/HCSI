import type { SemanticFeatureId,SemanticObservationState,SemanticVisibility } from './semantic-taxonomy-v1'
import type { SemanticSensorType } from './semantic-evidence-v1'

export const SEMANTIC_SENSOR_OBSERVATION_RECORD_SCHEMA='hcsi.semantic-sensor-observation-record.v1' as const
export interface SemanticSensorObservationRecordV1 {
  schema_version:typeof SEMANTIC_SENSOR_OBSERVATION_RECORD_SCHEMA
  specimen_id:string
  image_id:string
  feature_id:SemanticFeatureId
  observation_stage:'candidate_blind_first_pass'|'targeted_discriminator_pass'|'deterministic_classifier'
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
export function assertObservationCandidateBlind(record:SemanticSensorObservationRecordV1){
  if(record.ground_truth_in_prompt!==false) throw new Error('ground_truth_in_prompt_forbidden')
  if(!/^[a-f0-9]{64}$/i.test(record.image_sha256)) throw new Error('image_sha256_invalid')
  if(!record.specimen_id||!record.image_id||!record.run_id||!record.observed_at) throw new Error('observation_provenance_incomplete')
  return record
}
