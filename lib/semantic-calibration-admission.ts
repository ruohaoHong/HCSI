import type { SemanticCalibrationArtifactV1 } from './semantic-calibration-v1'
import type { CalibrationDatasetValidation, SemanticCalibrationDatasetV1 } from './semantic-calibration-dataset-v1'
import type { CalibrationHeldOutValidation } from './semantic-calibration-validation'
import type { SemanticCalibrationEligibilityPolicyV1 } from './semantic-calibration-policy-v1'

export const SEMANTIC_CALIBRATION_ADMISSION_SCHEMA='hcsi.semantic-calibration-admission.v1' as const

export interface CalibrationAdmissionAssessment {
  schema_version:typeof SEMANTIC_CALIBRATION_ADMISSION_SCHEMA
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

export function assessCalibrationArtifactAdmission(
  artifact:SemanticCalibrationArtifactV1,
  dataset:SemanticCalibrationDatasetV1,
  datasetValidation:CalibrationDatasetValidation,
  validation:CalibrationHeldOutValidation,
  activePolicy:SemanticCalibrationEligibilityPolicyV1|null,
):CalibrationAdmissionAssessment{
  const reasons:string[]=[]
  if(!activePolicy||activePolicy.status!=='preregistered') reasons.push('active_preregistered_policy_missing')
  if(!datasetValidation.valid||!datasetValidation.production_eligible_source) reasons.push('dataset_not_production_eligible')
  if(dataset.source_scope!=='independent_real_image') reasons.push('dataset_not_independent_real_image')
  if(validation.status!=='validated'||validation.validation_used_for_tuning!==false) reasons.push('held_out_validation_missing')
  if(artifact.status!=='validated') reasons.push('artifact_not_validated')

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
    const metrics=activePolicy.metric_requirements,m=artifact.metrics
    if(metrics.max_brier_score!==null&&(m.brier_score===null||m.brier_score>metrics.max_brier_score)) reasons.push('brier_requirement_not_met')
    if(metrics.max_log_loss!==null&&(m.log_loss===null||m.log_loss>metrics.max_log_loss)) reasons.push('log_loss_requirement_not_met')
    if(metrics.max_ece!==null&&(m.ece===null||m.ece>metrics.max_ece)) reasons.push('ece_requirement_not_met')
  }

  const eligible=reasons.length===0
  return {
    schema_version:SEMANTIC_CALIBRATION_ADMISSION_SCHEMA,
    lifecycle:{
      candidate_artifact:true,
      held_out_validated:validation.status==='validated',
      eligible_for_admission:eligible,
      admitted_to_production_registry:false,
      active:false,
    },
    eligible_for_admission:eligible,
    admitted_to_production_registry:false,
    reason_codes:[...new Set(reasons)],
  }
}
