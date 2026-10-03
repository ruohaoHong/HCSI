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
  production_support:{
    calibration_unique_specimens_per_class:Record<string,number>
    validation_unique_specimens_per_class:Record<string,number>
    validation_errors_per_class:Record<string,number>
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

function specimenGt(
  dataset:SemanticCalibrationDatasetV1,
  specimenId:string,
  featureId:string,
):string|null{
  const specimen=dataset.specimens.find(item=>item.specimen_id===specimenId)
  return specimen?.ground_truth.find(gt=>gt.feature_id===featureId)?.value??null
}

function boundImage(
  dataset:SemanticCalibrationDatasetV1,
  specimenId:string,
  imageId:string,
){
  return dataset.specimens.find(item=>item.specimen_id===specimenId)
    ?.images.find(image=>image.image_id===imageId)??null
}

function artifactScopeWithinPolicy(
  artifact:SemanticCalibrationArtifactV1,
  policy:SemanticCalibrationEligibilityPolicyV1,
):boolean{
  const a=artifact.applicability_scope
  const p=policy.capture_applicability
  const subset=(values:readonly string[],allowed:readonly string[])=>values.every(v=>allowed.includes(v))
  const maxWithin=(artifactMax:number|null,policyMax:number|null)=>
    policyMax===null||artifactMax!==null&&artifactMax<=policyMax
  return subset(a.capture_types,p.capture_types)&&
    subset(a.viewpoints,p.viewpoints)&&
    subset(a.crop_types,p.crop_types)&&
    subset(a.visibility,p.visibility)&&
    subset(a.occlusion_conditions,p.occlusion_conditions)&&
    subset(a.glare_conditions,p.glare_conditions)&&
    a.resolution.min_width_px>=p.resolution.min_width_px&&
    a.resolution.min_height_px>=p.resolution.min_height_px&&
    maxWithin(a.resolution.max_width_px,p.resolution.max_width_px)&&
    maxWithin(a.resolution.max_height_px,p.resolution.max_height_px)
}

function countCalibrationSupport(
  dataset:SemanticCalibrationDatasetV1,
  validation:CalibrationHeldOutValidation,
  policy:SemanticCalibrationEligibilityPolicyV1,
):Record<string,number>{
  const classes=new Set(policy.minimum_support.required_classes)
  const byClass=new Map<string,Set<string>>()
  for(const binding of validation.source_fit_calibration_observation_bindings){
    const image=boundImage(dataset,binding.specimen_id,binding.image_id)
    const gt=specimenGt(dataset,binding.specimen_id,policy.required_feature_id)
    if(!image||image.split!=='calibration'||!gt||!classes.has(gt)) continue
    if(!semanticCalibrationImageWithinPolicyEnvelope(image,policy)) continue
    const set=byClass.get(gt)??new Set<string>()
    set.add(binding.specimen_id)
    byClass.set(gt,set)
  }
  return Object.fromEntries([...byClass].map(([klass,ids])=>[klass,ids.size]))
}

function countValidationAuthority(
  dataset:SemanticCalibrationDatasetV1,
  validation:CalibrationHeldOutValidation,
  policy:SemanticCalibrationEligibilityPolicyV1,
):{
  support:Record<string,number>
  errors:Record<string,number>
  upper:Record<string,number>
}{
  const classes=new Set(policy.minimum_support.required_classes)
  const specimenOutcomes=new Map<string,{gt:string;error:boolean}>()
  for(const outcome of validation.validation_observation_outcomes){
    const image=boundImage(dataset,outcome.specimen_id,outcome.image_id)
    const gt=specimenGt(dataset,outcome.specimen_id,policy.required_feature_id)
    if(!image||image.split!=='validation'||!gt||!classes.has(gt)) continue
    if(!semanticCalibrationImageWithinPolicyEnvelope(image,policy)) continue
    if(outcome.gt_class!==gt) continue
    const prior=specimenOutcomes.get(outcome.specimen_id)
    if(!prior) specimenOutcomes.set(outcome.specimen_id,{gt,error:outcome.error})
    else specimenOutcomes.set(outcome.specimen_id,{gt:prior.gt,error:prior.error||outcome.error})
  }
  const support:Record<string,number>={}
  const errors:Record<string,number>={}
  for(const outcome of specimenOutcomes.values()){
    support[outcome.gt]=(support[outcome.gt]??0)+1
    if(outcome.error) errors[outcome.gt]=(errors[outcome.gt]??0)+1
  }
  const upper:Record<string,number>={}
  const risk=policy.held_out_error_requirement
  if(risk.required&&risk.confidence_level!==null){
    for(const klass of policy.minimum_support.required_classes){
      const n=support[klass]??0
      if(n>0) upper[klass]=exactOneSidedClopperPearsonUpper(errors[klass]??0,n,risk.confidence_level)
    }
  }
  return {support,errors,upper}
}

function requiredMetric(
  reasons:string[],
  name:'brier_score'|'log_loss'|'ece',
  requirement:{required:boolean;threshold:number|null},
  value:number|null,
){
  if(!requirement.required) return
  if(requirement.threshold===null){
    reasons.push(`required_${name}_threshold_not_configured`)
    return
  }
  if(value===null||value>requirement.threshold){
    reasons.push(`${name}_requirement_not_met`)
    if(value===null) reasons.push('required_held_out_metric_unavailable')
  }
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
  if(dataset.source_scope!=='independent_real_image') reasons.push('dataset_not_independent_real_image')
  if(validation.status!=='validated'||validation.validation_used_for_tuning!==false){
    reasons.push('held_out_validation_missing')
  }
  if(validation.estimator_locked_before_validation!==true) reasons.push('estimator_not_locked_before_validation')
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

  let calibrationSupport:Record<string,number>={}
  let validationSupport:Record<string,number>={}
  let validationErrors:Record<string,number>={}
  let validationUpper:Record<string,number>={}

  if(activePolicy){
    if(artifact.eligibility_policy_version!==activePolicy.policy_version) reasons.push('policy_version_mismatch')
    if(activePolicy.applicable_dataset_schema!==dataset.schema_version) reasons.push('policy_dataset_schema_mismatch')
    if(activePolicy.applicable_calibration_schema!==artifact.schema_version) reasons.push('policy_calibration_schema_mismatch')
    if(!activePolicy.allowed_source_scopes.includes(dataset.source_scope)){
      reasons.push('dataset_source_scope_not_allowed_by_policy')
    }
    if(artifact.feature_id!==activePolicy.required_feature_id) reasons.push('policy_feature_mismatch')
    if(!sensorIdentityEquals(artifactSensorIdentity(artifact),activePolicy.required_sensor_identity)){
      reasons.push('policy_sensor_identity_mismatch')
    }
    if(!artifactScopeWithinPolicy(artifact,activePolicy)){
      reasons.push('artifact_applicability_exceeds_policy')
    }

    const calibrationSplitSpecimens=dataset.specimens.filter(s=>s.images.some(i=>i.split==='calibration'))
    const validationSplitSpecimens=dataset.specimens.filter(s=>s.images.some(i=>i.split==='validation'))
    if(activePolicy.required_split_policy.calibration_required&&calibrationSplitSpecimens.length===0){
      reasons.push('required_calibration_split_missing')
    }
    if(activePolicy.required_split_policy.validation_required&&validationSplitSpecimens.length===0){
      reasons.push('required_validation_split_missing')
    }

    calibrationSupport=countCalibrationSupport(dataset,validation,activePolicy)
    const heldOut=countValidationAuthority(dataset,validation,activePolicy)
    validationSupport=heldOut.support
    validationErrors=heldOut.errors
    validationUpper=heldOut.upper

    const support=activePolicy.minimum_support
    const calibrationMinimum=support.calibration_unique_specimens_per_class.minimum
    const validationMinimum=support.validation_unique_specimens_per_class.minimum
    if(support.calibration_unique_specimens_per_class.required&&calibrationMinimum===null){
      reasons.push('required_calibration_support_not_configured')
    }
    if(support.validation_unique_specimens_per_class.required&&validationMinimum===null){
      reasons.push('required_validation_support_not_configured')
    }

    let totalCalibration=0,totalValidation=0
    for(const klass of support.required_classes){
      const c=calibrationSupport[klass]??0
      const v=validationSupport[klass]??0
      totalCalibration+=c
      totalValidation+=v
      if(calibrationMinimum!==null&&c<calibrationMinimum){
        reasons.push('minimum_calibration_unique_specimen_support_not_met')
        reasons.push(`minimum_calibration_support_not_met:${klass}`)
      }
      if(validationMinimum!==null&&v<validationMinimum){
        reasons.push('minimum_validation_unique_specimen_support_not_met')
        reasons.push(`minimum_validation_support_not_met:${klass}`)
      }

      const risk=activePolicy.held_out_error_requirement
      if(risk.required){
        if(risk.maximum_error_risk===null||risk.confidence_level===null){
          reasons.push('required_held_out_error_policy_not_configured')
        }else if(v>0){
          const upper=validationUpper[klass]
          if(upper===undefined||upper>risk.maximum_error_risk){
            reasons.push('held_out_error_risk_requirement_not_met')
            reasons.push(`held_out_error_risk_requirement_not_met:${klass}`)
          }
        }
      }
    }

    if(calibrationMinimum!==null&&totalCalibration<calibrationMinimum*support.required_classes.length){
      reasons.push('minimum_total_calibration_unique_specimen_support_not_met')
    }
    if(validationMinimum!==null&&totalValidation<validationMinimum*support.required_classes.length){
      reasons.push('minimum_total_validation_unique_specimen_support_not_met')
    }

    // Stored summary counts are diagnostic mirrors only; mismatch is evidence
    // that the held-out object is internally inconsistent and must fail closed.
    const recomputedValidationTotal=Object.values(validationSupport).reduce((a,b)=>a+b,0)
    if(validation.unique_validation_specimen_count!==new Set(validation.validation_specimen_ids).size){
      reasons.push('validation_unique_support_summary_mismatch')
    }
    if(recomputedValidationTotal>validation.unique_validation_specimen_count){
      reasons.push('validation_unique_support_summary_mismatch')
    }
    if(validation.source_fit_unique_calibration_specimen_count!==new Set(validation.source_fit_calibration_specimen_ids).size){
      reasons.push('calibration_unique_support_summary_mismatch')
    }

    requiredMetric(
      reasons,'brier_score',activePolicy.metric_requirements.brier_score,validation.brier_score,
    )
    requiredMetric(
      reasons,'log_loss',activePolicy.metric_requirements.log_loss,validation.log_loss,
    )
    requiredMetric(
      reasons,'ece',activePolicy.metric_requirements.ece,validation.ece,
    )
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
    production_support:{
      calibration_unique_specimens_per_class:calibrationSupport,
      validation_unique_specimens_per_class:validationSupport,
      validation_errors_per_class:validationErrors,
      validation_error_upper_bound_per_class:validationUpper,
    },
  }
}
