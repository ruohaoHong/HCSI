import type { SemanticCalibrationDatasetV1 } from './semantic-calibration-dataset-v1'
import { validateSemanticCalibrationDataset } from './semantic-calibration-dataset-v1'
import { assertObservationCandidateBlind, type SemanticSensorObservationRecordV1 } from './semantic-sensor-observation-record-v1'
import type { CandidateCalibrationFit } from './semantic-calibration-fit'
import {
  semanticCalibrationArtifactDigestValid,
  type SemanticCalibrationArtifactV1,
} from './semantic-calibration-v1'
import { sha256Canonical } from './semantic-calibration-digest'
import {
  SEMANTIC_CALIBRATION_LINEAGE_SCHEMA,
  sensorIdentityEquals,
  type CalibrationSensorIdentityV1,
} from './semantic-calibration-lineage-v1'

export const SEMANTIC_CALIBRATION_VALIDATION_SCHEMA='hcsi.semantic-calibration-validation.v1' as const

export interface CalibrationHeldOutValidation {
  schema_version:typeof SEMANTIC_CALIBRATION_VALIDATION_SCHEMA
  lineage_schema_version:typeof SEMANTIC_CALIBRATION_LINEAGE_SCHEMA
  validation_id:string
  validation_digest_sha256:string
  status:'validated'|'insufficient_validation'|'dataset_invalid'
  split:'validation'
  estimator_locked_before_validation:true
  validation_used_for_tuning:false

  artifact_id:string
  artifact_version:string
  artifact_digest_sha256:string
  source_fit_id:string
  source_fit_digest_sha256:string
  dataset_id:string
  dataset_version:string
  dataset_manifest_digest_sha256:string
  feature_id:string
  sensor_identity:CalibrationSensorIdentityV1
  taxonomy_version:string
  estimator_config_digest_sha256:string

  sample_count:number
  per_class_support:Record<string,number>
  quality_strata_support:Record<string,number>
  accuracy:number|null
  brier_score:number|null
  log_loss:number|null
  ece:number|null
  ece_policy_version:string|null
  reliability_bins:null
  metric_reason_codes:string[]

  validation_specimen_ids:string[]
  validation_record_ids:string[]
  reason_codes:string[]
}

export type CalibrationHeldOutValidationDraft=Omit<CalibrationHeldOutValidation,'validation_id'|'validation_digest_sha256'>

export function calibrationHeldOutValidationDigest(
  validation:CalibrationHeldOutValidationDraft|CalibrationHeldOutValidation,
):string{
  const {
    validation_id:_validationId,
    validation_digest_sha256:_validationDigest,
    ...payload
  }=validation as CalibrationHeldOutValidation
  return sha256Canonical({
    ...payload,
    validation_specimen_ids:[...payload.validation_specimen_ids].sort(),
    validation_record_ids:[...payload.validation_record_ids].sort(),
    reason_codes:[...payload.reason_codes].sort(),
    metric_reason_codes:[...payload.metric_reason_codes].sort(),
  })
}

export function finalizeCalibrationHeldOutValidation(
  draft:CalibrationHeldOutValidationDraft,
):CalibrationHeldOutValidation{
  const digest=calibrationHeldOutValidationDigest(draft)
  return {
    ...draft,
    validation_id:`validation-${digest.slice(0,20)}`,
    validation_digest_sha256:digest,
    validation_specimen_ids:[...draft.validation_specimen_ids].sort(),
    validation_record_ids:[...draft.validation_record_ids].sort(),
    reason_codes:[...new Set(draft.reason_codes)],
    metric_reason_codes:[...new Set(draft.metric_reason_codes)],
  }
}

export function calibrationHeldOutValidationDigestValid(validation:CalibrationHeldOutValidation):boolean{
  return validation.validation_digest_sha256===calibrationHeldOutValidationDigest(validation)
}

function recordIdentityMatchesFit(record:SemanticSensorObservationRecordV1,fit:CandidateCalibrationFit){
  const i=fit.estimator_config.sensor_identity
  return record.feature_id===fit.feature_id&&record.sensor_type===i.sensor_type&&record.model===i.model&&
    record.model_version===i.model_version&&record.prompt_version===i.prompt_version&&
    record.extractor_version===i.extractor_version&&record.taxonomy_version===i.taxonomy_version
}

function artifactSensorIdentity(artifact:SemanticCalibrationArtifactV1):CalibrationSensorIdentityV1{
  return {...artifact.sensor_identity,taxonomy_version:artifact.taxonomy_version}
}

