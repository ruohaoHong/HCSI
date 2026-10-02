import type { SemanticFeatureId } from './semantic-taxonomy-v1'
import type { SemanticSensorType } from './semantic-evidence-v1'

export const SEMANTIC_CALIBRATION_DATASET_SCHEMA='hcsi.semantic-calibration-dataset.v1' as const
export type CalibrationSplit='fit'|'calibration'|'validation'
export type CalibrationDatasetSourceScope=
  |'independent_real_image'
  |'synthetic_test'
  |'regression_fixture'
  |'development_fixture'
  |'sealed_blind_fixture'

export interface SemanticCalibrationGroundTruth {
  feature_id:SemanticFeatureId
  value:string
  gt_source:string
  verification_method:string
  annotator_or_fixture_provenance:string
  schema_version:string
}

export interface SemanticCalibrationImage {
  image_id:string
  sha256:string
  source_ref:string
  split:CalibrationSplit
  capture_type:string
  viewpoint:string
  crop_type:string
  width_px:number
  height_px:number
  visibility:string
  occlusion_condition:string
  glare_condition:string
}

export interface SemanticCalibrationSpecimen {
  specimen_id:string
  provenance:{
    source_class:CalibrationDatasetSourceScope
    source_ref:string
    physical_identity_verified:boolean
  }
  images:SemanticCalibrationImage[]
  ground_truth:SemanticCalibrationGroundTruth[]
}

export interface SemanticCalibrationDatasetV1 {
  schema_version:typeof SEMANTIC_CALIBRATION_DATASET_SCHEMA
  dataset_id:string
  dataset_version:string
  created_at:string
  source_scope:CalibrationDatasetSourceScope
  source_provenance:{
    source_class:CalibrationDatasetSourceScope
    source_ref:string
    independent_acquisition:boolean
  }
  specimens:SemanticCalibrationSpecimen[]
  split_policy:{unit:'physical_specimen';allowed_splits:CalibrationSplit[];specimen_may_cross_splits:false}
  feature_scope:SemanticFeatureId[]
  sensor_scope:SemanticSensorType[]
  capture_conditions:{
    capture_types:string[]
    viewpoints:string[]
    crop_types:string[]
    visibility:string[]
    occlusion_conditions:string[]
    glare_conditions:string[]
  }
  ground_truth_policy:{independently_verified:true;same_sensor_self_label_forbidden:true;provenance_required:true}
}

export interface CalibrationDatasetValidation {
  valid:boolean
  production_eligible_source:boolean
  reason_codes:string[]
  specimen_count:number
  image_count:number
  ground_truth_count:number
}

const productionForbiddenSourceClasses=new Set<CalibrationDatasetSourceScope>([
  'regression_fixture','development_fixture','sealed_blind_fixture','synthetic_test',
])

export function validateSemanticCalibrationDataset(dataset:SemanticCalibrationDatasetV1):CalibrationDatasetValidation{
  const reasons:string[]=[]
  if(dataset.schema_version!==SEMANTIC_CALIBRATION_DATASET_SCHEMA) reasons.push('dataset_schema_mismatch')
  if(dataset.split_policy.unit!=='physical_specimen'||dataset.split_policy.specimen_may_cross_splits!==false) reasons.push('specimen_level_split_not_enforced')
  if(dataset.ground_truth_policy.independently_verified!==true||
     dataset.ground_truth_policy.same_sensor_self_label_forbidden!==true||
     dataset.ground_truth_policy.provenance_required!==true) reasons.push('ground_truth_policy_not_independent')

  if(dataset.source_provenance.source_class!==dataset.source_scope) reasons.push('dataset_source_provenance_mismatch')
  if(dataset.source_scope==='independent_real_image'&&!dataset.source_provenance.independent_acquisition) reasons.push('independent_acquisition_not_verified')
  if(dataset.source_scope==='regression_fixture') reasons.push('regression_fixture_dataset_forbidden')
  if(dataset.source_scope==='development_fixture') reasons.push('development_fixture_dataset_forbidden')
  if(dataset.source_scope==='sealed_blind_fixture') reasons.push('sealed_blind_fixture_dataset_forbidden')
  if(dataset.source_scope==='synthetic_test') reasons.push('synthetic_dataset_not_production_eligible')

  const specimenIds=new Set<string>()
  const imageHashes=new Map<string,Array<{specimen_id:string;split:CalibrationSplit;image_id:string}>>()
  let imageCount=0,gtCount=0

  for(const specimen of dataset.specimens){
    if(specimenIds.has(specimen.specimen_id)) reasons.push('duplicate_specimen_id')
    specimenIds.add(specimen.specimen_id)
    if(!specimen.provenance.physical_identity_verified) reasons.push('physical_specimen_identity_unverified')
    if(productionForbiddenSourceClasses.has(specimen.provenance.source_class)){
      reasons.push(
        specimen.provenance.source_class==='sealed_blind_fixture'
          ? 'sealed_fixture_provenance_forbidden'
          : specimen.provenance.source_class==='synthetic_test'
            ? 'synthetic_specimen_not_production_eligible'
            : 'regression_or_development_fixture_provenance_forbidden'
      )
    }

    const splits=new Set(specimen.images.map(i=>i.split))
    if(splits.size>1) reasons.push('specimen_split_leakage')
    if(!specimen.ground_truth.length) reasons.push('ground_truth_missing')

    for(const image of specimen.images){
      imageCount++
      if(!/^[a-f0-9]{64}$/i.test(image.sha256)) reasons.push('image_sha256_invalid')
      if(!image.source_ref) reasons.push('image_source_ref_missing')
      const occurrences=imageHashes.get(image.sha256)??[]
      occurrences.push({specimen_id:specimen.specimen_id,split:image.split,image_id:image.image_id})
      imageHashes.set(image.sha256,occurrences)
    }

    for(const gt of specimen.ground_truth){
      gtCount++
      if(!gt.gt_source||!gt.verification_method||!gt.annotator_or_fixture_provenance||!gt.schema_version){
        reasons.push('ground_truth_provenance_missing')
      }
    }
  }

  for(const occurrences of imageHashes.values()){
    if(occurrences.length>1){
      reasons.push('duplicate_image_sha256')
      if(new Set(occurrences.map(x=>x.split)).size>1) reasons.push('cross_split_image_sha256')
    }
  }

  const structuralFatal=new Set([
    'dataset_schema_mismatch','specimen_level_split_not_enforced','specimen_split_leakage',
    'duplicate_specimen_id','ground_truth_missing','ground_truth_provenance_missing',
    'ground_truth_policy_not_independent','dataset_source_provenance_mismatch',
    'physical_specimen_identity_unverified','image_sha256_invalid','image_source_ref_missing',
    'duplicate_image_sha256','cross_split_image_sha256',
  ])
  const valid=!reasons.some(r=>structuralFatal.has(r))
  const production_eligible_source=
    valid&&dataset.source_scope==='independent_real_image'&&
    dataset.source_provenance.independent_acquisition&&
    !reasons.some(r=>r.includes('fixture')||r.includes('synthetic')||r==='independent_acquisition_not_verified')

  return {
    valid,production_eligible_source,reason_codes:[...new Set(reasons)],
    specimen_count:dataset.specimens.length,image_count:imageCount,ground_truth_count:gtCount,
  }
}
