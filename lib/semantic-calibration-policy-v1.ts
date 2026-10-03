import { sha256Canonical,isSha256 } from './semantic-calibration-digest'
import type { CalibrationDatasetSourceScope,SemanticCalibrationImage } from './semantic-calibration-dataset-v1'
import type { CalibrationSensorIdentityV1 } from './semantic-calibration-lineage-v1'
import {
  SEMANTIC_TAXONOMY_VERSION,
  isSemanticFeatureId,
  isSemanticTaxonomyValue,
  type SemanticFeatureId,
} from './semantic-taxonomy-v1'

export const SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_SCHEMA='hcsi.semantic-calibration-eligibility-policy.v1' as const
export const SEMANTIC_CALIBRATION_CAPTURE_VOCABULARY_VERSION='hcsi.semantic-calibration-capture-conditions.v1' as const

export const PRODUCTION_DRIVE_FORM_REQUIRED_CLASSES=[
  'phillips_like',
  'pozidriv_like',
  'slotted',
  'hex_socket',
  'torx_like',
  'square_like',
  'external_hex',
  'combination',
] as const

export interface ExplicitMinimumRequirement {
  required:boolean
  minimum:number|null
}
export interface ExplicitThresholdRequirement {
  required:boolean
  threshold:number|null
}

export interface SemanticCalibrationEligibilityPolicyV1 {
  schema_version:typeof SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_SCHEMA
  policy_id:string
  policy_version:string
  policy_content_digest_sha256:string
  status:'draft_not_preregistered'|'preregistered'|'retired'
  created_at:string
  locked_at:string|null
  applicable_dataset_schema:string
  applicable_calibration_schema:string
  allowed_source_scopes:CalibrationDatasetSourceScope[]
  required_feature_id:SemanticFeatureId
  required_sensor_identity:CalibrationSensorIdentityV1
  required_split_policy:{
    unit:'physical_specimen'
    calibration_required:boolean
    validation_required:boolean
    specimen_may_cross_splits:false
  }
  required_gt_policy:{
    independently_verified:true
    same_sensor_self_label_forbidden:true
    provenance_required:true
  }
  minimum_support:{
    statistical_unit:'unique_physical_specimen'
    required_classes:string[]
    calibration_unique_specimens_per_class:ExplicitMinimumRequirement
    validation_unique_specimens_per_class:ExplicitMinimumRequirement
  }
  held_out_error_requirement:{
    required:boolean
    maximum_error_risk:number|null
    confidence_level:number|null
    confidence_side:'one_sided_upper'|null
    method:'exact_clopper_pearson'|null
  }
  metric_requirements:{
    brier_score:ExplicitThresholdRequirement
    log_loss:ExplicitThresholdRequirement
    ece:ExplicitThresholdRequirement
  }
  capture_applicability:{
    vocabulary_version:typeof SEMANTIC_CALIBRATION_CAPTURE_VOCABULARY_VERSION
    capture_types:string[]
    crop_types:string[]
    viewpoints:string[]
    visibility:string[]
    occlusion_conditions:string[]
    glare_conditions:string[]
    resolution:{min_width_px:number;min_height_px:number;max_width_px:number|null;max_height_px:number|null}
  }
  quality_coverage_requirements:{required:boolean;description:string}
  artifact_identity_requirements:{
    exact_sensor_identity:true
    exact_feature:true
    exact_taxonomy:true
    applicability_must_not_exceed_policy:true
  }
  admission_rules:string[]
  change_control:{
    requires_new_version:true
    validation_set_must_not_tune_estimator:true
  }
}

export type SemanticCalibrationEligibilityPolicyDraftV1=
  Omit<SemanticCalibrationEligibilityPolicyV1,'policy_content_digest_sha256'>

export function semanticCalibrationEligibilityPolicyDigest(
  policy:SemanticCalibrationEligibilityPolicyDraftV1|SemanticCalibrationEligibilityPolicyV1,
):string{
  const {policy_content_digest_sha256:_digest,...content}=policy as SemanticCalibrationEligibilityPolicyV1
  return sha256Canonical(content)
}

export function finalizeSemanticCalibrationEligibilityPolicy(
  draft:SemanticCalibrationEligibilityPolicyDraftV1,
):SemanticCalibrationEligibilityPolicyV1{
  return {...draft,policy_content_digest_sha256:semanticCalibrationEligibilityPolicyDigest(draft)}
}

