import type { InferenceOrchestrationResult } from './inference-orchestrator'
import { renderTaiwanFollowup } from './evidence-convergence'

export const PRODUCTION_DECISION_AUTHORITY='phase2i_orchestrator' as const
export interface LegacyDecisionDiagnostic{selected_candidate_id:string|null;purchase_ready:boolean;nominal:string|null;source:string}
export interface CanonicalPublicDecision{
 authoritative_purchase_decision_source:typeof PRODUCTION_DECISION_AUTHORITY
 decision:InferenceOrchestrationResult['decision']
 purchase_ready:boolean
 selected_candidate_id:string|null
 formal_specification:string|null
 requested_evidence:InferenceOrchestrationResult['requested_evidence']
 followup_instruction:string|null
 reason_codes:string[]
 numeric_confidence:null
 posterior_probability:null
 infrastructure_error:InferenceOrchestrationResult['orchestration_error']
 legacy_decision_diagnostic:LegacyDecisionDiagnostic|null
 differential:{agrees:boolean;legacy_would_answer:boolean;canonical_would_answer:boolean}|null
}
export function buildCanonicalPublicDecision(orchestration:InferenceOrchestrationResult,legacy:LegacyDecisionDiagnostic|null=null):CanonicalPublicDecision{
 const ready=orchestration.decision==='purchase_ready'||orchestration.decision==='purchase_ready_with_confirmation'
 const selected=ready?orchestration.convergence.selected_candidate_id:null
 if(selected!==orchestration.selected_candidate_id)throw new Error('phase2i_selected_candidate_projection_mismatch')
 const formal=ready?orchestration.purchase_spec?.designation??null:null
 if(ready&&(!selected||!formal))throw new Error('canonical_purchase_ready_without_formal_projection')
 const followup=orchestration.decision==='targeted_followup_required'?renderTaiwanFollowup(orchestration.convergence)||null:null
 const legacyAnswers=legacy?.purchase_ready===true&&legacy.selected_candidate_id!==null
 return {
  authoritative_purchase_decision_source:PRODUCTION_DECISION_AUTHORITY,
  decision:orchestration.decision,purchase_ready:ready,selected_candidate_id:selected,formal_specification:formal,
  requested_evidence:orchestration.requested_evidence,followup_instruction:followup,reason_codes:[...orchestration.reason_codes],
  numeric_confidence:null,posterior_probability:null,infrastructure_error:orchestration.orchestration_error,
  legacy_decision_diagnostic:legacy,
  differential:legacy?{agrees:legacyAnswers===ready&&(!ready||legacy.selected_candidate_id===selected),legacy_would_answer:legacyAnswers,canonical_would_answer:ready}:null,
 }
}
