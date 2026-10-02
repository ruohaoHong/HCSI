import type { CalibrationSplit,SemanticCalibrationDatasetV1 } from './semantic-calibration-dataset-v1'
import type { SemanticFeatureId } from './semantic-taxonomy-v1'

export const SEMANTIC_CALIBRATION_CORPUS_COVERAGE_SCHEMA=
  'hcsi.semantic-calibration-corpus-coverage.v1' as const

export interface SemanticCalibrationCorpusCoverageReport {
  schema_version:typeof SEMANTIC_CALIBRATION_CORPUS_COVERAGE_SCHEMA
  dataset_id:string
  dataset_version:string
  dataset_content_digest_sha256:string
  specimen_count:number
  image_count:number
  ground_truth_count:number
  feature_scope:SemanticFeatureId[]
  per_feature_gt_class_counts:Record<string,Record<string,number>>
  per_split:Record<CalibrationSplit,{specimen_count:number;image_count:number}>
  capture_conditions:{
    capture_type:Record<string,number>
    viewpoint:Record<string,number>
    crop_type:Record<string,number>
    visibility:Record<string,number>
    occlusion_condition:Record<string,number>
    glare_condition:Record<string,number>
  }
  exact_dimensions:Record<string,number>
  resolution_buckets:Record<string,number>
  semantics:'descriptive_inventory_only_not_production_sufficiency'
}

function increment(target:Record<string,number>,key:string){
  target[key]=(target[key]??0)+1
}

function resolutionBucket(width:number,height:number):string{
  const shortSide=Math.min(width,height)
  if(shortSide<256) return 'short_side_lt_256'
  if(shortSide<512) return 'short_side_256_511'
  if(shortSide<1024) return 'short_side_512_1023'
  return 'short_side_gte_1024'
}

export function buildSemanticCalibrationCorpusCoverageReport(
  dataset:SemanticCalibrationDatasetV1,
):SemanticCalibrationCorpusCoverageReport{
  const gtCounts:Record<string,Record<string,number>>={}
  for(const feature of dataset.feature_scope) gtCounts[feature]={}

  const perSplit:SemanticCalibrationCorpusCoverageReport['per_split']={
    fit:{specimen_count:0,image_count:0},
    calibration:{specimen_count:0,image_count:0},
    validation:{specimen_count:0,image_count:0},
  }
  const captureConditions={
    capture_type:{} as Record<string,number>,
    viewpoint:{} as Record<string,number>,
    crop_type:{} as Record<string,number>,
    visibility:{} as Record<string,number>,
    occlusion_condition:{} as Record<string,number>,
    glare_condition:{} as Record<string,number>,
  }
  const exactDimensions:Record<string,number>={}
  const resolutionBuckets:Record<string,number>={}
  let imageCount=0,groundTruthCount=0

  for(const specimen of dataset.specimens){
    const specimenSplit=specimen.images[0]?.split
    if(specimenSplit) perSplit[specimenSplit].specimen_count++
    for(const gt of specimen.ground_truth){
      groundTruthCount++
      const featureCounts=gtCounts[gt.feature_id]??(gtCounts[gt.feature_id]={})
      increment(featureCounts,gt.value)
    }
    for(const image of specimen.images){
      imageCount++
      perSplit[image.split].image_count++
      increment(captureConditions.capture_type,image.capture_type)
      increment(captureConditions.viewpoint,image.viewpoint)
      increment(captureConditions.crop_type,image.crop_type)
      increment(captureConditions.visibility,image.visibility)
      increment(captureConditions.occlusion_condition,image.occlusion_condition)
      increment(captureConditions.glare_condition,image.glare_condition)
      increment(exactDimensions,`${image.width_px}x${image.height_px}`)
      increment(resolutionBuckets,resolutionBucket(image.width_px,image.height_px))
    }
  }

  return {
    schema_version:SEMANTIC_CALIBRATION_CORPUS_COVERAGE_SCHEMA,
    dataset_id:dataset.dataset_id,
    dataset_version:dataset.dataset_version,
    dataset_content_digest_sha256:dataset.dataset_content_digest_sha256,
    specimen_count:dataset.specimens.length,
    image_count:imageCount,
    ground_truth_count:groundTruthCount,
    feature_scope:[...dataset.feature_scope],
    per_feature_gt_class_counts:gtCounts,
    per_split:perSplit,
    capture_conditions:captureConditions,
    exact_dimensions:exactDimensions,
    resolution_buckets:resolutionBuckets,
    semantics:'descriptive_inventory_only_not_production_sufficiency',
  }
}
