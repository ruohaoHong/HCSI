import type { CandidateFeatureMatrix, CompiledCandidateFeatureConstraint } from './candidate-feature-compiler'
import type { SemanticEvidenceV1, SemanticObservation } from './semantic-evidence-v1'
import type { TargetedSemanticEvidence } from './targeted-semantic-extractor'
import type { SemanticFeatureId } from './semantic-taxonomy-v1'

export const CANDIDATE_SEMANTIC_DISCRIMINATION_SCHEMA = 'hcsi.candidate-semantic-discrimination.v1' as const

export type SemanticCompatibilityState =
  | 'supports'
  | 'contradicts'
  | 'uninformative'
  | 'not_visible'
  | 'unknown'
  | 'candidate_feature_unspecified'

export interface CandidateSemanticFeatureEvaluation {
  feature_id: SemanticFeatureId
  candidate_relation: CompiledCandidateFeatureConstraint['relation']
  expected_value: string | null
  observed_value: string | null
  compatibility_state: SemanticCompatibilityState
  evidence_refs: string[]
  independence_groups: string[]
  calibration_status: 'uncalibrated' | 'calibrated' | 'not_applicable'
}

export interface CandidateSemanticDiscrimination {
  schema_version: typeof CANDIDATE_SEMANTIC_DISCRIMINATION_SCHEMA
  candidate_ids_before: string[]
  candidate_ids_after: string[]
  candidates: Array<{candidate_id:string;feature_evaluations:CandidateSemanticFeatureEvaluation[]}>
  decision: {
    selected_candidate_id: null
    purchase_ready: false
    status: 'not_performed_phase2c'
  }
  numeric_score: null
  posterior_probability: null
}

function latestObservation(
  featureId: SemanticFeatureId,
  firstPass: SemanticEvidenceV1 | null,
  targeted: readonly TargetedSemanticEvidence[],
): SemanticObservation | null {
  const targetedObservation=[...targeted].reverse().find(x=>x.observation.feature_id===featureId)?.observation
  return targetedObservation ?? firstPass?.observations.find(o=>o.feature_id===featureId) ?? null
}

export function evaluateSemanticCompatibility(
  constraint: CompiledCandidateFeatureConstraint,
  observation: SemanticObservation | null,
): CandidateSemanticFeatureEvaluation {
  const base={
    feature_id:constraint.feature_id,
    candidate_relation:constraint.relation,
    expected_value:constraint.expected_value,
    observed_value:observation?.value ?? null,
    evidence_refs:observation ? [...observation.evidence_refs] : [],
    independence_groups:observation ? [observation.independence_group] : [],
    calibration_status:observation?.calibration_status ?? 'not_applicable' as const,
  }
  if (constraint.support_status!=='normative_metadata' || ['not_specified','unknown'].includes(constraint.relation)) {
    return {...base,compatibility_state:'candidate_feature_unspecified'}
  }
  if (!observation) return {...base,compatibility_state:'unknown'}
  if (observation.state==='not_visible' || observation.visibility==='not_visible') {
    return {...base,compatibility_state:'not_visible'}
  }
  if (['unknown','ambiguous','open_set'].includes(observation.state)) {
    return {...base,compatibility_state:'unknown'}
  }
  if (!['visible','partially_visible'].includes(observation.visibility)) {
    return {...base,compatibility_state:'uninformative'}
  }

  const matches=observation.value===constraint.expected_value
  if (constraint.relation==='requires') {
    return {...base,compatibility_state:matches ? 'supports' : 'contradicts'}
  }
  if (constraint.relation==='allows') {
    return {...base,compatibility_state:matches ? 'supports' : 'uninformative'}
  }
  if (constraint.relation==='forbids') {
    return {...base,compatibility_state:matches ? 'contradicts' : 'uninformative'}
  }
  return {...base,compatibility_state:'candidate_feature_unspecified'}
}

export function buildCandidateSemanticDiscrimination(
  matrix: CandidateFeatureMatrix,
  firstPass: SemanticEvidenceV1 | null,
  targeted: readonly TargetedSemanticEvidence[] = [],
): CandidateSemanticDiscrimination {
  const candidateIds=[...matrix.candidate_ids]
  const candidates=matrix.profiles.map(profile=>({
    candidate_id:profile.candidate_id,
    feature_evaluations:profile.feature_constraints
      .filter(c=>matrix.discriminative_features.includes(c.feature_id))
      .map(constraint=>evaluateSemanticCompatibility(
        constraint,
        latestObservation(constraint.feature_id,firstPass,targeted),
      )),
  }))
  return {
    schema_version:CANDIDATE_SEMANTIC_DISCRIMINATION_SCHEMA,
    candidate_ids_before:candidateIds,
    candidate_ids_after:[...candidateIds],
    candidates,
    decision:{selected_candidate_id:null,purchase_ready:false,status:'not_performed_phase2c'},
    numeric_score:null,
    posterior_probability:null,
  }
}
