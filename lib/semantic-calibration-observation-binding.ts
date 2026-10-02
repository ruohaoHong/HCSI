import {
  semanticCalibrationImageIdentityMatches,
  type CalibrationSplit,
  type SemanticCalibrationDatasetV1,
} from './semantic-calibration-dataset-v1'
import type { SemanticSensorObservationRecordV1 } from './semantic-sensor-observation-record-v1'

export interface ObservationCollectionDatasetBindingValidation {
  valid:boolean
  reason_codes:string[]
}

function recordMatchesAnyDatasetSplit(
  dataset:SemanticCalibrationDatasetV1,
  record:SemanticSensorObservationRecordV1,
):boolean{
  return (['fit','calibration','validation'] as CalibrationSplit[]).some(split=>
    semanticCalibrationImageIdentityMatches(dataset,{
      specimen_id:record.specimen_id,
      image_id:record.image_id,
      image_sha256:record.image_sha256,
      split,
    })
  )
}

function splitMismatchReason(expectedSplit:CalibrationSplit):string{
  if(expectedSplit==='calibration') return 'calibration_record_split_mismatch'
  if(expectedSplit==='validation') return 'validation_record_split_mismatch'
  return 'observation_record_split_mismatch'
}

/**
 * Trust-boundary validation for an operation's complete observation collection.
 * Every input record must be bound to the exact dataset image and expected split
 * before any estimator/sensor identity filtering is allowed to ignore it.
 */
export function validateObservationCollectionDatasetBinding(
  dataset:SemanticCalibrationDatasetV1,
  records:readonly SemanticSensorObservationRecordV1[],
  expectedSplit:CalibrationSplit,
):ObservationCollectionDatasetBindingValidation{
  const reasons:string[]=[]
  for(const record of records){
    const exact=semanticCalibrationImageIdentityMatches(dataset,{
      specimen_id:record.specimen_id,
      image_id:record.image_id,
      image_sha256:record.image_sha256,
      split:expectedSplit,
    })
    if(exact) continue
    reasons.push(
      recordMatchesAnyDatasetSplit(dataset,record)
        ? splitMismatchReason(expectedSplit)
        : 'observation_dataset_image_binding_mismatch'
    )
  }
  const unique=[...new Set(reasons)]
  return {valid:unique.length===0,reason_codes:unique}
}