export interface SemanticCalibrationPolicyValidation {
  valid:boolean
  reason_codes:string[]
}

function validTimestamp(value:string|null):boolean{
  return typeof value==='string'&&Number.isFinite(Date.parse(value))
}
function validMinimumRequirement(req:ExplicitMinimumRequirement):boolean{
  if(req.required) return Number.isInteger(req.minimum)&&req.minimum!>0
  return req.minimum===null
}
function validMetricRequirement(req:ExplicitThresholdRequirement):boolean{
  if(req.required) return typeof req.threshold==='number'&&Number.isFinite(req.threshold)&&req.threshold>=0
  return req.threshold===null
}
function nonEmptyUnique(values:readonly string[]):boolean{
  return values.length>0&&new Set(values).size===values.length&&values.every(v=>typeof v==='string'&&v.trim().length>0)
}

export function validateSemanticCalibrationEligibilityPolicy(
  policy:SemanticCalibrationEligibilityPolicyV1,
):SemanticCalibrationPolicyValidation{
  const reasons:string[]=[]
  if(policy.schema_version!==SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_SCHEMA) reasons.push('policy_schema_mismatch')
  if(!policy.policy_id||!policy.policy_version) reasons.push('policy_identity_missing')
  if(!isSha256(policy.policy_content_digest_sha256)) reasons.push('policy_digest_invalid')
  else if(policy.policy_content_digest_sha256!==semanticCalibrationEligibilityPolicyDigest(policy)) reasons.push('policy_digest_mismatch')
  if(policy.status==='preregistered'&&!validTimestamp(policy.locked_at)) reasons.push('preregistered_policy_not_locked')
  if(!validTimestamp(policy.created_at)) reasons.push('policy_created_at_invalid')
  if(!policy.allowed_source_scopes.length||new Set(policy.allowed_source_scopes).size!==policy.allowed_source_scopes.length){
    reasons.push('policy_source_scope_invalid')
  }
  if(!isSemanticFeatureId(policy.required_feature_id)) reasons.push('policy_feature_invalid')
  const id=policy.required_sensor_identity
  if(!id||!id.sensor_type||!id.model||!id.model_version||!id.prompt_version||!id.extractor_version||!id.taxonomy_version){
    reasons.push('policy_sensor_identity_incomplete')
  }
  if(id?.taxonomy_version!==SEMANTIC_TAXONOMY_VERSION) reasons.push('policy_taxonomy_version_mismatch')
  if(policy.required_split_policy.unit!=='physical_specimen'||
     policy.required_split_policy.calibration_required!==true||
     policy.required_split_policy.validation_required!==true||
     policy.required_split_policy.specimen_may_cross_splits!==false){
    reasons.push('policy_split_requirements_invalid')
  }
  if(policy.required_gt_policy.independently_verified!==true||
     policy.required_gt_policy.same_sensor_self_label_forbidden!==true||
     policy.required_gt_policy.provenance_required!==true){
    reasons.push('policy_gt_requirements_invalid')
  }
  const support=policy.minimum_support
  if(support.statistical_unit!=='unique_physical_specimen') reasons.push('policy_statistical_unit_invalid')
  if(!nonEmptyUnique(support.required_classes)) reasons.push('policy_required_classes_invalid')
  for(const value of support.required_classes){
    if(!isSemanticTaxonomyValue(policy.required_feature_id,value)) reasons.push('policy_required_class_not_in_taxonomy')
    if(['none_visible','not_visible','unknown','open_set','ambiguous','not_observed'].includes(value)){
      reasons.push('policy_required_class_sensor_state_forbidden')
    }
  }
  if(!validMinimumRequirement(support.calibration_unique_specimens_per_class)){
    reasons.push('required_calibration_support_not_configured')
  }
  if(!validMinimumRequirement(support.validation_unique_specimens_per_class)){
    reasons.push('required_validation_support_not_configured')
  }
  const risk=policy.held_out_error_requirement
  if(risk.required){
    if(typeof risk.maximum_error_risk!=='number'||!Number.isFinite(risk.maximum_error_risk)||
       risk.maximum_error_risk<=0||risk.maximum_error_risk>=1||
       typeof risk.confidence_level!=='number'||!Number.isFinite(risk.confidence_level)||
       risk.confidence_level<=0||risk.confidence_level>=1||
       risk.confidence_side!=='one_sided_upper'||risk.method!=='exact_clopper_pearson'){
      reasons.push('required_held_out_error_policy_not_configured')
    }
  }else{
    if(risk.maximum_error_risk!==null||risk.confidence_level!==null){
      reasons.push('optional_held_out_error_numeric_policy_must_be_null')
    }
    if(risk.confidence_side!==null&&risk.confidence_side!=='one_sided_upper'){
      reasons.push('optional_held_out_error_confidence_side_invalid')
    }
    if(risk.method!==null&&risk.method!=='exact_clopper_pearson'){
      reasons.push('optional_held_out_error_method_invalid')
    }
  }
  if(!validMetricRequirement(policy.metric_requirements.brier_score)) reasons.push('brier_requirement_invalid')
  if(!validMetricRequirement(policy.metric_requirements.log_loss)) reasons.push('log_loss_requirement_invalid')
  if(!validMetricRequirement(policy.metric_requirements.ece)) reasons.push('ece_requirement_invalid')
  const c=policy.capture_applicability
  if(c.vocabulary_version!==SEMANTIC_CALIBRATION_CAPTURE_VOCABULARY_VERSION||
     !nonEmptyUnique(c.capture_types)||!nonEmptyUnique(c.crop_types)||!nonEmptyUnique(c.viewpoints)||
     !nonEmptyUnique(c.visibility)||!nonEmptyUnique(c.occlusion_conditions)||!nonEmptyUnique(c.glare_conditions)||
     !Number.isInteger(c.resolution.min_width_px)||c.resolution.min_width_px<=0||
     !Number.isInteger(c.resolution.min_height_px)||c.resolution.min_height_px<=0){
    reasons.push('policy_capture_applicability_invalid')
  }
  if(policy.artifact_identity_requirements.exact_sensor_identity!==true||
     policy.artifact_identity_requirements.exact_feature!==true||
     policy.artifact_identity_requirements.exact_taxonomy!==true||
     policy.artifact_identity_requirements.applicability_must_not_exceed_policy!==true){
    reasons.push('policy_artifact_identity_requirements_invalid')
  }
  if(policy.change_control.requires_new_version!==true||
     policy.change_control.validation_set_must_not_tune_estimator!==true){
    reasons.push('policy_change_control_invalid')
  }
  const unique=[...new Set(reasons)]
  return {valid:unique.length===0,reason_codes:unique}
}

