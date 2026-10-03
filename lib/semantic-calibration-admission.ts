import {
  semanticCalibrationArtifactDigestValid,
  type SemanticCalibrationArtifactV1,
} from './semantic-calibration-v1'
import {
  validateSemanticCalibrationDataset,
  type CalibrationDatasetValidation,
  type SemanticCalibrationDatasetV1,
} from './semantic-calibration-dataset-v1'
import {
  calibrationHeldOutValidationDigestValid,
  type CalibrationHeldOutValidation,
} from './semantic-calibration-validation'
import {
  semanticCalibrationImageWithinPolicyEnvelope,
  validateSemanticCalibrationEligibilityPolicy,
  type ExplicitThresholdRequirement,
  type SemanticCalibrationEligibilityPolicyV1,
} from './semantic-calibration-policy-v1'
import { exactOneSidedClopperPearsonUpper } from './semantic-calibration-statistics'
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
  statistical_authority:{
    unit:'unique_physical_specimen'
    calibration_unique_specimens_per_class:Record<string,number>
    validation_unique_specimens_per_class:Record<string,number>
    validation_unique_errors_per_class:Record<string,number>
    validation_error_upper_bound_per_class:Record<string,number>
  }
}

function artifactSensorIdentity(artifact:SemanticCalibrationArtifactV1):CalibrationSensorIdentityV1{
  return {...artifact.sensor_identity,taxonomy_version:artifact.taxonomy_version}
}

function overlaps(a:readonly string[],b:readonly string[]):boolean{
  const set=new Set(a)
  return b.some(value=>set.has(value))
}

function sameCounts(a:Record<string,number>,b:Record<string,number>):boolean{
  const keys=[...new Set([...Object.keys(a),...Object.keys(b)])]
  return keys.every(key=>(a[key]??0)===(b[key]??0))
}

function artifactScopeWithinPolicy(
  artifact:SemanticCalibrationArtifactV1,
  policy:SemanticCalibrationEligibilityPolicyV1,
):boolean{
  const a=artifact.applicability_scope
  const p=policy.capture_applicability
  const subset=(values:readonly string[],allowed:readonly string[])=>
    values.length>0&&values.every(value=>allowed.includes(value))
  const maxWithin=(artifactMax:number|null,policyMax:number|null)=>
    policyMax===null||artifactMax!==null&&artifactMax<=policyMax
  return subset(a.visibility,p.visibility)&&
    subset(a.capture_types,p.capture_types)&&
    subset(a.viewpoints,p.viewpoints)&&
    subset(a.crop_types,p.crop_types)&&
    subset(a.occlusion_conditions,p.occlusion_conditions)&&
    subset(a.glare_conditions,p.glare_conditions)&&
    a.resolution.min_width_px>=p.resolution.min_width_px&&
    a.resolution.min_height_px>=p.resolution.min_height_px&&
    maxWithin(a.resolution.max_width_px,p.resolution.max_width_px)&&
    maxWithin(a.resolution.max_height_px,p.resolution.max_height_px)
}

function metricRequirementReasons(
  name:'brier_score'|'log_loss'|'ece',
  requirement:ExplicitThresholdRequirement,
  value:number|null,
):string[]{
  if(!requirement.required) return []
  if(requirement.threshold===null) return [`${name}_required_threshold_missing`]
  if(value===null) return [`${name}_requirement_not_met`,'required_held_out_metric_unavailable']
  return value>requirement.threshold?[`${name}_requirement_not_met`]:[]
}

function datasetGtFor(
  dataset:SemanticCalibrationDatasetV1,
  specimenId:string,
  featureId:string,
):string|null{
  const specimen=dataset.specimens.find(item=>item.specimen_id===specimenId)
  return specimen?.ground_truth.find(gt=>gt.feature_id===featureId)?.value??null
}

