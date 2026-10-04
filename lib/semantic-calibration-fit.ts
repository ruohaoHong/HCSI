import {
  validateSemanticCalibrationDataset,
  type SemanticCalibrationDatasetV1,
} from './semantic-calibration-dataset-v1'
import { validateObservationCollectionDatasetBinding } from './semantic-calibration-observation-binding'
import {
  validateSemanticSensorObservationRecordV1,
  type SemanticSensorObservationRecordV1,
} from './semantic-sensor-observation-record-v1'
import { fitCategoricalConfusionModel,type SemanticConfusionModelV1 } from './semantic-confusion-model-v1'
import type { SemanticFeatureId } from './semantic-taxonomy-v1'
import type { SemanticSensorType } from './semantic-evidence-v1'
import { sha256Canonical } from './semantic-calibration-digest'
import { SEMANTIC_CALIBRATION_LINEAGE_SCHEMA } from './semantic-calibration-lineage-v1'

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
  lineage_schema_version:typeof SEMANTIC_CALIBRATION_LINEAGE_SCHEMA
  fit_id:string
  fit_digest_sha256:string
  status:'candidate_artifact'|'insufficient_data'|'dataset_invalid'
  feature_id:SemanticFeatureId
  dataset_id:string
  dataset_version:string
  dataset_manifest_digest_sha256:string
  dataset_content_digest_sha256:string
  split:'calibration'
  estimator_config:CalibrationEstimatorConfigV1
  estimator_config_digest_sha256:string
  estimator_locked:true
  model:SemanticConfusionModelV1|null
  calibration_specimen_ids:string[]
  calibration_record_ids:string[]
  calibration_observation_bindings?:Array<{run_id:string;specimen_id:string;image_id:string}>
  reason_codes:string[]
}

export function calibrationEstimatorConfigDigest(config:CalibrationEstimatorConfigV1):string{
  return sha256Canonical({
    schema_version:'hcsi.semantic-calibration-estimator-config-digest.v1',
    feature_id:config.feature_id,
    sensor_identity:config.sensor_identity,
    estimator:config.estimator,
    eligibility_policy_version:config.eligibility_policy_version,
    config_id:config.config_id,
    config_version:config.config_version,
    locked:config.locked,
  })
}

function finalizeFit(
  draft:Omit<CandidateCalibrationFit,'fit_id'|'fit_digest_sha256'|'calibration_observation_bindings'> & {
    calibration_observation_bindings?:CandidateCalibrationFit['calibration_observation_bindings']
  },
):CandidateCalibrationFit{
  const bindings=[...(draft.calibration_observation_bindings??[])].sort((a,b)=>a.run_id.localeCompare(b.run_id))
  const fitDigest=sha256Canonical({
    schema_version:draft.schema_version,
    lineage_schema_version:draft.lineage_schema_version,
    status:draft.status,
    feature_id:draft.feature_id,
    dataset_id:draft.dataset_id,
    dataset_version:draft.dataset_version,
    dataset_manifest_digest_sha256:draft.dataset_manifest_digest_sha256,
    dataset_content_digest_sha256:draft.dataset_content_digest_sha256,
    split:draft.split,
    estimator_config_digest_sha256:draft.estimator_config_digest_sha256,
    estimator_locked:draft.estimator_locked,
    model:draft.model,
    calibration_specimen_ids:[...draft.calibration_specimen_ids].sort(),
    calibration_record_ids:[...draft.calibration_record_ids].sort(),
    calibration_observation_bindings:bindings,
    reason_codes:[...draft.reason_codes].sort(),
  })
  return {
    ...draft,
    fit_id:`fit-${fitDigest.slice(0,20)}`,
    fit_digest_sha256:fitDigest,
    calibration_specimen_ids:[...draft.calibration_specimen_ids].sort(),
    calibration_record_ids:[...draft.calibration_record_ids].sort(),
    calibration_observation_bindings:bindings,
    reason_codes:[...new Set(draft.reason_codes)],
  }
}

function recordIdentityMatches(record:SemanticSensorObservationRecordV1,config:CalibrationEstimatorConfigV1){
  const i=config.sensor_identity
  return record.feature_id===config.feature_id&&record.sensor_type===i.sensor_type&&record.model===i.model&&
    record.model_version===i.model_version&&record.prompt_version===i.prompt_version&&
    record.extractor_version===i.extractor_version&&record.taxonomy_version===i.taxonomy_version
}

function duplicateRunId(records:readonly SemanticSensorObservationRecordV1[]):boolean{
  const ids=new Set<string>()
  for(const record of records){
    if(ids.has(record.run_id)) return true
    ids.add(record.run_id)
  }
  return false
}

