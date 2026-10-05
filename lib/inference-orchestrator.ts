import type { MeasurementV2, NominalCandidate } from './measurement-v2'
import type { StandardsAuthorityResult } from './standards-shadow-solver'
import { compileCandidateFeatureMatrix, type CandidateFeatureMatrix } from './candidate-feature-compiler'
import type { CandidateFeatureMetadataSnapshot } from './candidate-feature-metadata-v1'
import { buildCandidateSemanticDiscrimination, type CandidateSemanticDiscrimination } from './candidate-semantic-discrimination'
import type { SemanticEvidenceV1 } from './semantic-evidence-v1'
import type { SemanticFeatureId } from './semantic-taxonomy-v1'
import { convergeEvidence, type EvidenceConvergenceResult, type RequestedEvidence } from './evidence-convergence'
import { projectSelectedFormalNominal, type FormalNominalProjection } from './formal-nominal-projection'

export const INFERENCE_ORCHESTRATION_SCHEMA='hcsi.inference-orchestration.v1' as const
export type SemanticEscalator=(request:{inference_id:string;image_ref:string;image_sha256:string;feature_id:SemanticFeatureId;acquisition:RequestedEvidence['acquisition'];candidate_blind:true;formal_candidates_in_sensor_input:false;ground_truth_in_sensor_input:false;legacy_nominal_in_sensor_input:false})=>Promise<SemanticEvidenceV1>

export interface InferenceOrchestrationResult {
 schema_version:typeof INFERENCE_ORCHESTRATION_SCHEMA
 inference_id:string; image_ref:string; image_sha256:string
 measurement:MeasurementV2
 standards_authority:StandardsAuthorityResult
 formal_candidate_ids:string[]
 candidate_feature_matrix:CandidateFeatureMatrix
 semantic_evidence:SemanticEvidenceV1|null
 semantic_discrimination:CandidateSemanticDiscrimination|null
 convergence:EvidenceConvergenceResult
 selected_candidate_id:string|null
 decision:EvidenceConvergenceResult['decision']
 requested_evidence:RequestedEvidence|null
 purchase_spec:FormalNominalProjection|null
 reason_codes:string[]
 evidence_history_refs:string[]
 semantic_invocation_count:number
 orchestration_error:null|{code:'semantic_provider_failure';message:string}
 numeric_confidence:null
 posterior_probability:null
}

function selectedAuthority(authority:StandardsAuthorityResult,id:string):StandardsAuthorityResult{
 if(!authority.formal_candidates.some(c=>c.candidate_id===id))throw new Error('convergence_selected_outside_formal_candidate_universe')
 return {...authority,decision:{...authority.decision,selected_candidate_id:id,status:'selected',purchase_ready:true}}
}
function semanticFeature(request:RequestedEvidence|null):SemanticFeatureId|null{
 if(!request||request.feature_id.startsWith('physical.'))return null
 return request.feature_id as SemanticFeatureId
}
function observationState(evidence:SemanticEvidenceV1|null,feature:SemanticFeatureId){
 return evidence?.observations.find(x=>x.feature_id===feature)?.state ?? null
}
function runCore(candidates:readonly NominalCandidate[],matrix:CandidateFeatureMatrix,evidence:SemanticEvidenceV1|null,history:readonly string[]){
 const discrimination=buildCandidateSemanticDiscrimination(matrix,evidence,[])
 const convergence=convergeEvidence({formal_candidates:candidates,feature_matrix:matrix,semantic_discrimination:discrimination,evidence_history_refs:history})
 return {discrimination,convergence}
}

/** Canonical deterministic authority path. The semantic callback receives only a candidate-blind feature request, never candidate identities. */
export async function orchestratePurchaseDecision(input:{inference_id:string;image_ref:string;measurement:MeasurementV2;standards_authority:StandardsAuthorityResult;feature_metadata:CandidateFeatureMetadataSnapshot;semantic_evidence?:SemanticEvidenceV1|null;evidence_history_refs?:readonly string[];semantic_escalator?:SemanticEscalator}):Promise<InferenceOrchestrationResult>{
 if(input.standards_authority.measurement_v2.image_sha256!==input.measurement.image_sha256)throw new Error('standards_measurement_binding_mismatch')
 const candidates=input.standards_authority.formal_candidates
 const matrix=compileCandidateFeatureMatrix(candidates,input.feature_metadata)
 let evidence=input.semantic_evidence??null, history=[...(input.evidence_history_refs??[])],invocations=0,error:InferenceOrchestrationResult['orchestration_error']=null
 let {discrimination,convergence}=runCore(candidates,matrix,evidence,history)
 const feature=semanticFeature(convergence.requested_evidence)
 if(convergence.decision==='targeted_followup_required'&&feature&&input.semantic_escalator){
   const state=observationState(evidence,feature)
   // absent means current-image evidence has not been extracted; not_visible/unknown/open_set are completed epistemic observations and are never same-image retry triggers.
   if(state===null){
     try{
       evidence=await input.semantic_escalator({inference_id:input.inference_id,image_ref:input.image_ref,image_sha256:input.measurement.image_sha256,feature_id:feature,acquisition:convergence.requested_evidence!.acquisition,candidate_blind:true,formal_candidates_in_sensor_input:false,ground_truth_in_sensor_input:false,legacy_nominal_in_sensor_input:false})
       invocations++;history=[...history,`semantic:${input.image_ref}:${feature}`]
       ;({discrimination,convergence}=runCore(candidates,matrix,evidence,history))
     }catch(e){error={code:'semantic_provider_failure',message:e instanceof Error?e.message:'semantic_provider_failure'}}
   }
 }
 const purchaseAllowed=convergence.decision==='purchase_ready'||convergence.decision==='purchase_ready_with_confirmation'
 const purchase_spec=purchaseAllowed&&convergence.selected_candidate_id?projectSelectedFormalNominal(selectedAuthority(input.standards_authority,convergence.selected_candidate_id)):null
 return {schema_version:INFERENCE_ORCHESTRATION_SCHEMA,inference_id:input.inference_id,image_ref:input.image_ref,image_sha256:input.measurement.image_sha256,measurement:input.measurement,standards_authority:input.standards_authority,formal_candidate_ids:candidates.map(c=>c.candidate_id),candidate_feature_matrix:matrix,semantic_evidence:evidence,semantic_discrimination:discrimination,convergence,selected_candidate_id:convergence.selected_candidate_id,decision:convergence.decision,requested_evidence:convergence.requested_evidence,purchase_spec,reason_codes:[...convergence.reason_codes,...(error?['semantic_provider_failure']:[])],evidence_history_refs:[...history],semantic_invocation_count:invocations,orchestration_error:error,numeric_confidence:null,posterior_probability:null}
}

export function renderOrchestrationDecision(result:InferenceOrchestrationResult){
 if(result.decision==='purchase_ready'||result.decision==='purchase_ready_with_confirmation')return {purchase_winner:result.purchase_spec?.designation??null,requested_evidence:null,reason_codes:result.reason_codes}
 return {purchase_winner:null,requested_evidence:result.requested_evidence,reason_codes:result.reason_codes}
}
