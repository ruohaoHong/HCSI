import type { SemanticFeatureId } from './semantic-taxonomy-v1'
import type { SemanticSensorType } from './semantic-evidence-v1'

export const SEMANTIC_CALIBRATION_SCHEMA='hcsi.semantic-calibration.v1' as const
export type SemanticCalibrationArtifactStatus='validated'|'insufficient_data'|'out_of_scope'|'version_mismatch'|'synthetic_test_only'|'unavailable'

export interface SemanticCalibrationArtifactV1 {
  schema_version:typeof SEMANTIC_CALIBRATION_SCHEMA
  calibration_id:string
  version:string
  status:SemanticCalibrationArtifactStatus
  sensor_identity:{
    sensor_type:SemanticSensorType
    model:string
    model_version:string
    prompt_version:string
    extractor_version:string
  }
  feature_id:SemanticFeatureId
  taxonomy_version:string
  dataset_id:string
  dataset_version:string
  calibration_method:{method_id:string;method_version:string}
  applicability_scope:{
    visibility:string[]
    capture_types:string[]
    viewpoints:string[]
    crop_types:string[]
    resolution:{min_width_px:number;min_height_px:number;max_width_px:number|null;max_height_px:number|null}
    occlusion_conditions:string[]
    glare_conditions:string[]
  }
  metrics:{
    brier_score:number|null
    log_loss:number|null
    ece:number|null
    ece_policy_version:string|null
    sample_count:number
    per_class_support:Record<string,number>
  }
  /**
   * Reference only. The artifact does not own policy authority.
   * Preregistration/activation is determined exclusively by the policy registry.
   */
  eligibility_policy_version:string|null
}

export const PRODUCTION_SEMANTIC_CALIBRATION_REGISTRY:readonly SemanticCalibrationArtifactV1[]=[]
