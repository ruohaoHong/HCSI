import type { MeasurementV2, NominalCandidate, NominalCandidateSet } from './measurement-v2'
import { MEASUREMENT_V2_SCHEMA, NOMINAL_CANDIDATE_SCHEMA } from './measurement-v2'
import type { StandardsCatalogue, ThreadStandardRecord } from './standards-catalogue'
import { validateStandardsCatalogue } from './standards-catalogue'

export interface ShadowSolverOptions {
  diameter_window_mm: number
  pitch_window_mm: number
}

const DEFAULT_OPTIONS: ShadowSolverOptions = {
  diameter_window_mm: 1.0,
  pitch_window_mm: 0.25,
}

function observed(measurement: MeasurementV2, quantity: string): number | null {
  return measurement.observations.find(item => item.quantity === quantity)?.value_mm ?? null
}

function residual(observedMm: number | null, nominalMm: number) {
  if (observedMm === null) return undefined
  return {
    observed_mm: observedMm,
    nominal_mm: nominalMm,
    residual_mm: observedMm - nominalMm,
  }
}

function candidateFromRecord(
  catalogue: StandardsCatalogue,
  record: ThreadStandardRecord,
  diameterMm: number | null,
  pitchMm: number | null,
): NominalCandidate {
  const sourceRefs = record.source_ids.join(',')
  return {
    candidate_id: `${catalogue.catalogue_id}:${record.record_id}`,
    standard_system: record.standard_system,
    family: record.family,
    designation: record.designation,
    nominal: {
      diameter_mm: record.nominal_diameter_mm,
      pitch_mm: record.nominal_pitch_mm,
      length_mm: null,
      length_convention: record.length_convention,
    },
    standard_ref: {
      catalogue_id: catalogue.catalogue_id,
      catalogue_version: catalogue.catalogue_version,
      record_id: record.record_id,
      provenance: sourceRefs,
    },
    residuals: {
      ...(diameterMm === null ? {} : { D: residual(diameterMm, record.nominal_diameter_mm)! }),
      ...(pitchMm === null ? {} : { P: residual(pitchMm, record.nominal_pitch_mm)! }),
    },
    score: {
      measurement_log_likelihood: null,
      rank: null,
    },
  }
}

/**
 * Shadow-mode enumeration only. It does not choose a winner and does not
 * modify raw measurements. Its only authority is the finite, validated
 * catalogue supplied by the caller.
 */
export function enumerateShadowCandidates(
  measurement: MeasurementV2,
  catalogue: StandardsCatalogue,
  options: Partial<ShadowSolverOptions> = {},
): NominalCandidateSet {
  if (measurement.schema_version !== MEASUREMENT_V2_SCHEMA) {
    throw new Error('unsupported_measurement_schema')
  }
  const validation = validateStandardsCatalogue(catalogue)
  if (!validation.valid) {
    throw new Error(`invalid_standards_catalogue:${validation.errors.join('|')}`)
  }

  const diameterMm = observed(measurement, 'D')
  const pitchMm = observed(measurement, 'P')
  const limits = { ...DEFAULT_OPTIONS, ...options }

  const records = catalogue.records.filter(record => {
    if (diameterMm !== null &&
        Math.abs(diameterMm - record.nominal_diameter_mm) > limits.diameter_window_mm) {
      return false
    }
    if (pitchMm !== null &&
        Math.abs(pitchMm - record.nominal_pitch_mm) > limits.pitch_window_mm) {
      return false
    }
    return true
  })

  return {
    schema_version: NOMINAL_CANDIDATE_SCHEMA,
    measurement_schema_version: MEASUREMENT_V2_SCHEMA,
    candidates: records.map(record =>
      candidateFromRecord(catalogue, record, diameterMm, pitchMm)),
    decision: {
      selected_candidate_id: null,
      status: records.length === 0 ? 'no_normative_match' : 'unresolved',
    },
  }
}
