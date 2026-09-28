import type { PurchaseGate } from './cv-purchase-policy'
import type { MeasurementResult } from './measurement'

export interface InternalNominalMapping {
  nominal_diameter: { label: string; equivalent_mm: number | null }
  nominal_pitch: { label: string; equivalent_mm: number | null }
  nominal_length: { label: string; equivalent_mm: number | null }
}

export type CandidateComponentStatus =
  | 'consistent' | 'inconsistent' | 'missing_candidate' | 'missing_cv'

export interface CandidateComponentAgreement {
  status: CandidateComponentStatus
  label: string
  cv_mm: number | null
  candidate_mm: number | null
  difference_mm: number | null
  tolerance_mm: number | null
}

export interface NominalCandidateAgreement {
  status: 'consistent' | 'inconsistent' | 'incomplete' | 'no_trusted_cv'
  diameter: CandidateComponentAgreement
  pitch: CandidateComponentAgreement
  length: CandidateComponentAgreement
}

function nullablePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function measured(measurement: MeasurementResult | null, key: 'D' | 'P'): number | null {
  const dim = measurement?.dimensions?.[key]
  return dim?.status === 'measured' ? nullablePositive(dim.value_mm) : null
}

function isMappingPart(value: unknown): value is { label: string; equivalent_mm: number | null } {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.label === 'string' &&
    (v.equivalent_mm === null || typeof v.equivalent_mm === 'number')
}

export function isInternalNominalMapping(value: unknown): value is InternalNominalMapping {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return isMappingPart(v.nominal_diameter) &&
    isMappingPart(v.nominal_pitch) &&
    isMappingPart(v.nominal_length)
}

function compare(
  label: string,
  cvMm: number | null,
  candidateValue: number | null,
  tolerance: (cv: number) => number,
): CandidateComponentAgreement {
  const candidateMm = nullablePositive(candidateValue)
  if (cvMm === null) return {
    status: 'missing_cv', label, cv_mm: null, candidate_mm: candidateMm,
    difference_mm: null, tolerance_mm: null,
  }
  if (!label.trim() || candidateMm === null) return {
    status: 'missing_candidate', label, cv_mm: cvMm, candidate_mm: candidateMm,
    difference_mm: null, tolerance_mm: tolerance(cvMm),
  }
  const limit = tolerance(cvMm)
  const difference = Math.abs(cvMm - candidateMm)
  return {
    status: difference <= limit ? 'consistent' : 'inconsistent',
    label,
    cv_mm: cvMm,
    candidate_mm: candidateMm,
    difference_mm: Number(difference.toFixed(6)),
    tolerance_mm: Number(limit.toFixed(6)),
  }
}

export function assessNominalCandidateConsistency(
  mapping: InternalNominalMapping | null,
  measurement: MeasurementResult | null,
  gate: PurchaseGate,
): NominalCandidateAgreement {
  const D = measured(measurement, 'D')
  const P = measured(measurement, 'P')
  const L = nullablePositive(gate.selected_length_mm)
  const empty: InternalNominalMapping = {
    nominal_diameter: { label: '', equivalent_mm: null },
    nominal_pitch: { label: '', equivalent_mm: null },
    nominal_length: { label: '', equivalent_mm: null },
  }
  const value = mapping ?? empty
  const diameter = compare(value.nominal_diameter.label, D, value.nominal_diameter.equivalent_mm,
    cv => Math.max(0.18, cv * 0.04))
  const pitch = compare(value.nominal_pitch.label, P, value.nominal_pitch.equivalent_mm,
    cv => Math.max(0.04, cv * 0.05))
  const length = compare(value.nominal_length.label, L, value.nominal_length.equivalent_mm,
    cv => Math.max(0.20, cv * 0.015))
  const parts = [diameter, pitch, length]
  const status = parts.some(part => part.status === 'missing_cv')
    ? 'no_trusted_cv'
    : parts.some(part => part.status === 'missing_candidate')
      ? 'incomplete'
      : parts.some(part => part.status === 'inconsistent')
        ? 'inconsistent'
        : 'consistent'
  return { status, diameter, pitch, length }
}