export function assessSemanticCalibrationPolicyRevision(
  current:SemanticCalibrationEligibilityPolicyV1,
  next:SemanticCalibrationEligibilityPolicyV1,
):SemanticCalibrationPolicyValidation{
  const reasons:string[]=[]
  if(current.status==='preregistered'&&current.locked_at!==null&&
     current.policy_version===next.policy_version&&
     current.policy_content_digest_sha256!==next.policy_content_digest_sha256){
    reasons.push('locked_policy_mutation_requires_new_version')
  }
  const nextValidation=validateSemanticCalibrationEligibilityPolicy(next)
  reasons.push(...nextValidation.reason_codes)
  const unique=[...new Set(reasons)]
  return {valid:unique.length===0,reason_codes:unique}
}

export function semanticCalibrationImageWithinPolicyEnvelope(
  image:Pick<SemanticCalibrationImage,'capture_type'|'viewpoint'|'crop_type'|'width_px'|'height_px'|'visibility'|'occlusion_condition'|'glare_condition'>,
  policy:SemanticCalibrationEligibilityPolicyV1,
):boolean{
  const c=policy.capture_applicability
  return c.capture_types.includes(image.capture_type)&&
    c.viewpoints.includes(image.viewpoint)&&
    c.crop_types.includes(image.crop_type)&&
    c.visibility.includes(image.visibility)&&
    c.occlusion_conditions.includes(image.occlusion_condition)&&
    c.glare_conditions.includes(image.glare_condition)&&
    image.width_px>=c.resolution.min_width_px&&
    image.height_px>=c.resolution.min_height_px&&
    (c.resolution.max_width_px===null||image.width_px<=c.resolution.max_width_px)&&
    (c.resolution.max_height_px===null||image.height_px<=c.resolution.max_height_px)
}

