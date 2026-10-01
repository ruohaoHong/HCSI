import type { CandidateBlindSemanticRequest } from './candidate-blind-semantic-request'
import { semanticValuesFor, type SemanticFeatureId } from './semantic-taxonomy-v1'

export const TARGETED_SEMANTIC_REQUEST_SCHEMA = 'hcsi.targeted-semantic-request.v1' as const

export interface TargetedSemanticRequest {
  schema_version: typeof TARGETED_SEMANTIC_REQUEST_SCHEMA
  image: CandidateBlindSemanticRequest['image']
  semantic_roi: CandidateBlindSemanticRequest['semantic_roi']
  feature_id: SemanticFeatureId
  allowed_values: string[]
  visibility_context: {
    allow_not_visible: true
    allow_ambiguous: true
    allow_unknown: true
    allow_open_set: true
  }
  question: string
  request_provenance: {
    planner_version: 'hcsi.semantic-discrimination-plan.v1'
    source_semantic_taxonomy: 'hcsi.semantic-taxonomy.v1'
  }
}

export function buildTargetedSemanticRequest(
  base: CandidateBlindSemanticRequest,
  featureId: SemanticFeatureId,
): TargetedSemanticRequest {
  const allowed=[...semanticValuesFor(featureId)]
  return {
    schema_version:TARGETED_SEMANTIC_REQUEST_SCHEMA,
    image:{...base.image},
    semantic_roi:{...base.semantic_roi},
    feature_id:featureId,
    allowed_values:allowed,
    visibility_context:{
      allow_not_visible:true,allow_ambiguous:true,allow_unknown:true,allow_open_set:true,
    },
    question:`Inspect only the observable feature "${featureId}". Report exactly one allowed taxonomy value from the supplied allowlist. Use not_visible, ambiguous, unknown, or open_set when appropriate. Do not identify a fastener standard, infer metric versus inch, infer nominal diameter, pitch, TPI or length, or choose/rank any candidate.`,
    request_provenance:{
      planner_version:'hcsi.semantic-discrimination-plan.v1',
      source_semantic_taxonomy:'hcsi.semantic-taxonomy.v1',
    },
  }
}

export function assertTargetedRequestCandidateBlind(request: TargetedSemanticRequest): void {
  const keys=Object.keys(request as unknown as Record<string,unknown>)
  const forbiddenKeys=['candidate_id','candidate_ids','designation','standard_system','rank','residual','physical_likelihood','legacy_nominal','ground_truth','expected_answer']
  for(const key of forbiddenKeys) if(keys.includes(key)) throw new Error(`targeted_request_forbidden_key:${key}`)
  const serialized=JSON.stringify(request)
  if(/M\d+\s*[×x]\s*\d|#\d+\s*-\s*\d|\b(?:UNC|UNF|UNEF)\b/i.test(serialized)) {
    throw new Error('targeted_request_contains_nominal_designation')
  }
}
