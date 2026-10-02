import {
  semanticCalibrationArtifactDigestValid,
  type SemanticCalibrationArtifactV1,
} from './semantic-calibration-v1'
import type { CalibrationDatasetValidation, SemanticCalibrationDatasetV1 } from './semantic-calibration-dataset-v1'
import {
  calibrationHeldOutValidationDigestValid,
  type CalibrationHeldOutValidation,
} from './semantic-calibration-validation'
import type { SemanticCalibrationEligibilityPolicyV1 } from './semantic-calibration-policy-v1'
import { isSha256 } from './semantic-calibration-digest'
import {
  SEMANTIC_CALIBRATION_LINEAGE_SCHEMA,
  sensorIdentityEquals,
  type CalibrationSensorIdentityV1,
} from './semantic-calibration-lineage-v1'

export const SEMANTIC_CALIBRATION_ADMISSION_SCHEMA='hcsi.semantic-calibration-admission.v1' as const

export interface CalibrationAdmissionAssessment {
  schema_version:typeof SEMANTIC_CALIBRATION_ADMISSION_SCHEMA
  lineage_schema_version:typeof SEMANTIC_CALIBRATION_LINEAGE_SCHEMA
  lineage_verified:boolean
  lifecycle:{
    candidate_artifact:boolean
    held_out_validated:boolean
    eligible_for_admission:boolean
    admitted_to_production_registry:false
    active:false
  }
  eligible_for_admission:boolean
  admitted_to_production_registry:false
  reason_codes:string[]
}

function artifactSensorIdentity(artifact:SemanticCalibrationArtifactV1):CalibrationSensorIdentityV1{
  return {...artifact.sensor_identity,taxonomy_version:artifact.taxonomy_version}
}

function overlaps(a:readonly string[],b:readonly string[]):boolean{
  const set=new Set(a)
  return b.some(value=>set.has(value))
}

