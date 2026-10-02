import { validateSemanticCalibrationDataset, type SemanticCalibrationDatasetV1 } from './semantic-calibration-dataset-v1'
import { assertObservationCandidateBlind, type SemanticSensorObservationRecordV1 } from './semantic-sensor-observation-record-v1'
import { fitCategoricalConfusionModel,type SemanticConfusionModelV1 } from './semantic-confusion-model-v1'
import type { SemanticFeatureId } from './semantic-taxonomy-v1'
import type { SemanticSensorType } from './semantic-evidence-v1'

export const SEMANTIC_CALIBRATION_FIT_SCHEMA='hcsi.semantic-calibration-fit.v1' as const

export interface CalibrationEstimatorConfigV1 {
  config_id:string
  config_version:string
  feature_id:SemanticFeatureId
  sensor_identity:{
    sensor_type:SemanticSensorType
    model:string
    model_version:string
    prompt_version:string
    extractor_version:string
    taxonomy_version:string
  }
  estimator:{method:'categorical_confusion_counts';smoothing:'none'}
  eligibility_policy_version:string|null
  locked:true
}

export interface CandidateCalibrationFit {
  schema_version:typeof SEMANTIC_CALIBRATION_FIT_SCHEMA
  status:'candidate_artifact'|'insufficient_data'|'dataset_invalid'
  feature_id:SemanticFeatureId
  dataset_id:string
  dataset_version:string
  split:'calibration'
  estimator_config:CalibrationEstimatorConfigV1
  estimator_locked:true
  model:SemanticConfusionModelV1|null
  calibration_record_ids:string[]
  reason_codes:string[]
}

function recordIdentityMatches(record:SemanticSensorObservationRecordV1,config:CalibrationEstimatorConfigV1){
  const i=config.sensor_identity
  return record.feature_id===config.feature_id&&record.sensor_type===i.sensor_type&&record.model===i.model&&
    record.model_version===i.model_version&&record.prompt_version===i.prompt_version&&
    record.extractor_version===i.extractor_version&&record.taxonomy_version===i.taxonomy_version
}

export function fitSemanticCalibrationArtifact(
  dataset:SemanticCalibrationDatasetV1,
  records:readonly SemanticSensorObservationRecordV1[],
  config:CalibrationEstimatorConfigV1,
):CandidateCalibrationFit{
  const validation=validateSemanticCalibrationDataset(dataset)
  const base={
    schema_version:SEMANTIC_CALIBRATION_FIT_SCHEMA,feature_id:config.feature_id,
    dataset_id:dataset.dataset_id,dataset_version:dataset.dataset_version,split:'calibration' as const,
    estimator_config:config,estimator_locked:true as const,
  }
  if(!validation.valid){
    return {...base,status:'dataset_invalid',model:null,calibration_record_ids:[],reason_codes:['calibration_dataset_invalid']}
  }
  if(!config.locked||config.estimator.method!=='categorical_confusion_counts'||config.estimator.smoothing!=='none'){
    throw new Error('calibration_estimator_configuration_not_locked')
  }

  const calibrationSpecimens=new Map(dataset.specimens
    .filter(s=>s.images.some(i=>i.split==='calibration'))
    .map(s=>[s.specimen_id,s]))
  const calibrationImageHashes=new Set([...calibrationSpecimens.values()]
    .flatMap(s=>s.images.filter(i=>i.split==='calibration').map(i=>i.sha256)))

  const usable=records.filter(record=>{
    assertObservationCandidateBlind(record)
    return calibrationSpecimens.has(record.specimen_id)&&
      calibrationImageHashes.has(record.image_sha256)&&recordIdentityMatches(record,config)
  })
  const truth=Object.fromEntries([...calibrationSpecimens.values()].flatMap(specimen=>
    specimen.ground_truth.filter(gt=>gt.feature_id===config.feature_id).map(gt=>[specimen.specimen_id,gt.value])
  ))
  if(!usable.length||!Object.keys(truth).length){
    return {...base,status:'insufficient_data',model:null,calibration_record_ids:[],reason_codes:['calibration_split_support_missing']}
  }

  return {
    ...base,status:'candidate_artifact',
    model:fitCategoricalConfusionModel(config.feature_id,usable,truth),
    calibration_record_ids:usable.map(r=>r.run_id),
    reason_codes:[],
  }
}
