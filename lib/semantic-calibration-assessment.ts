import type { SemanticEvidenceV1, SemanticObservation, SemanticSensorType } from './semantic-evidence-v1'
import type { TargetedSemanticEvidence } from './targeted-semantic-extractor'
import type { SemanticCalibrationArtifactV1 } from './semantic-calibration-v1'
import type { SemanticCalibrationDatasetV1 } from './semantic-calibration-dataset-v1'
import { validateSemanticCalibrationDataset } from './semantic-calibration-dataset-v1'
import { assessSemanticLikelihoodEligibility, type SemanticRuntimeCalibrationContext } from './semantic-likelihood-eligibility'

export const SEMANTIC_CALIBRATION_ASSESSMENT_SCHEMA='hcsi.semantic-calibration-assessment.v1' as const
export interface SemanticCalibrationAssessmentItem {
 observation_ref:string;feature_id:string;source:string;independence_group:string;calibration_status:'validated'|'unavailable'|'mismatch'|'out_of_scope';
 calibration_artifact_id:string|null;raw_score:number|null;calibrated_distribution:Record<string,number>|null;calibrated_probability:number|null;likelihood_eligible:boolean;reason_codes:string[]
}
export interface SemanticCalibrationAssessment {schema_version:typeof SEMANTIC_CALIBRATION_ASSESSMENT_SCHEMA;available:boolean;items:SemanticCalibrationAssessmentItem[]}
function assessOne(observation:SemanticObservation,ref:string,runtime:SemanticRuntimeCalibrationContext,artifacts:readonly SemanticCalibrationArtifactV1[],datasets:readonly SemanticCalibrationDatasetV1[]):SemanticCalibrationAssessmentItem{
 const artifact=artifacts.find(a=>a.feature_id===runtime.feature_id&&a.sensor_identity.sensor_type===runtime.sensor_type)??null
 const dataset=artifact?datasets.find(d=>d.dataset_id===artifact.dataset_id&&d.dataset_version===artifact.dataset_version)??null:null
 const dv=dataset?validateSemanticCalibrationDataset(dataset):null
 const e=assessSemanticLikelihoodEligibility(runtime,artifact,dataset,dv)
 return {observation_ref:ref,feature_id:observation.feature_id,source:observation.source,independence_group:observation.independence_group,
  calibration_status:e.calibration_applicability==='applicable'?'validated':e.calibration_applicability==='mismatch'?'mismatch':e.calibration_applicability==='out_of_scope'?'out_of_scope':'unavailable',
  calibration_artifact_id:artifact?.calibration_id??null,raw_score:observation.raw_score,calibrated_distribution:null,calibrated_probability:null,likelihood_eligible:e.likelihood_eligible,reason_codes:e.reason_codes}
}
export function buildSemanticCalibrationAssessment(first:SemanticEvidenceV1|null,targeted:readonly TargetedSemanticEvidence[],artifacts:readonly SemanticCalibrationArtifactV1[],datasets:readonly SemanticCalibrationDatasetV1[]):SemanticCalibrationAssessment{
 const items:SemanticCalibrationAssessmentItem[]=[]
 if(first){for(const o of first.observations){const src=first.evidence_sources.find(s=>s.evidence_ref===o.source);const runtime:SemanticRuntimeCalibrationContext={feature_id:o.feature_id,sensor_type:(src?.sensor_type??'vlm') as SemanticSensorType,model:src?.model??'unknown',model_version:src?.model_version??'unknown',prompt_version:src?.prompt_version??'unknown',extractor_version:first.extractor_version,taxonomy_version:first.taxonomy_version,quality:{visibility:o.visibility,capture_type:'full_image',viewpoint:'unknown',crop_type:'full_image',width_px:0,height_px:0,occlusion_condition:'unknown',glare_condition:'unknown'}};items.push(assessOne(o,`first-pass:${o.source}:${o.feature_id}`,runtime,artifacts,datasets))}}
 for(const t of targeted){const o=t.observation;const runtime:SemanticRuntimeCalibrationContext={feature_id:o.feature_id,sensor_type:t.provenance.sensor_type,model:t.provenance.model,model_version:t.provenance.model_version,prompt_version:t.provenance.prompt_version,extractor_version:'hcsi.targeted-semantic-extractor.v1',taxonomy_version:first?.taxonomy_version??'unknown',quality:{visibility:o.visibility,capture_type:'targeted_crop',viewpoint:'unknown',crop_type:t.provenance.crop_ref,width_px:0,height_px:0,occlusion_condition:'unknown',glare_condition:'unknown'}};items.push(assessOne(o,t.observation_id,runtime,artifacts,datasets))}
 return {schema_version:SEMANTIC_CALIBRATION_ASSESSMENT_SCHEMA,available:items.some(i=>i.likelihood_eligible),items}
}