export function fitSemanticCalibrationArtifact(
  dataset:SemanticCalibrationDatasetV1,
  records:readonly SemanticSensorObservationRecordV1[],
  config:CalibrationEstimatorConfigV1,
):CandidateCalibrationFit{
  const validation=validateSemanticCalibrationDataset(dataset)
  const estimatorDigest=calibrationEstimatorConfigDigest(config)
  const base={
    schema_version:SEMANTIC_CALIBRATION_FIT_SCHEMA,
    lineage_schema_version:SEMANTIC_CALIBRATION_LINEAGE_SCHEMA,
    feature_id:config.feature_id,
    dataset_id:dataset.dataset_id,dataset_version:dataset.dataset_version,
    dataset_manifest_digest_sha256:dataset.manifest_digest_sha256,
    dataset_content_digest_sha256:dataset.dataset_content_digest_sha256,
    split:'calibration' as const,
    estimator_config:config,estimator_config_digest_sha256:estimatorDigest,estimator_locked:true as const,
  }
  if(!validation.valid){
    return finalizeFit({...base,status:'dataset_invalid',model:null,calibration_specimen_ids:[],calibration_record_ids:[],reason_codes:['calibration_dataset_invalid',...validation.reason_codes]})
  }
  if(!config.locked||config.estimator.method!=='categorical_confusion_counts'||config.estimator.smoothing!=='none'){
    throw new Error('calibration_estimator_configuration_not_locked')
  }
  if(!dataset.feature_scope.includes(config.feature_id)){
    return finalizeFit({...base,status:'insufficient_data',model:null,calibration_specimen_ids:[],calibration_record_ids:[],reason_codes:['estimator_feature_outside_dataset_scope']})
  }
  if(!dataset.sensor_scope.includes(config.sensor_identity.sensor_type)){
    return finalizeFit({...base,status:'insufficient_data',model:null,calibration_specimen_ids:[],calibration_record_ids:[],reason_codes:['estimator_sensor_outside_dataset_scope']})
  }

  const observationReasons=records.flatMap(record=>validateSemanticSensorObservationRecordV1(record).reason_codes)
  if(observationReasons.length){
    return finalizeFit({
      ...base,status:'insufficient_data',model:null,calibration_specimen_ids:[],calibration_record_ids:[],
      reason_codes:['invalid_observation_record',...observationReasons],
    })
  }
  if(duplicateRunId(records)){
    return finalizeFit({
      ...base,status:'insufficient_data',model:null,calibration_specimen_ids:[],calibration_record_ids:[],
      reason_codes:['duplicate_observation_run_id'],
    })
  }
  const collectionBinding=validateObservationCollectionDatasetBinding(dataset,records,'calibration')
  if(!collectionBinding.valid){
    return finalizeFit({
      ...base,status:'insufficient_data',model:null,calibration_specimen_ids:[],calibration_record_ids:[],
      reason_codes:collectionBinding.reason_codes,
    })
  }
  if(records.some(record=>!dataset.sensor_scope.includes(record.sensor_type))){
    return finalizeFit({
      ...base,status:'insufficient_data',model:null,calibration_specimen_ids:[],calibration_record_ids:[],
      reason_codes:['sensor_outside_dataset_scope'],
    })
  }

  const relevant=records.filter(record=>recordIdentityMatches(record,config))
  const usable=[...relevant].sort((a,b)=>a.run_id.localeCompare(b.run_id))
  const calibrationSpecimenIds=[...new Set(usable.map(record=>record.specimen_id))]
  const truth=Object.fromEntries(calibrationSpecimenIds.flatMap(specimenId=>{
    const specimen=dataset.specimens.find(item=>item.specimen_id===specimenId)
    return specimen
      ? specimen.ground_truth.filter(gt=>gt.feature_id===config.feature_id).map(gt=>[specimenId,gt.value])
      : []
  }))
  if(!usable.length||!Object.keys(truth).length){
    return finalizeFit({
      ...base,status:'insufficient_data',model:null,
      calibration_specimen_ids:calibrationSpecimenIds,
      calibration_record_ids:[],reason_codes:['calibration_split_support_missing'],
    })
  }

  return finalizeFit({
    ...base,status:'candidate_artifact',
    model:fitCategoricalConfusionModel(config.feature_id,usable,truth),
    calibration_specimen_ids:calibrationSpecimenIds,
    calibration_record_ids:usable.map(r=>r.run_id),
    calibration_observation_bindings:usable.map(r=>({run_id:r.run_id,specimen_id:r.specimen_id,image_id:r.image_id})),
    reason_codes:[],
  })
}
