import type { SemanticCalibrationArtifactV1 } from './semantic-calibration-v1'
import type { CalibrationDatasetValidation, SemanticCalibrationDatasetV1 } from './semantic-calibration-dataset-v1'
import type { SemanticFeatureId } from './semantic-taxonomy-v1'
import type { SemanticSensorType } from './semantic-evidence-v1'
import type { SemanticCalibrationEligibilityPolicyV1 } from './semantic-calibration-policy-v1'

export interface SemanticRuntimeCalibrationContext {
  feature_id:SemanticFeatureId
  sensor_type:SemanticSensorType
  model:string
  model_version:string
  prompt_version:string
  extractor_version:string
  taxonomy_version:string
  quality:{
    visibility:string
    capture_type:string
    viewpoint:string
    crop_type:string
    width_px:number|null
    height_px:number|null
    occlusion_condition:string
    glare_condition:string
  }
}
export interface SemanticLikelihoodEligibility {
  likelihood_eligible:boolean
  calibration_applicability:'applicable'|'mismatch'|'out_of_scope'|'unavailable'
  reason_codes:string[]
}

function exactIdentityMatches(runtime:SemanticRuntimeCalibrationContext,artifact:SemanticCalibrationArtifactV1){
  const id=artifact.sensor_identity
  return runtime.feature_id===artifact.feature_id&&
    runtime.sensor_type===id.sensor_type&&
    runtime.model===id.model&&
    runtime.model_version===id.model_version&&
    runtime.prompt_version===id.prompt_version&&
    runtime.extractor_version===id.extractor_version&&
    runtime.taxonomy_version===artifact.taxonomy_version
}

function qualityInScope(runtime:SemanticRuntimeCalibrationContext,artifact:SemanticCalibrationArtifactV1){
  const q=runtime.quality,s=artifact.applicability_scope
  if(q.width_px===null||q.height_px===null) return false
  return s.visibility.includes(q.visibility)&&
    s.capture_types.includes(q.capture_type)&&
    s.viewpoints.includes(q.viewpoint)&&
    s.crop_types.includes(q.crop_type)&&
    s.occlusion_conditions.includes(q.occlusion_condition)&&
    s.glare_conditions.includes(q.glare_condition)&&
    q.width_px>=s.resolution.min_width_px&&q.height_px>=s.resolution.min_height_px&&
    (s.resolution.max_width_px===null||q.width_px<=s.resolution.max_width_px)&&
    (s.resolution.max_height_px===null||q.height_px<=s.resolution.max_height_px)
}

export function assessSemanticLikelihoodEligibility(
  runtime:SemanticRuntimeCalibrationContext,
  artifact:SemanticCalibrationArtifactV1|null,
  dataset:SemanticCalibrationDatasetV1|null,
  datasetValidation:CalibrationDatasetValidation|null,
  policy:SemanticCalibrationEligibilityPolicyV1|null,
):SemanticLikelihoodEligibility{
  const reasons:string[]=[]
  if(!artifact){
    return {likelihood_eligible:false,calibration_applicability:'unavailable',reason_codes:['no_applicable_validated_calibration_artifact']}
  }
  if(!exactIdentityMatches(runtime,artifact)) reasons.push('artifact_identity_mismatch')
  if(artifact.status!=='validated') reasons.push('calibration_artifact_not_validated')
  if(!policy||policy.status!=='preregistered'){
    reasons.push('active_preregistered_policy_missing')
  }else{
    if(artifact.eligibility_policy_version!==policy.policy_version) reasons.push('policy_version_mismatch')
    if(policy.applicable_dataset_schema!==(dataset?.schema_version??null)) reasons.push('policy_dataset_schema_mismatch')
    if(policy.applicable_calibration_schema!==artifact.schema_version) reasons.push('policy_calibration_schema_mismatch')
    if(dataset&&!policy.allowed_source_scopes.includes(dataset.source_scope)) reasons.push('dataset_source_scope_not_allowed_by_policy')
    if(policy.required_split_policy.unit!=='physical_specimen') reasons.push('policy_split_unit_invalid')
    if(policy.required_gt_policy.independently_verified!==true||
       policy.required_gt_policy.same_sensor_self_label_forbidden!==true||
       policy.required_gt_policy.provenance_required!==true) reasons.push('policy_gt_requirements_invalid')
  }
  if(!dataset||!datasetValidation){
    reasons.push('calibration_dataset_unavailable')
  }else{
    if(!datasetValidation.valid) reasons.push('calibration_dataset_invalid')
    if(!datasetValidation.production_eligible_source||dataset.source_scope!=='independent_real_image'){
      reasons.push('calibration_dataset_not_independent_real_image')
    }
  }
  if(runtime.quality.width_px===null||runtime.quality.height_px===null||
     runtime.quality.capture_type==='unknown'||runtime.quality.viewpoint==='unknown'||
     runtime.quality.crop_type==='unknown'){
    reasons.push('runtime_quality_unknown')
  }
  if(!qualityInScope(runtime,artifact)) reasons.push('runtime_quality_out_of_scope')

  if(policy){
    const support=policy.minimum_support
    if(support.sample_count!==null&&artifact.metrics.sample_count<support.sample_count) reasons.push('minimum_sample_support_not_met')
    if(support.per_class!==null&&Object.values(artifact.metrics.per_class_support).some(n=>n<support.per_class!)) reasons.push('minimum_per_class_support_not_met')
    const metrics=policy.metric_requirements
    if(metrics.max_brier_score!==null&&(artifact.metrics.brier_score===null||artifact.metrics.brier_score>metrics.max_brier_score)) reasons.push('brier_requirement_not_met')
    if(metrics.max_log_loss!==null&&(artifact.metrics.log_loss===null||artifact.metrics.log_loss>metrics.max_log_loss)) reasons.push('log_loss_requirement_not_met')
    if(metrics.max_ece!==null&&(artifact.metrics.ece===null||artifact.metrics.ece>metrics.max_ece)) reasons.push('ece_requirement_not_met')
  }

  const mismatch=reasons.some(x=>x.includes('identity_mismatch')||x.endsWith('_mismatch'))
  const outOfScope=reasons.includes('runtime_quality_unknown')||reasons.includes('runtime_quality_out_of_scope')
  return {
    likelihood_eligible:reasons.length===0,
    calibration_applicability:mismatch?'mismatch':outOfScope?'out_of_scope':reasons.length?'unavailable':'applicable',
    reason_codes:[...new Set(reasons)],
  }
}
