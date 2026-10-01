import type { NominalCandidate } from './measurement-v2'
import type { StandardsAuthorityResult } from './standards-shadow-solver'

export const FORMAL_NOMINAL_PROJECTION_SCHEMA = 'hcsi.formal-nominal-projection.v1' as const

export interface FormalNominalProjection {
  schema_version: typeof FORMAL_NOMINAL_PROJECTION_SCHEMA
  candidate_id: string
  designation: string
  standard_system: NominalCandidate['standard_system']
  family: string
  standard_ref: NominalCandidate['standard_ref']
  standards_snapshot: StandardsAuthorityResult['standards_snapshot']
  nominal: NominalCandidate['nominal']
}

/**
 * The only resolver allowed to cross from a standards decision into public
 * formal specification. Invalid selected IDs are hard-invalid states.
 */
export function resolveSelectedFormalCandidate(authority: StandardsAuthorityResult): NominalCandidate | null {
  const id = authority.decision.selected_candidate_id
  if (id === null) return null
  const matches = authority.formal_candidates.filter(candidate => candidate.candidate_id === id)
  if (matches.length !== 1) {
    throw new Error(`invalid_selected_standards_candidate:${id}:matches=${matches.length}`)
  }
  return matches[0]
}

export function projectSelectedFormalNominal(authority: StandardsAuthorityResult): FormalNominalProjection | null {
  const candidate = resolveSelectedFormalCandidate(authority)
  if (!candidate) return null
  return {
    schema_version:FORMAL_NOMINAL_PROJECTION_SCHEMA,
    candidate_id:candidate.candidate_id,
    designation:candidate.designation,
    standard_system:candidate.standard_system,
    family:candidate.family,
    standard_ref:{...candidate.standard_ref},
    standards_snapshot:{...authority.standards_snapshot},
    nominal:{...candidate.nominal},
  }
}

export function renderFormalDesignation(projection: FormalNominalProjection | null): string | null {
  return projection?.designation ?? null
}
