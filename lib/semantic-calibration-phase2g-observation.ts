import { createHash } from 'node:crypto'
import { SEMANTIC_EXTRACTOR_VERSION,SEMANTIC_PROMPT_VERSION,type SemanticEvidenceV1 } from './semantic-evidence-v1'
import { SEMANTIC_TAXONOMY_VERSION } from './semantic-taxonomy-v1'
import { PRODUCTION_SEMANTIC_CALIBRATION_DATASETS,ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS,SEMANTIC_CALIBRATION_REGISTRY } from './semantic-calibration-registry'

export const PHASE2G_SENSOR_IDENTITY=Object.freeze({
 feature_id:'drive.form',sensor_type:'vlm',model:'gpt-5.6-sol',model_version:'gpt-5.6-sol',
 prompt_version:SEMANTIC_PROMPT_VERSION,extractor_version:SEMANTIC_EXTRACTOR_VERSION,taxonomy_version:SEMANTIC_TAXONOMY_VERSION,
})
export interface Phase2GObservationStart {
 schema_version:'hcsi.real-semantic-observation-start.v1'; observation_id:string; specimen_id:'real-2026-001'; image_id:'real-2026-001-img-01';
 dataset_id:'hcsi-real-semantic-candidate-2026-001'; dataset_version:'1.0.0'; split:'calibration'; started_at:string;
 canonical_raw:{sha256:string;byte_length:49950;width_px:393;height_px:302;format:'JPEG'};
 sensor_identity:typeof PHASE2G_SENSOR_IDENTITY; candidate_blind:true; ground_truth_in_sensor_input:false; standards_candidates_in_sensor_input:false;
}
export interface Phase2GObservationEvidence {
 schema_version:'hcsi.real-semantic-observation-evidence.v1'; observation_id:string; specimen_id:string; image_id:string; dataset_id:string; dataset_version:string; split:'calibration';
 started_at:string; completed_at:string; canonical_raw_sha256:string; submitted_input_sha256:string; submitted_input_relation:'canonical_raw_exact_bytes';
 sensor_identity:typeof PHASE2G_SENSOR_IDENTITY; candidate_blind:true; ground_truth_in_sensor_input:false; evidence:SemanticEvidenceV1; content_digest_sha256:string;
}
export function digestObservationEvidence(v:Omit<Phase2GObservationEvidence,'content_digest_sha256'>){
 return createHash('sha256').update(JSON.stringify(v)).digest('hex')
}
export function validateObservationStart(v:Phase2GObservationStart){
 const r:string[]=[]
 if(!Number.isFinite(Date.parse(v.started_at)))r.push('observation_start_invalid')
 if(v.specimen_id!=='real-2026-001'||v.image_id!=='real-2026-001-img-01')r.push('specimen_image_binding_mismatch')
 if(v.canonical_raw.sha256!=='b6c688ccf0cbed9ad3114e4075b4b3c1e72087d6d8c5007463756a1608dc7058')r.push('canonical_raw_mismatch')
 if(JSON.stringify(v.sensor_identity)!==JSON.stringify(PHASE2G_SENSOR_IDENTITY))r.push('sensor_identity_mismatch')
 if(v.candidate_blind!==true||v.ground_truth_in_sensor_input!==false||v.standards_candidates_in_sensor_input!==false)r.push('sensor_blindness_violation')
 return {valid:r.length===0,reason_codes:r}
}
export function validateObservationEvidence(v:Phase2GObservationEvidence,start:Phase2GObservationStart){
 const r=[...validateObservationStart(start).reason_codes]
 if(v.observation_id!==start.observation_id||v.specimen_id!==start.specimen_id||v.image_id!==start.image_id)r.push('observation_start_binding_mismatch')
 if(Date.parse(v.completed_at)<Date.parse(start.started_at))r.push('observation_completion_precedes_start')
 if(v.canonical_raw_sha256!==start.canonical_raw.sha256||v.submitted_input_sha256!==start.canonical_raw.sha256||v.submitted_input_relation!=='canonical_raw_exact_bytes')r.push('submitted_input_provenance_mismatch')
 if(v.evidence.observation_scope.ground_truth_included!==false||v.evidence.observation_scope.standards_candidates_included!==false)r.push('semantic_evidence_blindness_violation')
 if(v.evidence.observation_scope.image_sha256!==start.canonical_raw.sha256)r.push('semantic_evidence_image_mismatch')
 const {content_digest_sha256,...body}=v
 if(content_digest_sha256!==digestObservationEvidence(body))r.push('observation_digest_mismatch')
 return {valid:r.length===0,reason_codes:[...new Set(r)]}
}
export function assertPhase2GDoesNotAdmitCalibration(){
 if(PRODUCTION_SEMANTIC_CALIBRATION_DATASETS.length||ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS.length||SEMANTIC_CALIBRATION_REGISTRY.length) throw new Error('phase2g_production_registry_mutation_forbidden')
}
