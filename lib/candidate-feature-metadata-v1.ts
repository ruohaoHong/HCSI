import type { SemanticFeatureId } from './semantic-taxonomy-v1'

export const CANDIDATE_FEATURE_METADATA_SCHEMA = 'hcsi.candidate-feature-metadata.v1' as const

export type CandidateFeatureRelation = 'requires' | 'allows' | 'forbids' | 'not_specified' | 'unknown'
export type CandidateFeatureSupportStatus = 'normative_metadata' | 'unavailable' | 'unknown'

export interface CandidateFeatureConstraintRecord {
  constraint_id: string
  candidate_record_id: string
  feature_id: SemanticFeatureId
  relation: Exclude<CandidateFeatureRelation,'not_specified'|'unknown'>
  expected_value: string
  provenance: {
    source_type: 'normative_product_metadata'
    snapshot_id: string
    record_id: string
    field: string
    source_ids: string[]
    derivation_rule_id: string | null
    derivation_rule_version: string | null
  }
}

export interface CandidateFeatureMetadataSnapshot {
  schema_version: typeof CANDIDATE_FEATURE_METADATA_SCHEMA
  metadata_id: string
  metadata_version: string
  snapshot_id: string
  standards_snapshot_id: string
  authority_scope: 'normative_product_semantic_constraints'
  explicitly_excluded: [
    'market_commonness',
    'supplier_frequency',
    'commercial_availability',
    'metric_inch_prior',
    'thread_designation_to_product_morphology_inference',
  ]
  records: CandidateFeatureConstraintRecord[]
}

/**
 * Production v1 intentionally contains no product-semantic constraints.
 * The loaded standards catalogue is thread-designation authority only; it does
 * not normatively specify head/drive/flange/tip/thread-extent product form.
 */
export const CANDIDATE_FEATURE_METADATA_V1: CandidateFeatureMetadataSnapshot = {
  schema_version:CANDIDATE_FEATURE_METADATA_SCHEMA,
  metadata_id:'hcsi-normative-product-semantic-metadata-v1',
  metadata_version:'1.0.0',
  snapshot_id:'hcsi-product-semantic-empty-v1',
  standards_snapshot_id:'hcsi-standards-v1-2026-10-01',
  authority_scope:'normative_product_semantic_constraints',
  explicitly_excluded:[
    'market_commonness',
    'supplier_frequency',
    'commercial_availability',
    'metric_inch_prior',
    'thread_designation_to_product_morphology_inference',
  ],
  records:[],
}
