import type { CandidateFeatureMatrix, CompiledCandidateFeatureConstraint } from './candidate-feature-compiler'
import type { SemanticEvidenceV1, SemanticObservation } from './semantic-evidence-v1'
import type { SemanticFeatureId } from './semantic-taxonomy-v1'

export const SEMANTIC_DISCRIMINATION_PLAN_SCHEMA = 'hcsi.semantic-discrimination-plan.v1' as const

export interface SemanticDiscriminator {
  discriminator_id: string
  feature_id: SemanticFeatureId
  candidate_partitions: Array<{
    relation: CompiledCandidateFeatureConstraint['relation']
    expected_value: string | null
    candidate_ids: string[]
  }>
  question_type: 'single_feature_taxonomy_observation'
  observability_requirement: 'visible_or_partially_visible'
  source_provenance: CompiledCandidateFeatureConstraint['provenance'][]
  status: 'reuse_first_pass' | 'targeted_observation_required'
  reused_observation_ref: string | null
}

export interface SemanticDiscriminationPlanV1 {
  schema_version: typeof SEMANTIC_DISCRIMINATION_PLAN_SCHEMA
  plan_id: string
  candidate_set_snapshot: {
    standards_snapshot_id: string
    metadata_snapshot_id: string
    candidate_ids: string[]
  }
  discriminators: SemanticDiscriminator[]
  unresolved_candidate_pairs: Array<{candidate_a:string;candidate_b:string;reason:'no_normative_semantic_difference'}>
  status: 'discriminators_available' | 'no_semantic_discriminator_available'
}

function usableFirstPassObservation(evidence: SemanticEvidenceV1 | null, featureId: SemanticFeatureId): SemanticObservation | null {
  if (!evidence) return null
  const observation=evidence.observations.find(o=>o.feature_id===featureId) ?? null
  if (!observation) return null
  if (['unknown','ambiguous','not_visible','open_set'].includes(observation.state)) return null
  return observation
}

function partitionKey(c: CompiledCandidateFeatureConstraint) {
  return `${c.relation}::${c.expected_value ?? ''}`
}

export function buildSemanticDiscriminationPlan(
  matrix: CandidateFeatureMatrix,
  firstPass: SemanticEvidenceV1 | null,
): SemanticDiscriminationPlanV1 {
  const discriminators:SemanticDiscriminator[]=matrix.discriminative_features.map(featureId=>{
    const groups=new Map<string,{relation:CompiledCandidateFeatureConstraint['relation'];expected_value:string|null;candidate_ids:string[]}>()
    const provenance:CompiledCandidateFeatureConstraint['provenance'][]=[]
    for (const profile of matrix.profiles) {
      const constraint=profile.feature_constraints.find(c=>c.feature_id===featureId)!
      const key=partitionKey(constraint)
      const group=groups.get(key) ?? {relation:constraint.relation,expected_value:constraint.expected_value,candidate_ids:[]}
      group.candidate_ids.push(profile.candidate_id); groups.set(key,group)
      if (constraint.support_status==='normative_metadata') provenance.push(constraint.provenance)
    }
    const existing=usableFirstPassObservation(firstPass,featureId)
    return {
      discriminator_id:`${matrix.metadata_snapshot_id}:${featureId}`,
      feature_id:featureId,
      candidate_partitions:[...groups.values()],
      question_type:'single_feature_taxonomy_observation' as const,
      observability_requirement:'visible_or_partially_visible' as const,
      source_provenance:provenance,
      status:existing ? 'reuse_first_pass' as const : 'targeted_observation_required' as const,
      reused_observation_ref:existing ? `${existing.source}:${featureId}` : null,
    }
  })

  const unresolved:SemanticDiscriminationPlanV1['unresolved_candidate_pairs']=[]
  for(let i=0;i<matrix.profiles.length;i++) for(let j=i+1;j<matrix.profiles.length;j++) {
    const a=matrix.profiles[i],b=matrix.profiles[j]
    const differs=matrix.discriminative_features.some(featureId=>{
      const ac=a.feature_constraints.find(c=>c.feature_id===featureId)!
      const bc=b.feature_constraints.find(c=>c.feature_id===featureId)!
      return partitionKey(ac)!==partitionKey(bc)
    })
    if(!differs) unresolved.push({candidate_a:a.candidate_id,candidate_b:b.candidate_id,reason:'no_normative_semantic_difference'})
  }

  return {
    schema_version:SEMANTIC_DISCRIMINATION_PLAN_SCHEMA,
    plan_id:`semantic-plan:${matrix.metadata_snapshot_id}:${matrix.candidate_ids.join('|')}`,
    candidate_set_snapshot:{
      standards_snapshot_id:matrix.standards_snapshot_id,
      metadata_snapshot_id:matrix.metadata_snapshot_id,
      candidate_ids:[...matrix.candidate_ids],
    },
    discriminators,
    unresolved_candidate_pairs:unresolved,
    status:discriminators.length ? 'discriminators_available' : 'no_semantic_discriminator_available',
  }
}
