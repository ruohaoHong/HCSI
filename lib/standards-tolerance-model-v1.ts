import type { NominalCandidate } from './measurement-v2'

export const STANDARDS_TOLERANCE_MODEL_SCHEMA = 'hcsi.standards-tolerance-model.v1' as const
export const STANDARDS_TOLERANCE_MODEL_VERSION = '1.0.0' as const

export interface StandardsToleranceAssessment {
  model_schema: typeof STANDARDS_TOLERANCE_MODEL_SCHEMA
  model_version: typeof STANDARDS_TOLERANCE_MODEL_VERSION
  candidate_id: string
  status: 'available' | 'unavailable'
  tolerance_class: string | null
  diameter_limits_mm: { lower: number; upper: number } | null
  pitch_limits_mm: { lower: number; upper: number } | null
  provenance: string[]
  reason: string
}

/**
 * Phase 2A registers tolerance authorities but does not infer a tolerance class
 * from an image or designation. The current catalogue has no class-specific
 * limits, so candidate tolerance remains unavailable rather than guessed.
 */
export function assessStandardsTolerance(candidate: NominalCandidate): StandardsToleranceAssessment {
  const authority = candidate.standard_system === 'iso_metric'
    ? ['ISO 965-1:2026','ISO 965-6:2025']
    : ['ASME B1.1-2024']
  return {
    model_schema:STANDARDS_TOLERANCE_MODEL_SCHEMA,
    model_version:STANDARDS_TOLERANCE_MODEL_VERSION,
    candidate_id:candidate.candidate_id,
    status:'unavailable',
    tolerance_class:null,
    diameter_limits_mm:null,
    pitch_limits_mm:null,
    provenance:authority,
    reason:'tolerance_class_and_class_specific_limits_not_present_in_versioned_catalogue_or_observed_evidence',
  }
}
