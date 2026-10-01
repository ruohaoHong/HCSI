import type { FixedDimension, MeasurementResult } from './measurement'
import { buildMeasurementUncertainty, type MeasurementUncertaintyV1 } from './measurement-uncertainty'
import type { CandidatePhysicalEvidence } from './physical-evidence-likelihood'

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
  uncertainty: MeasurementUncertaintyV1
  immutability: {
    raw_measurements_are_nominally_snapped: false
    nominal_solver_may_modify_measurement: false
  }
}

export interface CandidateResidual {
  observed_mm: number
  nominal_mm: number
  residual_mm: number
  absolute_residual_mm: number
}

export interface LengthComparisonHypothesis {
  nominal_mm: number
  residual_mm: number
  label: string
}

export interface NominalCandidate {
  candidate_id: string
  standard_system: StandardSystem
  family: string
  designation: string
  nominal: {
    diameter_mm: number
    pitch_mm: number
    tpi?: number | null
    length_mm: number | null
    length_convention: LengthConvention
  }
  standard_ref: {
    catalogue_id: string
    catalogue_version: string
    snapshot_id?: string
    record_id: string
    provenance: string
  }
  residuals: Partial<Record<'D' | 'P' | 'L_underhead' | 'L_overall', CandidateResidual>>
  length_comparison?: {
    observed_dimension: 'L_underhead' | 'L_overall' | null
    observed_mm: number | null
    product_standard_length_validation: 'not_implemented_phase1'
    hypotheses: LengthComparisonHypothesis[]
  }
  physical_evidence?: CandidatePhysicalEvidence
  score: {
    model_id?: 'phase1-euclidean-dp-residual-v1'
    measurement_log_likelihood: number | null
    residual_distance_mm?: number | null
    status?: 'provisional_uncalibrated_no_covariance'
    rank: number | null
  }
}

export interface NominalCandidateSet {
  schema_version: NominalCandidateSchema
  measurement_schema_version: MeasurementV2Schema
  candidates: NominalCandidate[]
  standards_snapshot?: {
    snapshot_id: string
    snapshot_version: string
    coverage_status: string
  }
  decision: {
    selected_candidate_id: string | null
    status: 'unresolved' | 'selected' | 'no_normative_match' | 'shadow_unresolved'
    purchase_ready?: false
  }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

/**
 * One-way adapter from legacy CV output to the formal measurement contract.
 * No nominal input is accepted, so a standard candidate cannot snap or rewrite
 * D/P/L. Phase 2A records only uncertainty supported by CV evidence; missing covariance and bias magnitudes remain explicit null/unknown states.
 */
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

  return deepFreeze({
    schema_version: MEASUREMENT_V2_SCHEMA,
    source_schema_version: 'hcsi.measurement.v1',
    image_sha256: source.image_sha256,
    observations,
    head_geometry: source.head_geometry ? structuredClone(source.head_geometry) : source.head_geometry,
    scale: {
      system: source.scale_system,
      px_per_cm: source.scale_px_per_cm,
      px_per_inch: source.scale_px_per_inch,
      source: source.ruler.scale_source,
      confidence: source.ruler.scale_confidence,
    },
    capture_assumptions: structuredClone(source.capture_assumptions),
    uncertainty: buildMeasurementUncertainty(source),
    immutability: {
      raw_measurements_are_nominally_snapped: false,
      nominal_solver_may_modify_measurement: false,
    },
  })
}

export function getObservedMm(measurement: MeasurementV2, quantity: MeasurementQuantity): number | null {
  return measurement.observations.find(item => item.quantity === quantity)?.value_mm ?? null
}

export function isNominalCandidateSet(value: unknown): value is NominalCandidateSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const set = value as Record<string, unknown>
  if (set.schema_version !== NOMINAL_CANDIDATE_SCHEMA || set.measurement_schema_version !== MEASUREMENT_V2_SCHEMA) return false
  if (!Array.isArray(set.candidates) || !set.decision || typeof set.decision !== 'object') return false
  const decision = set.decision as Record<string, unknown>
  if (!['unresolved','selected','no_normative_match','shadow_unresolved'].includes(String(decision.status))) return false
  if (decision.selected_candidate_id !== null && typeof decision.selected_candidate_id !== 'string') return false

  const ids = new Set<string>()
  for (const raw of set.candidates) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
    const candidate = raw as Record<string, unknown>
    if (typeof candidate.candidate_id !== 'string' || ids.has(candidate.candidate_id)) return false
    ids.add(candidate.candidate_id)
    if (!['iso_metric','unified_inch'].includes(String(candidate.standard_system))) return false
    if (typeof candidate.family !== 'string' || typeof candidate.designation !== 'string') return false
    if (!candidate.nominal || typeof candidate.nominal !== 'object') return false
    const nominal = candidate.nominal as Record<string, unknown>
    if (!finite(nominal.diameter_mm) || !finite(nominal.pitch_mm)) return false
    if (nominal.length_mm !== null && !finite(nominal.length_mm)) return false
    if (!candidate.standard_ref || typeof candidate.standard_ref !== 'object') return false
    const standard = candidate.standard_ref as Record<string, unknown>
    if (!['catalogue_id','catalogue_version','record_id','provenance'].every(k => typeof standard[k] === 'string' && standard[k] !== '')) return false
  }
  if (decision.status === 'selected' && (typeof decision.selected_candidate_id !== 'string' || !ids.has(decision.selected_candidate_id))) return false
  return true
}
