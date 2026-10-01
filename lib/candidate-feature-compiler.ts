import type { NominalCandidate } from './measurement-v2'
import {
  CANDIDATE_FEATURE_METADATA_SCHEMA,
  type CandidateFeatureMetadataSnapshot,
  type CandidateFeatureRelation,
  type CandidateFeatureSupportStatus,
} from './candidate-feature-metadata-v1'
import {
  SEMANTIC_FEATURE_IDS,
  isSemanticTaxonomyValue,
  type SemanticFeatureId,
} from './semantic-taxonomy-v1'

export const CANDIDATE_FEATURE_COMPILER_SCHEMA = 'hcsi.candidate-feature-compiler.v1' as const
export const CANDIDATE_FEATURE_COMPILER_VERSION = 'hcsi.candidate-feature-compiler.impl.v1' as const

export interface CompiledCandidateFeatureConstraint {
  feature_id: SemanticFeatureId
  relation: CandidateFeatureRelation
  expected_value: string | null
  support_status: CandidateFeatureSupportStatus
  provenance: {
    source_type: 'normative_product_metadata' | 'candidate_metadata_unavailable'
    metadata_snapshot_id: string
    metadata_record_id: string | null
    field: string | null
    source_ids: string[]
    derivation_rule_id: string | null
    derivation_rule_version: string | null
  }
}

export interface CandidateFeatureProfile {
  candidate_id: string
  standards_snapshot_id: string
  candidate_standard_record_id: string
  feature_constraints: CompiledCandidateFeatureConstraint[]
  unsupported_or_unknown: SemanticFeatureId[]
}

export interface CandidateFeatureMatrix {
  schema_version: typeof CANDIDATE_FEATURE_COMPILER_SCHEMA
  compiler_version: typeof CANDIDATE_FEATURE_COMPILER_VERSION
  metadata_schema_version: typeof CANDIDATE_FEATURE_METADATA_SCHEMA
  metadata_snapshot_id: string
  standards_snapshot_id: string
  candidate_ids: string[]
  profiles: CandidateFeatureProfile[]
  discriminative_features: SemanticFeatureId[]
  unsupported_features: Array<{feature_id:SemanticFeatureId;reason:'candidate_metadata_unavailable'|'no_candidate_difference'}>
}

function constraintFor(
  candidate: NominalCandidate,
  featureId: SemanticFeatureId,
  metadata: CandidateFeatureMetadataSnapshot,
): CompiledCandidateFeatureConstraint {
  const records=metadata.records.filter(r=>r.candidate_record_id===candidate.standard_ref.record_id && r.feature_id===featureId)
  if (!records.length) {
    return {
      feature_id:featureId,relation:'not_specified',expected_value:null,support_status:'unavailable',
      provenance:{
        source_type:'candidate_metadata_unavailable',metadata_snapshot_id:metadata.snapshot_id,
        metadata_record_id:null,field:null,source_ids:[],derivation_rule_id:null,derivation_rule_version:null,
      },
    }
  }
  if (records.length !== 1) throw new Error(`candidate_feature_metadata_conflict:${candidate.standard_ref.record_id}:${featureId}`)
  const record=records[0]
  if (!isSemanticTaxonomyValue(featureId,record.expected_value)) {
    throw new Error(`candidate_feature_metadata_value_invalid:${record.constraint_id}`)
  }
  return {
    feature_id:featureId,relation:record.relation,expected_value:record.expected_value,support_status:'normative_metadata',
    provenance:{
      source_type:'normative_product_metadata',metadata_snapshot_id:metadata.snapshot_id,
      metadata_record_id:record.constraint_id,field:record.provenance.field,
      source_ids:[...record.provenance.source_ids],
      derivation_rule_id:record.provenance.derivation_rule_id,
      derivation_rule_version:record.provenance.derivation_rule_version,
    },
  }
}

function signature(c: CompiledCandidateFeatureConstraint) {
  return `${c.relation}:${c.expected_value ?? ''}:${c.support_status}`
}

export function compileCandidateFeatureMatrix(
  candidates: readonly NominalCandidate[],
  metadata: CandidateFeatureMetadataSnapshot,
): CandidateFeatureMatrix {
  if (metadata.schema_version !== CANDIDATE_FEATURE_METADATA_SCHEMA) throw new Error('candidate_feature_metadata_schema_invalid')
  const standardsSnapshots=[...new Set(candidates.map(c=>c.standard_ref.snapshot_id))]
  if (standardsSnapshots.length > 1) throw new Error('candidate_set_mixed_standards_snapshots')
  const standardsSnapshotId=standardsSnapshots[0] ?? metadata.standards_snapshot_id
  if (metadata.standards_snapshot_id !== standardsSnapshotId) throw new Error('candidate_feature_metadata_snapshot_mismatch')

  const profiles=candidates.map(candidate=>{
    const feature_constraints=SEMANTIC_FEATURE_IDS.map(featureId=>constraintFor(candidate,featureId,metadata))
    return {
      candidate_id:candidate.candidate_id,
      standards_snapshot_id:standardsSnapshotId,
      candidate_standard_record_id:candidate.standard_ref.record_id,
      feature_constraints,
      unsupported_or_unknown:feature_constraints
        .filter(c=>c.support_status!=='normative_metadata' || c.relation==='not_specified' || c.relation==='unknown')
        .map(c=>c.feature_id),
    }
  })

  const discriminative_features:SemanticFeatureId[]=[]
  const unsupported_features:CandidateFeatureMatrix['unsupported_features']=[]
  for (const featureId of SEMANTIC_FEATURE_IDS) {
    const constraints=profiles.map(p=>p.feature_constraints.find(c=>c.feature_id===featureId)!)
    const supported=constraints.filter(c=>c.support_status==='normative_metadata')
    if (!supported.length) {
      unsupported_features.push({feature_id:featureId,reason:'candidate_metadata_unavailable'})
      continue
    }
    const signatures=new Set(constraints.map(signature))
    if (signatures.size > 1) discriminative_features.push(featureId)
    else unsupported_features.push({feature_id:featureId,reason:'no_candidate_difference'})
  }

  return {
    schema_version:CANDIDATE_FEATURE_COMPILER_SCHEMA,
    compiler_version:CANDIDATE_FEATURE_COMPILER_VERSION,
    metadata_schema_version:metadata.schema_version,
    metadata_snapshot_id:metadata.snapshot_id,
    standards_snapshot_id:standardsSnapshotId,
    candidate_ids:candidates.map(c=>c.candidate_id),
    profiles,discriminative_features,unsupported_features,
  }
}