function sensorOutcome(record:SemanticSensorObservationRecordV1):string{
  return ['unknown','ambiguous','not_visible','open_set','not_observed'].includes(record.state)
    ? record.state
    : record.value
}

export function validateCalibrationArtifact(
  artifact:SemanticCalibrationArtifactV1,
  fit:CandidateCalibrationFit,
  dataset:SemanticCalibrationDatasetV1,
  records:readonly SemanticSensorObservationRecordV1[],
):CalibrationHeldOutValidation{
  const sensorIdentity:CalibrationSensorIdentityV1={...fit.estimator_config.sensor_identity}
  const base={
    schema_version:SEMANTIC_CALIBRATION_VALIDATION_SCHEMA,
    lineage_schema_version:SEMANTIC_CALIBRATION_LINEAGE_SCHEMA,
    split:'validation' as const,
    estimator_locked_before_validation:true as const,
    validation_used_for_tuning:false as const,
    artifact_id:artifact.calibration_id,
    artifact_version:artifact.version,
    artifact_digest_sha256:artifact.artifact_digest_sha256,
    source_fit_id:fit.fit_id,
    source_fit_digest_sha256:fit.fit_digest_sha256,
    dataset_id:dataset.dataset_id,
    dataset_version:dataset.dataset_version,
    dataset_manifest_digest_sha256:dataset.manifest_digest_sha256,
    feature_id:fit.feature_id,
    sensor_identity:sensorIdentity,
    taxonomy_version:sensorIdentity.taxonomy_version,
    estimator_config_digest_sha256:fit.estimator_config_digest_sha256,
  }
  const emptyMetrics={
    sample_count:0,per_class_support:{},quality_strata_support:{},accuracy:null,
    brier_score:null,log_loss:null,ece:null,ece_policy_version:null,reliability_bins:null as null,
    metric_reason_codes:[] as string[],
    validation_specimen_ids:[] as string[],validation_record_ids:[] as string[],
  }
  const datasetValidation=validateSemanticCalibrationDataset(dataset)
  if(!datasetValidation.valid){
    return finalizeCalibrationHeldOutValidation({...base,...emptyMetrics,status:'dataset_invalid',reason_codes:['calibration_dataset_invalid']})
  }

  const lineageReasons:string[]=[]
  if(artifact.lineage_schema_version!==SEMANTIC_CALIBRATION_LINEAGE_SCHEMA) lineageReasons.push('artifact_lineage_schema_mismatch')
  if(!semanticCalibrationArtifactDigestValid(artifact)) lineageReasons.push('artifact_digest_invalid')
  if(artifact.source_fit_id!==fit.fit_id||artifact.source_fit_digest_sha256!==fit.fit_digest_sha256) lineageReasons.push('artifact_fit_lineage_mismatch')
  if(artifact.dataset_id!==dataset.dataset_id||artifact.dataset_version!==dataset.dataset_version) lineageReasons.push('artifact_dataset_identity_mismatch')
  if(artifact.dataset_manifest_digest_sha256!==dataset.manifest_digest_sha256) lineageReasons.push('dataset_manifest_digest_mismatch')
  if(artifact.estimator_config_digest_sha256!==fit.estimator_config_digest_sha256) lineageReasons.push('artifact_estimator_lineage_mismatch')
  if(artifact.feature_id!==fit.feature_id) lineageReasons.push('artifact_feature_lineage_mismatch')
  if(!sensorIdentityEquals(artifactSensorIdentity(artifact),sensorIdentity)) lineageReasons.push('artifact_sensor_identity_lineage_mismatch')
  if(fit.dataset_id!==dataset.dataset_id||fit.dataset_version!==dataset.dataset_version||
     fit.dataset_manifest_digest_sha256!==dataset.manifest_digest_sha256) lineageReasons.push('fit_dataset_lineage_mismatch')
  if(fit.status!=='candidate_artifact'||!fit.estimator_locked||!fit.model) lineageReasons.push('candidate_artifact_not_locked')
  if(lineageReasons.length){
    return finalizeCalibrationHeldOutValidation({...base,...emptyMetrics,status:'insufficient_validation',reason_codes:lineageReasons})
  }

  const validationSpecimens=new Map(dataset.specimens
    .filter(s=>s.images.some(i=>i.split==='validation'))
    .map(s=>[s.specimen_id,s]))
  const validationHashes=new Set([...validationSpecimens.values()]
    .flatMap(s=>s.images.filter(i=>i.split==='validation').map(i=>i.sha256)))
  const datasetSpecimenIds=new Set(dataset.specimens.map(s=>s.specimen_id))
  const datasetHashes=new Set(dataset.specimens.flatMap(s=>s.images.map(i=>i.sha256)))
  const recordsInDataset=records.filter(r=>datasetSpecimenIds.has(r.specimen_id)&&datasetHashes.has(r.image_sha256))
  if(recordsInDataset.some(r=>!dataset.sensor_scope.includes(r.sensor_type))){
    return finalizeCalibrationHeldOutValidation({...base,...emptyMetrics,status:'insufficient_validation',reason_codes:['sensor_outside_dataset_scope']})
  }

  const usable=records.filter(record=>{
    assertObservationCandidateBlind(record)
    return validationSpecimens.has(record.specimen_id)&&validationHashes.has(record.image_sha256)&&recordIdentityMatchesFit(record,fit)
  }).sort((a,b)=>a.run_id.localeCompare(b.run_id))

  if(usable.some(r=>fit.calibration_record_ids.includes(r.run_id))){
    return finalizeCalibrationHeldOutValidation({
      ...base,...emptyMetrics,status:'insufficient_validation',
      validation_specimen_ids:[...new Set(usable.map(r=>r.specimen_id))],
      validation_record_ids:usable.map(r=>r.run_id),
      reason_codes:['validation_calibration_record_overlap'],
    })
  }

  let correct=0
  const perClassSupport:Record<string,number>={}
  const qualityStrataSupport:Record<string,number>={}
  let scored=0,brierTotal=0,logLossTotal=0
  let probabilisticRowsValid=true,logLossFinite=true
  const metricReasons:string[]=[]

  for(const record of usable){
    const specimen=validationSpecimens.get(record.specimen_id)!
    const gt=specimen.ground_truth.find(g=>g.feature_id===fit.feature_id)?.value
    if(!gt) continue
    scored++
    perClassSupport[gt]=(perClassSupport[gt]??0)+1
    const image=specimen.images.find(i=>i.image_id===record.image_id)
    const stratum=image
      ? `${image.capture_type}|${image.viewpoint}|${image.crop_type}|${image.visibility}|${image.occlusion_condition}|${image.glare_condition}`
      : 'unknown'
    qualityStrataSupport[stratum]=(qualityStrataSupport[stratum]??0)+1
    if(record.state==='observed'&&record.value===gt) correct++

    // This model predicts sensor outcome conditional on known semantic GT:
    // P(observation outcome | GT class). Brier/log-loss below evaluate exactly
    // that predictive distribution; they are not candidate or GT posteriors.
    const row=fit.model!.empirical_frequencies[gt]
    if(!row){
      probabilisticRowsValid=false
      continue
    }
    const rowSum=Object.values(row).reduce((a,b)=>a+b,0)
    if(Math.abs(rowSum-1)>1e-9){
      probabilisticRowsValid=false
      continue
    }
    const actual=sensorOutcome(record)
    const outcomes=[...new Set([...Object.keys(row),actual])]
    brierTotal+=outcomes.reduce((sum,outcome)=>{
      const p=row[outcome]??0
      const y=outcome===actual?1:0
      return sum+(p-y)**2
    },0)
    const pActual=row[actual]??0
    if(pActual<=0){
      logLossFinite=false
    }else{
      logLossTotal+=-Math.log(pActual)
    }
  }

  if(!probabilisticRowsValid) metricReasons.push('predictive_distribution_unavailable_for_gt_class')
  if(!logLossFinite) metricReasons.push('log_loss_not_finite_under_unsmoothed_zero_probability')
  // ECE requires a preregistered reliability-bin/confidence policy for this
  // categorical sensor-outcome model. Phase 2E.1 intentionally does not invent one.
  metricReasons.push('ece_metric_not_defined_for_current_artifact_output')

  return finalizeCalibrationHeldOutValidation({
    ...base,
    status:scored?'validated':'insufficient_validation',
    sample_count:scored,
    per_class_support:perClassSupport,
    quality_strata_support:qualityStrataSupport,
    accuracy:scored?correct/scored:null,
    brier_score:scored&&probabilisticRowsValid?brierTotal/scored:null,
    log_loss:scored&&probabilisticRowsValid&&logLossFinite?logLossTotal/scored:null,
    ece:null,
    ece_policy_version:null,
    reliability_bins:null,
    metric_reason_codes:metricReasons,
    validation_specimen_ids:[...new Set(usable.map(r=>r.specimen_id))],
    validation_record_ids:usable.map(r=>r.run_id),
    reason_codes:scored?[]:['validation_split_support_missing'],
  })
}