export interface SemanticCalibrationDatasetPolicyReadiness {
  ready_for_observation_support:boolean
  calibration_unique_specimens_per_class:Record<string,number>
  validation_unique_specimens_per_class:Record<string,number>
  reason_codes:string[]
}

export function assessSemanticCalibrationDatasetPolicyReadiness(
  dataset:{
    source_scope:CalibrationDatasetSourceScope
    feature_scope:SemanticFeatureId[]
    ground_truth_policy:{independently_verified:true;same_sensor_self_label_forbidden:true;provenance_required:true}
    specimens:Array<{
      specimen_id:string
      images:SemanticCalibrationImage[]
      ground_truth:Array<{feature_id:SemanticFeatureId;value:string;gt_source:string;verification_method:string;annotator_or_fixture_provenance:string}>
    }>
  },
  policy:SemanticCalibrationEligibilityPolicyV1,
):SemanticCalibrationDatasetPolicyReadiness{
  const reasons:string[]=[]
  if(!policy.allowed_source_scopes.includes(dataset.source_scope)) reasons.push('dataset_source_scope_not_allowed_by_policy')
  if(!dataset.feature_scope.includes(policy.required_feature_id)) reasons.push('policy_feature_missing_from_dataset')
  if(dataset.ground_truth_policy.independently_verified!==true||
     dataset.ground_truth_policy.same_sensor_self_label_forbidden!==true||
     dataset.ground_truth_policy.provenance_required!==true){
    reasons.push('ground_truth_policy_not_independent')
  }

  const bySplit={
    calibration:new Map<string,Set<string>>(),
    validation:new Map<string,Set<string>>(),
  }
  for(const specimen of dataset.specimens){
    const splits=new Set(specimen.images.map(image=>image.split))
    if(splits.has('calibration')&&splits.has('validation')) reasons.push('physical_specimen_crosses_splits')
    const gt=specimen.ground_truth.find(item=>item.feature_id===policy.required_feature_id)
    if(!gt) continue
    if(!gt.gt_source?.trim()||!gt.verification_method?.trim()||!gt.annotator_or_fixture_provenance?.trim()){
      reasons.push('ground_truth_provenance_missing')
      continue
    }
    if(!policy.minimum_support.required_classes.includes(gt.value)) continue
    for(const split of ['calibration','validation'] as const){
      if(!specimen.images.some(image=>image.split===split&&semanticCalibrationImageWithinPolicyEnvelope(image,policy))) continue
      const set=bySplit[split].get(gt.value)??new Set<string>()
      set.add(specimen.specimen_id)
      bySplit[split].set(gt.value,set)
    }
  }

  const cal=Object.fromEntries([...bySplit.calibration.entries()].map(([key,value])=>[key,value.size]))
  const val=Object.fromEntries([...bySplit.validation.entries()].map(([key,value])=>[key,value.size]))
  const calRequirement=policy.minimum_support.calibration_unique_specimens_per_class
  const valRequirement=policy.minimum_support.validation_unique_specimens_per_class
  for(const gtClass of policy.minimum_support.required_classes){
    if(calRequirement.required&&calRequirement.minimum!==null&&(cal[gtClass]??0)<calRequirement.minimum){
      reasons.push(`minimum_calibration_unique_specimen_material_not_met:${gtClass}`)
    }
    if(valRequirement.required&&valRequirement.minimum!==null&&(val[gtClass]??0)<valRequirement.minimum){
      reasons.push(`minimum_validation_unique_specimen_material_not_met:${gtClass}`)
    }
  }
  const unique=[...new Set(reasons)]
  return {
    ready_for_observation_support:unique.length===0,
    calibration_unique_specimens_per_class:cal,
    validation_unique_specimens_per_class:val,
    reason_codes:unique,
  }
}

export function lockedPolicyReplacementRequiresNewVersion(
  existing:SemanticCalibrationEligibilityPolicyV1,
  candidate:SemanticCalibrationEligibilityPolicyV1,
):boolean{
  if(existing.status!=='preregistered'||existing.locked_at===null) return false
  if(existing.policy_id!==candidate.policy_id||existing.policy_version!==candidate.policy_version) return false
  return existing.policy_content_digest_sha256!==candidate.policy_content_digest_sha256
}

function deepFreeze<T>(value:T):T{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    Object.freeze(value)
    for(const child of Object.values(value as Record<string,unknown>)) deepFreeze(child)
  }
  return value
}

