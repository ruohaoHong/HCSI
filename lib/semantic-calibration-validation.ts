import type { SemanticCalibrationDatasetV1 } from './semantic-calibration-dataset-v1'
import { validateSemanticCalibrationDataset } from './semantic-calibration-dataset-v1'
import { assertObservationCandidateBlind, type SemanticSensorObservationRecordV1 } from './semantic-sensor-observation-record-v1'
import type { CandidateCalibrationFit } from './semantic-calibration-fit'

export const SEMANTIC_CALIBRATION_VALIDATION_SCHEMA='hcsi.semantic-calibration-validation.v1' as const

export interface CalibrationHeldOutValidation {
  schema_version:typeof SEMANTIC_CALIBRATION_VALIDATION_SCHEMA
  status:'validated'|'insufficient_validation'|'dataset_invalid'
  split:'validation'
  estimator_locked_before_validation:true
  validation_used_for_tuning:false
  sample_count:number
  per_class_support:Record<string,number>
  quality_strata_support:Record<string,number>
  accuracy:number|null
  validation_record_ids:string[]
  reason_codes:string[]
}

function recordIdentityMatchesFit(record:SemanticSensorObservationRecordV1,fit:CandidateCalibrationFit){
  const i=fit.estimator_config.sensor_identity
  return record.feature_id===fit.feature_id&&record.sensor_type===i.sensor_type&&record.model===i.model&&
    record.model_version===i.model_version&&record.prompt_version===i.prompt_version&&
    record.extractor_version===i.extractor_version&&record.taxonomy_version===i.taxonomy_version
}

export function validateCalibrationArtifact(
  fit:CandidateCalibrationFit,
  dataset:SemanticCalibrationDatasetV1,
  records:readonly SemanticSensorObservationRecordV1[],
):CalibrationHeldOutValidation{
  const base={
    schema_version:SEMANTIC_CALIBRATION_VALIDATION_SCHEMA,split:'validation' as const,
    estimator_locked_before_validation:true as const,validation_used_for_tuning:false as const,
  }
  const datasetValidation=validateSemanticCalibrationDataset(dataset)
  if(!datasetValidation.valid){
    return {...base,status:'dataset_invalid',sample_count:0,per_class_support:{},quality_strata_support:{},accuracy:null,validation_record_ids:[],reason_codes:['calibration_dataset_invalid']}
  }
  if(fit.status!=='candidate_artifact'||!fit.estimator_locked||!fit.model){
    return {...base,status:'insufficient_validation',sample_count:0,per_class_support:{},quality_strata_support:{},accuracy:null,validation_record_ids:[],reason_codes:['candidate_artifact_not_locked']}
  }

  const validationSpecimens=new Map(dataset.specimens
    .filter(s=>s.images.some(i=>i.split==='validation'))
    .map(s=>[s.specimen_id,s]))
  const validationHashes=new Set([...validationSpecimens.values()]
    .flatMap(s=>s.images.filter(i=>i.split==='validation').map(i=>i.sha256)))

  const usable=records.filter(record=>{
    assertObservationCandidateBlind(record)
    return validationSpecimens.has(record.specimen_id)&&validationHashes.has(record.image_sha256)&&recordIdentityMatchesFit(record,fit)
  })
  if(usable.some(r=>fit.calibration_record_ids.includes(r.run_id))){
    throw new Error('validation_record_reused_from_calibration_split')
  }

  let correct=0
  const perClassSupport:Record<string,number>={}
  const qualityStrataSupport:Record<string,number>={}
  let scored=0
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
  }

  return {
    ...base,status:scored?'validated':'insufficient_validation',
    sample_count:scored,per_class_support:perClassSupport,quality_strata_support:qualityStrataSupport,
    accuracy:scored?correct/scored:null,validation_record_ids:usable.map(r=>r.run_id),
    reason_codes:scored?[]:['validation_split_support_missing'],
  }
}
