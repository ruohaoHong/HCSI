import type { SemanticFeatureId } from './semantic-taxonomy-v1'
import type { SemanticSensorType } from './semantic-evidence-v1'

export const SEMANTIC_CALIBRATION_DATASET_SCHEMA='hcsi.semantic-calibration-dataset.v1' as const
export type CalibrationSplit='fit'|'calibration'|'validation'
export type CalibrationDatasetSourceScope='independent_real_image'|'synthetic_test'|'regression_fixture'|'sealed_blind_fixture'
export interface SemanticCalibrationGroundTruth {
 feature_id:SemanticFeatureId; value:string; gt_source:string; verification_method:string;
 annotator_or_fixture_provenance:string; schema_version:string
}
export interface SemanticCalibrationImage {
 image_id:string; split:CalibrationSplit; capture_type:string; viewpoint:string; crop_type:string;
 width_px:number; height_px:number; visibility:string; occlusion_condition:string; glare_condition:string
}
export interface SemanticCalibrationSpecimen {
 specimen_id:string; images:SemanticCalibrationImage[]; ground_truth:SemanticCalibrationGroundTruth[]
}
export interface SemanticCalibrationDatasetV1 {
 schema_version:typeof SEMANTIC_CALIBRATION_DATASET_SCHEMA; dataset_id:string; dataset_version:string; created_at:string;
 source_scope:CalibrationDatasetSourceScope; specimens:SemanticCalibrationSpecimen[];
 split_policy:{unit:'physical_specimen';allowed_splits:CalibrationSplit[];specimen_may_cross_splits:false};
 feature_scope:SemanticFeatureId[]; sensor_scope:SemanticSensorType[];
 capture_conditions:{capture_types:string[];viewpoints:string[];crop_types:string[];visibility:string[];occlusion_conditions:string[];glare_conditions:string[]};
 ground_truth_policy:{independently_verified:true;same_sensor_self_label_forbidden:true;provenance_required:true}
}
export interface CalibrationDatasetValidation {valid:boolean;production_eligible_source:boolean;reason_codes:string[]}
const forbiddenFixture=/^(?:case[-_ ]?)?[BCDEFG]$/i
export function validateSemanticCalibrationDataset(dataset:SemanticCalibrationDatasetV1):CalibrationDatasetValidation{
 const reasons:string[]=[]
 if(dataset.schema_version!==SEMANTIC_CALIBRATION_DATASET_SCHEMA) reasons.push('dataset_schema_mismatch')
 if(dataset.split_policy.unit!=='physical_specimen'||dataset.split_policy.specimen_may_cross_splits!==false) reasons.push('specimen_level_split_not_enforced')\n if(dataset.ground_truth_policy.independently_verified!==true||dataset.ground_truth_policy.same_sensor_self_label_forbidden!==true||dataset.ground_truth_policy.provenance_required!==true) reasons.push('ground_truth_policy_not_independent')
 const seen=new Set<string>()
 for(const specimen of dataset.specimens){
  if(seen.has(specimen.specimen_id)) reasons.push('duplicate_specimen_id')
  seen.add(specimen.specimen_id)
  const splits=new Set(specimen.images.map(i=>i.split))
  if(splits.size>1) reasons.push('specimen_split_leakage')
  if(!specimen.ground_truth.length) reasons.push('ground_truth_missing')
  for(const gt of specimen.ground_truth) if(!gt.gt_source||!gt.verification_method||!gt.annotator_or_fixture_provenance||!gt.schema_version) reasons.push('ground_truth_provenance_missing')
  if(forbiddenFixture.test(specimen.specimen_id)) reasons.push(/[FG]$/i.test(specimen.specimen_id)?'sealed_fixture_forbidden':'regression_fixture_forbidden')
 }
 if(dataset.source_scope==='regression_fixture') reasons.push('regression_fixture_dataset_forbidden')
 if(dataset.source_scope==='sealed_blind_fixture') reasons.push('sealed_blind_fixture_dataset_forbidden')
 if(dataset.source_scope==='synthetic_test') reasons.push('synthetic_dataset_not_production_eligible')
 return {valid:!reasons.some(r=>['dataset_schema_mismatch','specimen_level_split_not_enforced','specimen_split_leakage','duplicate_specimen_id','ground_truth_missing','ground_truth_provenance_missing','ground_truth_policy_not_independent'].includes(r)),
  production_eligible_source:dataset.source_scope==='independent_real_image'&&!reasons.some(r=>r.includes('fixture')||r.includes('synthetic')),reason_codes:[...new Set(reasons)]}
}
