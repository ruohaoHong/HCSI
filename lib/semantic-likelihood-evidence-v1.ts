import type { SemanticCalibrationAssessment } from './semantic-calibration-assessment'
export const SEMANTIC_LIKELIHOOD_EVIDENCE_SCHEMA='hcsi.semantic-likelihood-evidence.v1' as const
export interface SemanticLikelihoodEvidenceItem {observation_ref:string;independence_group:string;status:'eligible_but_not_candidate_likelihood'|'calibration_unavailable';log_likelihood:null;calibrated_log_likelihood_ratio:null;reason_codes:string[]}
export interface SemanticLikelihoodEvidenceV1 {schema_version:typeof SEMANTIC_LIKELIHOOD_EVIDENCE_SCHEMA;available:false;items:SemanticLikelihoodEvidenceItem[];candidate_likelihood_not_implemented:true}
export function buildSemanticLikelihoodEvidence(assessment:SemanticCalibrationAssessment):SemanticLikelihoodEvidenceV1{
 return {schema_version:SEMANTIC_LIKELIHOOD_EVIDENCE_SCHEMA,available:false,candidate_likelihood_not_implemented:true,items:assessment.items.map(i=>({observation_ref:i.observation_ref,independence_group:i.independence_group,status:i.likelihood_eligible?'eligible_but_not_candidate_likelihood':'calibration_unavailable',log_likelihood:null,calibrated_log_likelihood_ratio:null,reason_codes:i.reason_codes}))}
}