export const PREREGISTERED_PRODUCTION_SEMANTIC_CALIBRATION_POLICY_V1=
  deepFreeze(finalizeSemanticCalibrationEligibilityPolicy({
    schema_version:SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_SCHEMA,
    policy_id:'hcsi-production-semantic-calibration-policy-drive-form-v1',
    policy_version:'1.0.0',
    status:'preregistered',
    created_at:'2026-10-03T15:06:00Z',
    locked_at:'2026-10-03T15:06:00Z',
    applicable_dataset_schema:'hcsi.semantic-calibration-dataset.v1',
    applicable_calibration_schema:'hcsi.semantic-calibration.v1',
    allowed_source_scopes:['independent_real_image'],
    required_feature_id:'drive.form',
    required_sensor_identity:{
      sensor_type:'vlm',
      model:'gpt-5.6-sol',
      model_version:'gpt-5.6-sol',
      prompt_version:'hcsi.semantic-first-pass.prompt.v1',
      extractor_version:'hcsi.candidate-blind-vlm.v1',
      taxonomy_version:'hcsi.semantic-taxonomy.v1',
    },
    required_split_policy:{
      unit:'physical_specimen',
      calibration_required:true,
      validation_required:true,
      specimen_may_cross_splits:false,
    },
    required_gt_policy:{
      independently_verified:true,
      same_sensor_self_label_forbidden:true,
      provenance_required:true,
    },
    minimum_support:{
      statistical_unit:'unique_physical_specimen',
      required_classes:[...PRODUCTION_DRIVE_FORM_REQUIRED_CLASSES],
      calibration_unique_specimens_per_class:{required:true,minimum:29},
      validation_unique_specimens_per_class:{required:true,minimum:29},
    },
    held_out_error_requirement:{
      required:true,
      maximum_error_risk:0.10,
      confidence_level:0.95,
      confidence_side:'one_sided_upper',
      method:'exact_clopper_pearson',
    },
    metric_requirements:{
      brier_score:{required:false,threshold:null},
      log_loss:{required:false,threshold:null},
      ece:{required:false,threshold:null},
    },
    capture_applicability:{
      vocabulary_version:SEMANTIC_CALIBRATION_CAPTURE_VOCABULARY_VERSION,
      capture_types:['user_uploaded_single_image'],
      crop_types:['full_image'],
      viewpoints:['drive_face_visible'],
      visibility:['visible'],
      occlusion_conditions:['none'],
      glare_conditions:['none'],
      resolution:{min_width_px:256,min_height_px:256,max_width_px:null,max_height_px:null},
    },
    quality_coverage_requirements:{
      required:true,
      description:'Production-v1 support counts only validation/calibration observations whose bound image is inside the preregistered single-image, full-image, drive-face-visible, visible, unoccluded, no-glare, >=256x256 envelope.',
    },
    artifact_identity_requirements:{
      exact_sensor_identity:true,
      exact_feature:true,
      exact_taxonomy:true,
      applicability_must_not_exceed_policy:true,
    },
    admission_rules:[
      'held_out_validation_only_for_final_eligibility',
      'validation_outcomes_must_not_tune_estimator_prompt_taxonomy_classes_thresholds_or_capture_envelope',
      'per_required_class_unique_specimen_support_required',
      'per_required_class_exact_one_sided_clopper_pearson_error_upper_bound_required',
      'aggregate_accuracy_is_diagnostic_only',
      'brier_log_loss_ece_are_not_production_v1_admission_criteria',
      'passing_eligibility_does_not_mutate_production_registries',
      'explicit_versioned_admission_event_required',
      'identity_change_requires_new_calibration_lineage',
    ],
    change_control:{
      requires_new_version:true,
      validation_set_must_not_tune_estimator:true,
    },
  }))

export const SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY:
  readonly SemanticCalibrationEligibilityPolicyV1[]=Object.freeze([
    PREREGISTERED_PRODUCTION_SEMANTIC_CALIBRATION_POLICY_V1,
  ])

export const ACTIVE_SEMANTIC_CALIBRATION_POLICY:
  SemanticCalibrationEligibilityPolicyV1|null=
    PREREGISTERED_PRODUCTION_SEMANTIC_CALIBRATION_POLICY_V1