function calibrationSupport(
  dataset:SemanticCalibrationDatasetV1,
  validation:CalibrationHeldOutValidation,
  policy:SemanticCalibrationEligibilityPolicyV1,
  reasons:string[],
):{perClass:Record<string,number>;specimenIds:Set<string>}{
  const support=new Map<string,Set<string>>()
  const allSpecimens=new Set<string>()
  for(const binding of validation.source_fit_calibration_observation_bindings){
    const specimen=dataset.specimens.find(item=>item.specimen_id===binding.specimen_id)
    const image=specimen?.images.find(item=>item.image_id===binding.image_id)
    if(!specimen||!image||image.split!=='calibration'){
      reasons.push('calibration_observation_binding_invalid')
      continue
    }
    if(!semanticCalibrationImageWithinPolicyEnvelope(image,policy)) continue
    const gt=datasetGtFor(dataset,binding.specimen_id,policy.required_feature_id)
    if(!gt||!policy.minimum_support.required_classes.includes(gt)) continue
    allSpecimens.add(binding.specimen_id)
    const classSet=support.get(gt)??new Set<string>()
    classSet.add(binding.specimen_id)
    support.set(gt,classSet)
  }
  return {
    perClass:Object.fromEntries([...support.entries()].map(([key,value])=>[key,value.size])),
    specimenIds:allSpecimens,
  }
}

function validationSupport(
  dataset:SemanticCalibrationDatasetV1,
  validation:CalibrationHeldOutValidation,
  policy:SemanticCalibrationEligibilityPolicyV1,
  reasons:string[],
):{
  perClass:Record<string,number>
  errorsPerClass:Record<string,number>
  specimenIds:Set<string>
}{
  const specimens=new Map<string,{gt:string;error:boolean}>()
  for(const outcome of validation.validation_observation_outcomes){
    const specimen=dataset.specimens.find(item=>item.specimen_id===outcome.specimen_id)
    const image=specimen?.images.find(item=>item.image_id===outcome.image_id)
    if(!specimen||!image||image.split!=='validation'){
      reasons.push('validation_observation_binding_invalid')
      continue
    }
    if(!semanticCalibrationImageWithinPolicyEnvelope(image,policy)) continue
    const gt=datasetGtFor(dataset,outcome.specimen_id,policy.required_feature_id)
    if(!gt||!policy.minimum_support.required_classes.includes(gt)) continue
    if(outcome.gt_class!==gt) reasons.push('validation_outcome_gt_mismatch')
    const prior=specimens.get(outcome.specimen_id)
    if(prior&&prior.gt!==gt) reasons.push('validation_specimen_gt_inconsistent')
    specimens.set(outcome.specimen_id,{gt,error:(prior?.error??false)||outcome.error})
  }
  const perClass:Record<string,number>={}
  const errorsPerClass:Record<string,number>={}
  for(const {gt,error} of specimens.values()){
    perClass[gt]=(perClass[gt]??0)+1
    if(error) errorsPerClass[gt]=(errorsPerClass[gt]??0)+1
  }
  return {perClass,errorsPerClass,specimenIds:new Set(specimens.keys())}
}

