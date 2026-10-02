import type { SemanticCalibrationArtifactV1 } from './semantic-calibration-v1'
import type { CalibrationDatasetValidation, SemanticCalibrationDatasetV1 } from './semantic-calibration-dataset-v1'
import type { SemanticFeatureId } from './semantic-taxonomy-v1'
import type { SemanticSensorType } from './semantic-evidence-v1'

export interface SemanticRuntimeCalibrationContext {
 feature_id:SemanticFeatureId; sensor_type:SemanticSensorType; model:string; model_version:string; prompt_version:string; extractor_version:string; taxonomy_version:string;
 quality:{visibility:string;capture_type:string;viewpoint:string;crop_type:string;width_px:number;height_px:number;occlusion_condition:string;glare_condition:string}
}
export interface SemanticLikelihoodEligibility {likelihood_eligible:boolean;calibration_applicability:'applicable'|'mismatch'|'out_of_scope'|'unavailable';reason_codes:string[]}
export function assessSemanticLikelihoodEligibility(runtime:SemanticRuntimeCalibrationContext,artifact:SemanticCalibrationArtifactV1|null,dataset:SemanticCalibrationDatasetV1|null,datasetValidation:CalibrationDatasetValidation|null):SemanticLikelihoodEligibility{
 const r:string[]=[]
 if(!artifact){return {likelihood_eligible:false,calibration_applicability:'unavailable',reason_codes:['no_applicable_validated_calibration_artifact']}}
 if(artifact.status!=='validated')r.push('calibration_artifact_not_validated')
 if(!artifact.production_eligible)r.push('artifact_not_production_eligible')
 if(artifact.policy_status!=='preregistered'||!artifact.eligibility_policy_version)r.push('eligibility_policy_not_preregistered')
 if(!dataset||!datasetValidation){r.push('calibration_dataset_unavailable')}else{
  if(!datasetValidation.valid)r.push('calibration_dataset_invalid')
  if(!datasetValidation.production_eligible_source||dataset.source_scope!=='independent_real_image')r.push('calibration_dataset_not_independent_real_image')
 }
 const id=artifact.sensor_identity
 if(runtime.feature_id!==artifact.feature_id)r.push('feature_mismatch')
 if(runtime.sensor_type!==id.sensor_type)r.push('sensor_mismatch')
 if(runtime.model!==id.model)r.push('model_mismatch')
 if(runtime.model_version!==id.model_version)r.push('model_version_mismatch')
 if(runtime.prompt_version!==id.prompt_version)r.push('prompt_version_mismatch')
 if(runtime.extractor_version!==id.extractor_version)r.push('extractor_version_mismatch')
 if(runtime.taxonomy_version!==artifact.taxonomy_version)r.push('taxonomy_version_mismatch')
 const q=runtime.quality,s=artifact.applicability_scope
 if(!s.visibility.includes(q.visibility)||!s.capture_types.includes(q.capture_type)||!s.viewpoints.includes(q.viewpoint)||!s.crop_types.includes(q.crop_type)||!s.occlusion_conditions.includes(q.occlusion_condition)||!s.glare_conditions.includes(q.glare_condition)||
 q.width_px<s.resolution.min_width_px||q.height_px<s.resolution.min_height_px||(s.resolution.max_width_px!==null&&q.width_px>s.resolution.max_width_px)||(s.resolution.max_height_px!==null&&q.height_px>s.resolution.max_height_px))r.push('runtime_quality_out_of_scope')
 if(artifact.metrics.sample_count<=0)r.push('sample_support_insufficient')
 const mismatch=r.some(x=>x.endsWith('_mismatch'))
 const out=r.includes('runtime_quality_out_of_scope')
 return {likelihood_eligible:r.length===0,calibration_applicability:mismatch?'mismatch':out?'out_of_scope':r.length?'unavailable':'applicable',reason_codes:r}
}
