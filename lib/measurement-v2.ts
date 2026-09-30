import type { FixedDimension, MeasurementResult } from './measurement'

export const MEASUREMENT_V2_SCHEMA = 'hcsi.measurement.v2' as const
export const NOMINAL_CANDIDATE_SCHEMA = 'hcsi.nominal-candidates.v1' as const

export type MeasurementV2Schema = typeof MEASUREMENT_V2_SCHEMA
export type NominalCandidateSchema = typeof NOMINAL_CANDIDATE_SCHEMA
export type StandardSystem = 'iso_metric' | 'unified_inch'
export type MeasurementQuantity = FixedDimension
export type LengthConvention =
  | 'head_underface_to_tip'
  | 'head_top_to_tip'
  | 'set_screw_overall'
  | 'family_specific'
  | 'unknown'

export interface EvidenceRef {
  source: 'dimension' | 'geometry_step' | 'head_geometry' | 'scale' | 'capture_assumption'
  key: string
}

export interface MeasurementObservationV2 {
  quantity: MeasurementQuantity
  value_mm: number
  value_px: number | null
  confidence: 'verified' | 'measured_with_risk'
  risk_signals: string[]
  reason_codes: string[]
  evidence_refs: EvidenceRef[]
}

export interface MeasurementV2 {
  schema_version: MeasurementV2Schema
  source_schema_version: 'hcsi.measurement.v1'
  image_sha256: string
  observations: MeasurementObservationV2[]
  head_geometry: MeasurementResult['head_geometry']
  scale: {
    system: MeasurementResult['scale_system']
    px_per_cm: number | null
    px_per_inch: number | null
    source: MeasurementResult['ruler']['scale_source']
    confidence: number
  }
  capture_assumptions: MeasurementResult['capture_assumptions']
  source_measurement: MeasurementResult
}

/**
 * A normative candidate is a catalogue-backed designation, never a free-form
 * LLM proposal. The raw measurement remains in MeasurementV2 and is not
 * overwritten by any nominal value here.
 */
export interface NominalCandidate {
  candidate_id: string
  standard_system: StandardSystem
  family: string
  designation: string
  nominal: {
    diameter_mm: number
    pitch_mm: number
    length_mm: number | null
    length_convention: LengthConvention
  }
  standard_ref: {
    catalogue_id: string
    catalogue_version: string
    record_id: string
    provenance: string
  }
  residuals: Partial<Record<'D' | 'P' | 'L_underhead' | 'L_overall', {
    observed_mm: number
    nominal_mm: number
    residual_mm: number
  }>>
  score: {
    measurement_log_likelihood: number | null
    rank: number | null
  }
}

export interface NominalCandidateSet {
  schema_version: NominalCandidateSchema
  measurement_schema_version: MeasurementV2Schema
  candidates: NominalCandidate[]
  decision: {
    selected_candidate_id: string | null
    status: 'unresolved' | 'selected' | 'no_normative_match'
  }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function toMeasurementV2(source: MeasurementResult): MeasurementV2 {
  const observations: MeasurementObservationV2[] = []
  for (const [quantity, evidence] of Object.entries(source.dimensions ?? {})) {
    if (!evidence || evidence.status !== 'measured' || !finite(evidence.value_mm)) continue
    observations.push({
      quantity: quantity as MeasurementQuantity,
      value_mm: evidence.value_mm,
      value_px: finite(evidence.value_px) ? evidence.value_px : null,
      confidence: evidence.confidence === 'verified' ? 'verified' : 'measured_with_risk',
      risk_signals: [...evidence.risk_signals],
      reason_codes: [...evidence.reason_codes],
      evidence_refs: [{ source: 'dimension', key: quantity }],
    })
  }

  return {
    schema_version: MEASUREMENT_V2_SCHEMA,
    source_schema_version: 'hcsi.measurement.v1',
    image_sha256: source.image_sha256,
    observations,
    head_geometry: source.head_geometry,
    scale: {
      system: source.scale_system,
      px_per_cm: source.scale_px_per_cm,
      px_per_inch: source.scale_px_per_inch,
      source: source.ruler.scale_source,
      confidence: source.ruler.scale_confidence,
    },
    capture_assumptions: source.capture_assumptions,
    source_measurement: source,
  }
}

export function isNominalCandidateSet(value: unknown): value is NominalCandidateSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const set = value as Record<string, unknown>
  if (set.schema_version !== NOMINAL_CANDIDATE_SCHEMA) return false
  if (set.measurement_schema_version !== MEASUREMENT_V2_SCHEMA) return false
  if (!Array.isArray(set.candidates)) return false
  if (!set.decision || typeof set.decision !== 'object' || Array.isArray(set.decision)) return false

  const decision = set.decision as Record<string, unknown>
  if (!['unresolved', 'selected', 'no_normative_match'].includes(String(decision.status))) return false
  if (decision.selected_candidate_id !== null && typeof decision.selected_candidate_id !== 'string') return false
  if (decision.status === 'selected' && typeof decision.selected_candidate_id !== 'string') return false
  if (decision.status !== 'selected' && decision.selected_candidate_id !== null) return false

  const ids = new Set<string>()
  for (const item of set.candidates) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const candidate = item as Record<string, unknown>
    if (typeof candidate.candidate_id !== 'string' || ids.has(candidate.candidate_id)) return false
    ids.add(candidate.candidate_id)
    if (!['iso_metric', 'unified_inch'].includes(String(candidate.standard_system))) return false
    if (typeof candidate.family !== 'string' || typeof candidate.designation !== 'string') return false
    if (!candidate.nominal || typeof candidate.nominal !== 'object' || Array.isArray(candidate.nominal)) return false
    const nominal = candidate.nominal as Record<string, unknown>
    if (!finite(nominal.diameter_mm) || !finite(nominal.pitch_mm)) return false
    if (nominal.length_mm !== null && !finite(nominal.length_mm)) return false
    if (!['head_underface_to_tip', 'head_top_to_tip', 'set_screw_overall', 'family_specific', 'unknown'].includes(String(nominal.length_convention))) return false
    if (!candidate.standard_ref || typeof candidate.standard_ref !== 'object' || Array.isArray(candidate.standard_ref)) return false
    const standard = candidate.standard_ref as Record<string, unknown>
    if (!['catalogue_id', 'catalogue_version', 'record_id', 'provenance'].every(key => typeof standard[key] === 'string' && standard[key] !== '')) return false
  }

  if (decision.status === 'selected' && !ids.has(String(decision.selected_candidate_id))) return false
  return true
}