export function assessCalibrationArtifactAdmission(
  artifact:SemanticCalibrationArtifactV1,
  dataset:SemanticCalibrationDatasetV1,
  _datasetValidation:CalibrationDatasetValidation,
  validation:CalibrationHeldOutValidation,
  activePolicy:SemanticCalibrationEligibilityPolicyV1|null,
):CalibrationAdmissionAssessment{
  const reasons:string[]=[]
  const lineageReasons:string[]=[]
  const currentDatasetValidation=validateSemanticCalibrationDataset(dataset)

  const emptyAuthority={
    unit:'unique_physical_specimen' as const,
    calibration_unique_specimens_per_class:{} as Record<string,number>,
    validation_unique_specimens_per_class:{} as Record<string,number>,
    validation_unique_errors_per_class:{} as Record<string,number>,
    validation_error_upper_bound_per_class:{} as Record<string,number>,
  }

  if(!activePolicy){
    reasons.push('active_preregistered_policy_missing')
  }else{
    if(activePolicy.status!=='preregistered') reasons.push('active_preregistered_policy_missing')
    const policyValidation=validateSemanticCalibrationEligibilityPolicy(activePolicy)
    if(!policyValidation.valid) reasons.push('active_policy_invalid',...policyValidation.reason_codes)
  }

  if(!currentDatasetValidation.valid){
    reasons.push('dataset_not_production_eligible',...currentDatasetValidation.reason_codes)
  }else if(!currentDatasetValidation.production_eligible_source){
    reasons.push('dataset_not_production_eligible')
  }

  if(validation.status!=='validated'||validation.validation_used_for_tuning!==false||
     validation.estimator_locked_before_validation!==true){
    reasons.push('held_out_validation_missing')
  }
  if(artifact.status!=='validated') reasons.push('artifact_not_validated')

  if(
    artifact.lineage_schema_version!==SEMANTIC_CALIBRATION_LINEAGE_SCHEMA||
    validation.lineage_schema_version!==SEMANTIC_CALIBRATION_LINEAGE_SCHEMA||
    !isSha256(artifact.source_fit_digest_sha256)||
    !isSha256(artifact.dataset_manifest_digest_sha256)||
    !isSha256(artifact.dataset_content_digest_sha256)||
    !isSha256(artifact.estimator_config_digest_sha256)||
    !isSha256(validation.source_fit_digest_sha256)||
    !isSha256(validation.dataset_manifest_digest_sha256)||
    !isSha256(validation.dataset_content_digest_sha256)||
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
    artifact.dataset_content_digest_sha256!==dataset.dataset_content_digest_sha256||
    validation.dataset_content_digest_sha256!==dataset.dataset_content_digest_sha256||
    artifact.dataset_content_digest_sha256!==validation.dataset_content_digest_sha256
  ) lineageReasons.push('dataset_content_digest_mismatch')

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
  if(validation.split!=='validation') lineageReasons.push('validation_split_mismatch')
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

  if(!activePolicy){
    const unique=[...new Set(reasons)]
    return {
      schema_version:SEMANTIC_CALIBRATION_ADMISSION_SCHEMA,
      lineage_schema_version:SEMANTIC_CALIBRATION_LINEAGE_SCHEMA,
      lineage_verified:lineageReasons.length===0,
      lifecycle:{
        candidate_artifact:true,
        held_out_validated:validation.status==='validated',
        eligible_for_admission:false,
        admitted_to_production_registry:false,
        active:false,
      },
      eligible_for_admission:false,
      admitted_to_production_registry:false,
      reason_codes:unique,
      statistical_authority:emptyAuthority,
    }
  }

  if(artifact.eligibility_policy_version!==activePolicy.policy_version) reasons.push('policy_version_mismatch')
  if(activePolicy.applicable_dataset_schema!==dataset.schema_version) reasons.push('policy_dataset_schema_mismatch')
  if(activePolicy.applicable_calibration_schema!==artifact.schema_version) reasons.push('policy_calibration_schema_mismatch')
  if(!activePolicy.allowed_source_scopes.includes(dataset.source_scope)){
    reasons.push('dataset_source_scope_not_allowed_by_policy')
  }

  const requiredIdentity=activePolicy.required_sensor_identity
  if(artifact.feature_id!==activePolicy.required_feature_id) reasons.push('policy_feature_mismatch')
  if(!sensorIdentityEquals(artifactSensorIdentity(artifact),requiredIdentity)){
    reasons.push('policy_sensor_identity_mismatch')
  }
  if(artifact.taxonomy_version!==requiredIdentity.taxonomy_version) reasons.push('policy_taxonomy_mismatch')
  if(!artifactScopeWithinPolicy(artifact,activePolicy)) reasons.push('artifact_applicability_exceeds_policy')

  const splitPresence={
    calibration:dataset.specimens.some(s=>s.images.some(i=>i.split==='calibration')),
    validation:dataset.specimens.some(s=>s.images.some(i=>i.split==='validation')),
  }
  if(activePolicy.required_split_policy.calibration_required&&!splitPresence.calibration){
    reasons.push('required_calibration_split_missing')
  }
  if(activePolicy.required_split_policy.validation_required&&!splitPresence.validation){
    reasons.push('required_validation_split_missing')
  }
  if(dataset.specimens.some(s=>new Set(s.images.map(i=>i.split)).size>1)){
    reasons.push('physical_specimen_crosses_splits')
  }

  for(const specimen of dataset.specimens){
    const gt=specimen.ground_truth.find(item=>item.feature_id===activePolicy.required_feature_id)
    if(!gt) continue
    if(gt.self_labeled_by_sensor!==false) reasons.push('ground_truth_self_label_forbidden')
    if(!gt.gt_source?.trim()||!gt.verification_method?.trim()||!gt.annotator_or_fixture_provenance?.trim()){
      reasons.push('ground_truth_provenance_missing')
    }
  }

  const cal=calibrationSupport(dataset,validation,activePolicy,reasons)
  const val=validationSupport(dataset,validation,activePolicy,reasons)
  if(overlaps([...cal.specimenIds],[...val.specimenIds])) reasons.push('validation_calibration_data_overlap')

  if(validation.source_fit_unique_calibration_specimen_count!==cal.specimenIds.size||
     !sameCounts(validation.source_fit_unique_calibration_specimens_per_class,cal.perClass)){
    reasons.push('calibration_unique_support_summary_mismatch')
  }
  if(validation.unique_validation_specimen_count!==val.specimenIds.size||
     !sameCounts(validation.unique_validation_specimens_per_class,val.perClass)){
    reasons.push('validation_unique_support_summary_mismatch')
  }
  if(!sameCounts(validation.unique_validation_errors_per_class,val.errorsPerClass)){
    reasons.push('validation_unique_error_summary_mismatch')
  }

  const support=activePolicy.minimum_support
  const calMinimum=support.calibration_unique_specimens_per_class
  const valMinimum=support.validation_unique_specimens_per_class
  if(calMinimum.required&&calMinimum.minimum===null) reasons.push('required_calibration_support_not_configured')
  if(valMinimum.required&&valMinimum.minimum===null) reasons.push('required_validation_support_not_configured')

  const bounds:Record<string,number>={}
  const risk=activePolicy.held_out_error_requirement
  if(risk.required&&(
    risk.maximum_error_risk===null||risk.confidence_level===null
  )){
    reasons.push('required_held_out_error_policy_not_configured')
  }

  for(const gtClass of support.required_classes){
    const calN=cal.perClass[gtClass]??0
    const valN=val.perClass[gtClass]??0
    if(calMinimum.required&&calMinimum.minimum!==null&&calN<calMinimum.minimum){
      reasons.push(`minimum_calibration_unique_specimen_support_not_met:${gtClass}`)
    }
    if(valMinimum.required&&valMinimum.minimum!==null&&valN<valMinimum.minimum){
      reasons.push(`minimum_validation_unique_specimen_support_not_met:${gtClass}`)
    }
    if(risk.required&&risk.maximum_error_risk!==null&&risk.confidence_level!==null&&valN>0){
      const errors=val.errorsPerClass[gtClass]??0
      const upper=exactOneSidedClopperPearsonUpper(errors,valN,risk.confidence_level)
      bounds[gtClass]=upper
      if(upper>risk.maximum_error_risk){
        reasons.push(`held_out_error_upper_bound_exceeded:${gtClass}`)
      }
    }else if(risk.required&&valN===0){
      reasons.push(`held_out_error_bound_unavailable:${gtClass}`)
    }
  }

  reasons.push(
    ...metricRequirementReasons('brier_score',activePolicy.metric_requirements.brier_score,validation.brier_score),
    ...metricRequirementReasons('log_loss',activePolicy.metric_requirements.log_loss,validation.log_loss),
    ...metricRequirementReasons('ece',activePolicy.metric_requirements.ece,validation.ece),
  )

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
    statistical_authority:{
      unit:'unique_physical_specimen',
      calibration_unique_specimens_per_class:cal.perClass,
      validation_unique_specimens_per_class:val.perClass,
      validation_unique_errors_per_class:val.errorsPerClass,
      validation_error_upper_bound_per_class:bounds,
    },
  }
}
