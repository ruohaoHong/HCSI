import type { HeadStyle } from './identification'
import type { MeasurementResult } from './measurement'
import { PROTRUDING_HEAD_STYLES } from './head-style-taxonomy'

export type HeadConsistencyStatus = 'consistent' | 'conflict' | 'insufficient'

export interface HeadStyleConsistency {
  status: HeadConsistencyStatus
  llm_head_style: HeadStyle
  resolved_head_style: HeadStyle
  geometry_evidence: 'countersunk' | 'protruding' | 'ambiguous' | 'unknown'
  excluded_candidates: HeadStyle[]
  selection_basis: 'llm_visual_plus_cv_constraints' | 'physical_conflict_rejected' | 'insufficient_physical_evidence'
  reason_codes: string[]
}

export function evaluateHeadStyleConsistency(
  llmHead: HeadStyle,
  measurement: MeasurementResult | null,
): HeadStyleConsistency {
  const geometry = measurement?.head_geometry
  const geometryEvidence = geometry?.length_convention_evidence ?? 'unknown'
  const reliable = geometry?.status === 'measured' && geometry.quality === 'reliable'
  if (!reliable) {
    return {
      status: 'insufficient',
      llm_head_style: llmHead,
      resolved_head_style: llmHead,
      geometry_evidence: geometryEvidence,
      excluded_candidates: [],
      selection_basis: 'insufficient_physical_evidence',
      reason_codes: ['head_geometry_not_reliable'],
    }
  }
  if (llmHead === 'unknown' || llmHead === 'other') {
    return {
      status: 'insufficient',
      llm_head_style: llmHead,
      resolved_head_style: llmHead,
      geometry_evidence: geometryEvidence,
      excluded_candidates: [],
      selection_basis: 'insufficient_physical_evidence',
      reason_codes: ['llm_head_style_unresolved'],
    }
  }
  const conflicts = (
    geometryEvidence === 'countersunk' && PROTRUDING_HEAD_STYLES.includes(llmHead)
  ) || (
    geometryEvidence === 'protruding' && llmHead === 'flat_countersunk'
  )
  if (conflicts) {
    return {
      status: 'conflict',
      llm_head_style: llmHead,
      resolved_head_style: geometryEvidence === 'countersunk' ? 'flat_countersunk' : 'unknown',
      geometry_evidence: geometryEvidence,
      excluded_candidates: geometryEvidence === 'countersunk'
        ? [...PROTRUDING_HEAD_STYLES]
        : ['flat_countersunk'],
      selection_basis: 'physical_conflict_rejected',
      reason_codes: ['llm_head_style_conflicts_with_reliable_cv_geometry'],
    }
  }
  return {
    status: 'consistent',
    llm_head_style: llmHead,
    resolved_head_style: llmHead,
    geometry_evidence: geometryEvidence,
    excluded_candidates: geometryEvidence === 'countersunk'
      ? [...PROTRUDING_HEAD_STYLES]
      : geometryEvidence === 'protruding'
        ? ['flat_countersunk']
        : [],
    selection_basis: 'llm_visual_plus_cv_constraints',
    reason_codes: geometryEvidence === 'ambiguous'
      ? ['head_geometry_ambiguous_visual_evidence_selected']
      : [],
  }
}
