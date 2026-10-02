import type { SemanticFeatureId } from './semantic-taxonomy-v1'
import type { SemanticSensorType } from './semantic-evidence-v1'

export const SEMANTIC_CALIBRATION_LINEAGE_SCHEMA='hcsi.semantic-calibration-lineage.v1' as const

export interface CalibrationDatasetIdentityV1 {
  dataset_id:string
  dataset_version:string
  dataset_manifest_digest_sha256:string
  dataset_content_digest_sha256:string
}

export interface CalibrationSensorIdentityV1 {
  sensor_type:SemanticSensorType
  model:string
  model_version:string
  prompt_version:string
  extractor_version:string
  taxonomy_version:string
}

export interface CalibrationEstimatorIdentityV1 {
  feature_id:SemanticFeatureId
  sensor_identity:CalibrationSensorIdentityV1
  estimator_config_digest_sha256:string
}

export function sensorIdentityEquals(a:CalibrationSensorIdentityV1,b:CalibrationSensorIdentityV1):boolean{
  return a.sensor_type===b.sensor_type&&a.model===b.model&&a.model_version===b.model_version&&
    a.prompt_version===b.prompt_version&&a.extractor_version===b.extractor_version&&
    a.taxonomy_version===b.taxonomy_version
}
