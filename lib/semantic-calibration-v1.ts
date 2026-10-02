import type { SemanticFeatureId } from './semantic-taxonomy-v1'
import type { SemanticSensorType } from './semantic-evidence-v1'
import type { SemanticConfusionModelV1 } from './semantic-confusion-model-v1'
import type { CandidateCalibrationFit } from './semantic-calibration-fit'
import { sha256Canonical } from './semantic-calibration-digest'
import { SEMANTIC_CALIBRATION_LINEAGE_SCHEMA } from './semantic-calibration-lineage-v1'

export const SEMANTIC_CALIBRATION_SCHEMA='hcsi.semantic-calibration.v1' as const
export type SemanticCalibrationArtifactStatus='validated'|'insufficient_data'|'out_of_scope'|'version_mismatch'|'synthetic_test_only'|'unavailable'

export interface SemanticCalibrationArtifactV1 {
  schema_version:typeof SEMANTIC_CALIBRATION_SCHEMA
  lineage_schema_version:typeof SEMANTIC_CALIBRATION_LINEAGE_SCHEMA
  calibration_id:string
  version:string
  artifact_digest_sha256:string
  source_fit_id:string
  source_fit_digest_sha256:string
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
  dataset_manifest_digest_sha256:string
  estimator_config_digest_sha256:string
  calibration_method:{method_id:string;method_version:string}
  calibration_payload:
    | {type:'categorical_confusion_model';model:SemanticConfusionModelV1}
    | {type:'score_calibrator';method:string;parameters:Record<string,number>}
    | null
  applicability_scope:{
    visibility:string[]
    capture_types:string[]
    viewpoints:string[]
    crop_types:string[]
    resolution:{min_width_px:number;min_height_px:number;max_width_px:number|null;max_height_px:number|null}
    occlusion_conditions:string[]
    glare_conditions:string[]
  }
  /**
   * Fit/calibration diagnostics only. Production admission authority lives in
   * the exact held-out validation object bound to this artifact digest.
   */
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

export type SemanticCalibrationArtifactDraftV1=Omit<SemanticCalibrationArtifactV1,'artifact_digest_sha256'>

export function semanticCalibrationArtifactDigest(
  artifact:SemanticCalibrationArtifactDraftV1|SemanticCalibrationArtifactV1,
):string{
  const {artifact_digest_sha256:_ignored,...payload}=artifact as SemanticCalibrationArtifactV1
  return sha256Canonical(payload)
}

export function finalizeSemanticCalibrationArtifact(
  draft:SemanticCalibrationArtifactDraftV1,
):SemanticCalibrationArtifactV1{
  return {...draft,artifact_digest_sha256:semanticCalibrationArtifactDigest(draft)}
}

export function semanticCalibrationArtifactDigestValid(artifact:SemanticCalibrationArtifactV1):boolean{
  return artifact.artifact_digest_sha256===semanticCalibrationArtifactDigest(artifact)
}

export interface BuildSemanticCalibrationArtifactFromFitInput {
  calibration_id:string
  version:string
  status:SemanticCalibrationArtifactStatus
  calibration_method:{method_id:string;method_version:string}
  applicability_scope:SemanticCalibrationArtifactV1['applicability_scope']
  metrics:SemanticCalibrationArtifactV1['metrics']
  eligibility_policy_version:string|null
}

export function buildSemanticCalibrationArtifactFromFit(
  fit:CandidateCalibrationFit,
  input:BuildSemanticCalibrationArtifactFromFitInput,
):SemanticCalibrationArtifactV1{
  if(fit.status!=='candidate_artifact'||!fit.model) throw new Error('candidate_fit_required_for_artifact')
  const identity=fit.estimator_config.sensor_identity
  return finalizeSemanticCalibrationArtifact({
    schema_version:SEMANTIC_CALIBRATION_SCHEMA,
    lineage_schema_version:SEMANTIC_CALIBRATION_LINEAGE_SCHEMA,
    calibration_id:input.calibration_id,
    version:input.version,
    source_fit_id:fit.fit_id,
    source_fit_digest_sha256:fit.fit_digest_sha256,
    status:input.status,
    sensor_identity:{
      sensor_type:identity.sensor_type,
      model:identity.model,
      model_version:identity.model_version,
      prompt_version:identity.prompt_version,
      extractor_version:identity.extractor_version,
    },
    feature_id:fit.feature_id,
    taxonomy_version:identity.taxonomy_version,
    dataset_id:fit.dataset_id,
    dataset_version:fit.dataset_version,
    dataset_manifest_digest_sha256:fit.dataset_manifest_digest_sha256,
    estimator_config_digest_sha256:fit.estimator_config_digest_sha256,
    calibration_method:input.calibration_method,
    calibration_payload:{type:'categorical_confusion_model',model:fit.model},
    applicability_scope:input.applicability_scope,
    metrics:input.metrics,
    eligibility_policy_version:input.eligibility_policy_version,
  })
}
