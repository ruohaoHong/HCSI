import assert from 'node:assert/strict'
import type { MeasurementResult } from './measurement'
import {
  MEASUREMENT_V2_SCHEMA,
  NOMINAL_CANDIDATE_SCHEMA,
  isNominalCandidateSet,
  toMeasurementV2,
} from './measurement-v2'

const source = {
  schema_version: 'hcsi.measurement.v1',
  image_sha256: 'a'.repeat(64),
  dimensions: {
    D: {
      status: 'measured',
      value_px: 137,
      value_mm: 13.7,
      confidence: 'verified',
      risk_signals: [],
      reason_codes: [],
      diagnostics: {},
    },
    P: {
      status: 'measured',
      value_px: 20.51,
      value_mm: 2.051,
      confidence: 'measured_with_risk',
      risk_signals: ['periodicity_weak'],
      reason_codes: [],
      diagnostics: {},
    },
  },
  head_geometry: null,
  scale_system: 'metric',
  scale_px_per_cm: 100,
  scale_px_per_inch: 254,
  ruler: { scale_source: 'metric_ticks', scale_confidence: 0.99 },
  capture_assumptions: {
    same_plane_required: true,
    same_plane_verified: true,
    same_plane_status: 'verified',
    near_overhead_required: true,
    near_overhead_status: 'verified',
    ruler_parallel_required: false,
    ruler_parallel_preferred: true,
  },
} as unknown as MeasurementResult

const v2 = toMeasurementV2(source)
assert.equal(v2.schema_version, MEASUREMENT_V2_SCHEMA)
assert.equal(v2.observations.find(item => item.quantity === 'D')?.value_mm, 13.7)
assert.equal(v2.observations.find(item => item.quantity === 'P')?.value_mm, 2.051)
assert.equal(v2.uncertainty.covariance_status, 'not_available_phase1')
assert.equal(v2.immutability.raw_measurements_are_nominally_snapped, false)
assert.equal(Object.isFrozen(v2), true)

// Candidate validation is structural: the catalogue owns validity. A candidate
// must carry provenance and a selected id must refer to an array member.
const valid = {
  schema_version: NOMINAL_CANDIDATE_SCHEMA,
  measurement_schema_version: MEASUREMENT_V2_SCHEMA,
  candidates: [{
    candidate_id: 'iso-metric:m14x2',
    standard_system: 'iso_metric',
    family: 'metric_coarse_thread',
    designation: 'M14 × 2.0',
    nominal: {
      diameter_mm: 14,
      pitch_mm: 2,
      length_mm: null,
      length_convention: 'head_underface_to_tip',
    },
    standard_ref: {
      catalogue_id: 'hcsi-standards',
      catalogue_version: 'test',
      record_id: 'metric-m14x2',
      provenance: 'test fixture only',
    },
    residuals: {},
    score: { measurement_log_likelihood: null, rank: null },
  }],
  decision: { selected_candidate_id: null, status: 'unresolved' },
}
assert.equal(isNominalCandidateSet(valid), true)

const hallucinatedWithoutProvenance = structuredClone(valid)
hallucinatedWithoutProvenance.candidates[0].designation = '#37-12'
hallucinatedWithoutProvenance.candidates[0].standard_ref.record_id = ''
assert.equal(isNominalCandidateSet(hallucinatedWithoutProvenance), false)

const badSelection: any = structuredClone(valid)
badSelection.decision = { selected_candidate_id: 'not-in-array', status: 'selected' }
assert.equal(isNominalCandidateSet(badSelection), false)

console.log('measurement.v2 preserves raw observations; candidate contract requires catalogue provenance')