export function assessCalibrationArtifactAdmission(
  artifact:SemanticCalibrationArtifactV1,
  dataset:SemanticCalibrationDatasetV1,
  datasetValidation:CalibrationDatasetValidation,
  validation:CalibrationHeldOutValidation,
  activePolicy:SemanticCalibrationEligibilityPolicyV1|null,
):CalibrationAdmissionAssessment{
  const reasons:string[]=[]
  const lineageReasons:string[]=[]

  if(!activePolicy||activePolicy.status!=='preregistered') reasons.push('active_preregistered_policy_missing')
  if(!datasetValidation.valid||!datasetValidation.production_eligible_source) reasons.push('dataset_not_production_eligible')
  if(dataset.source_scope!=='independent_real_image') reasons.push('dataset_not_independent_real_image')
  if(validation.status!=='validated'||validation.validation_used_for_tuning!==false) reasons.push('held_out_validation_missing')
  if(artifact.status!=='validated') reasons.push('artifact_not_validated')

  if(
    artifact.lineage_schema_version!==SEMANTIC_CALIBRATION_LINEAGE_SCHEMA||
    validation.lineage_schema_version!==SEMANTIC_CALIBRATION_LINEAGE_SCHEMA||
    !isSha256(artifact.source_fit_digest_sha256)||
    !isSha256(artifact.dataset_manifest_digest_sha256)||
    !isSha256(artifact.estimator_config_digest_sha256)||
    !isSha256(validation.source_fit_digest_sha256)||
    !isSha256(validation.dataset_manifest_digest_sha256)||
    !isSha256(validation.estimator_config_digest_sha256)
  ) lineageReasons.push('validation_lineage_missing')

  if(!semanticCalibrationArtifactDigestValid(artifact)) lineageReasons.push('artifact_digest_invalid')
  if(!calibrationHeldOutValidationDigestValid(validation)) lineageReasons.push('validation_digest_invalid')

  if(artifact.dataset_id!==dataset.dataset_id||artifact.dataset_version!==dataset.dataset_version){
    lineageReasons.push('artifact_dataset_identity_mismatch')
  }
  if(validation.dataset_id!==dataset.dataset_id||validation.dataset_version!==dataset.dataset_version){
    lineageReasons.push('validation_dataset_identity_mismatch')
  }
  if(artifact.dataset_id!==validation.dataset_id||artifact.dataset_version!==validation.dataset_version){
    lineageReasons.push('artifact_validation_dataset_mismatch')
  }
  if(
    artifact.dataset_manifest_digest_sha256!==dataset.manifest_digest_sha256||
    validation.dataset_manifest_digest_sha256!==dataset.manifest_digest_sha256||
    artifact.dataset_manifest_digest_sha256!==validation.dataset_manifest_digest_sha256
  ) lineageReasons.push('dataset_manifest_digest_mismatch')

  if(
    artifact.calibration_id!==validation.artifact_id||
    artifact.version!==validation.artifact_version||
    artifact.artifact_digest_sha256!==validation.artifact_digest_sha256
  ) lineageReasons.push('artifact_validation_artifact_mismatch')

  if(
    artifact.source_fit_id!==validation.source_fit_id||
    artifact.source_fit_digest_sha256!==validation.source_fit_digest_sha256
  ) lineageReasons.push('artifact_validation_fit_mismatch')

  if(artifact.estimator_config_digest_sha256!==validation.estimator_config_digest_sha256){
    lineageReasons.push('artifact_validation_estimator_mismatch')
  }
  if(artifact.feature_id!==validation.feature_id) lineageReasons.push('artifact_validation_feature_mismatch')
  if(!sensorIdentityEquals(artifactSensorIdentity(artifact),validation.sensor_identity)){
    lineageReasons.push('artifact_validation_sensor_identity_mismatch')
  }
  if(artifact.taxonomy_version!==validation.taxonomy_version){
    lineageReasons.push('artifact_validation_taxonomy_mismatch')
  }
  if((validation as CalibrationHeldOutValidation & {split:string}).split!=='validation'){
    lineageReasons.push('validation_split_mismatch')
  }
  if(
    overlaps(validation.source_fit_calibration_record_ids,validation.validation_record_ids)||
    overlaps(validation.source_fit_calibration_specimen_ids,validation.validation_specimen_ids)
  ){
    lineageReasons.push('validation_calibration_data_overlap')
  }
  if(validation.reason_codes.includes('validation_calibration_record_overlap')){
    lineageReasons.push('validation_calibration_data_overlap')
  }

  reasons.push(...lineageReasons)

  if(activePolicy){
    if(artifact.eligibility_policy_version!==activePolicy.policy_version) reasons.push('policy_version_mismatch')
    if(activePolicy.applicable_dataset_schema!==dataset.schema_version) reasons.push('policy_dataset_schema_mismatch')
    if(activePolicy.applicable_calibration_schema!==artifact.schema_version) reasons.push('policy_calibration_schema_mismatch')
    if(!activePolicy.allowed_source_scopes.includes(dataset.source_scope)) reasons.push('dataset_source_scope_not_allowed_by_policy')

    const support=activePolicy.minimum_support
    if(support.sample_count!==null&&validation.sample_count<support.sample_count) reasons.push('minimum_sample_support_not_met')
    if(support.per_class!==null){
      const counts=Object.values(validation.per_class_support)
      if(!counts.length||counts.some(n=>n<support.per_class!)) reasons.push('minimum_per_class_support_not_met')
    }

    // Production acceptance authority is exclusively the exact held-out
    // validation object bound above. artifact.metrics is diagnostic only.
    const metrics=activePolicy.metric_requirements
    if(metrics.max_brier_score!==null&&
       (validation.brier_score===null||validation.brier_score>metrics.max_brier_score)){
      reasons.push('brier_requirement_not_met')
      if(validation.brier_score===null) reasons.push('required_held_out_metric_unavailable')
    }
    if(metrics.max_log_loss!==null&&
       (validation.log_loss===null||validation.log_loss>metrics.max_log_loss)){
      reasons.push('log_loss_requirement_not_met')
      if(validation.log_loss===null) reasons.push('required_held_out_metric_unavailable')
    }
    if(metrics.max_ece!==null&&
       (validation.ece===null||validation.ece>metrics.max_ece)){
      reasons.push('ece_requirement_not_met')
      if(validation.ece===null) reasons.push('required_held_out_metric_unavailable')
    }
  }

  const unique=[...new Set(reasons)]
  const eligible=unique.length===0
  return {
    schema_version:SEMANTIC_CALIBRATION_ADMISSION_SCHEMA,
    lineage_schema_version:SEMANTIC_CALIBRATION_LINEAGE_SCHEMA,
    lineage_verified:lineageReasons.length===0,
    lifecycle:{
      candidate_artifact:true,
      held_out_validated:validation.status==='validated',
      eligible_for_admission:eligible,
      admitted_to_production_registry:false,
      active:false,
    },
    eligible_for_admission:eligible,
    admitted_to_production_registry:false,
    reason_codes:unique,
  }
}
