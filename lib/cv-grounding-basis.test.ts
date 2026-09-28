import assert from 'node:assert/strict'
import type { MeasurementResult } from './measurement'
import { buildCvGroundingBasis } from './cv-grounding-basis'

const dim = (mm: number) => ({
  status: 'measured' as const, value_px: mm * 10, value_mm: mm,
  confidence: 'verified' as const, risk_signals: [], reason_codes: [], diagnostics: {},
})
const measurement = {
  dimensions: {
    D: dim(4.17), P: dim(0.8), L_underhead: dim(10.27), L_overall: dim(13.08),
    B: { ...dim(8), confidence: 'measured_with_risk' as const,
      risk_signals: ['thread_boundary_resolution_limited_by_visible_pitch'] },
    K: dim(2.84), DK: dim(8.287),
  },
  head_geometry: {
    status: 'measured', quality: 'reliable', length_convention_evidence: 'protruding',
    height_to_width: 0.343, bearing_width_ratio: 0.972, top_width_ratio: 0.555,
  },
} as unknown as MeasurementResult

const protruding = buildCvGroundingBasis(measurement, true)
assert.equal(protruding.mode, 'cv_grounded_specification')
assert.equal(protruding.hard_physical_facts.purchase_length_dimension, 'L_underhead')
assert.equal(protruding.hard_physical_facts.purchase_length_mm, 10.27)
assert.equal(protruding.hard_physical_facts.derived_tpi, 31.75)
assert.equal(protruding.optional_thread_extent?.role, 'support_only')
assert.equal(protruding.arithmetic_nominal_hints.nearest_numbered_screw?.designation, '#8')
assert.equal(protruding.arithmetic_nominal_hints.nearest_integer_tpi, 32)
assert.equal(protruding.arithmetic_nominal_hints.imperial_fraction_candidates[0]?.fraction_inch, '13/32')
assert.equal(protruding.arithmetic_nominal_hints.imperial_fraction_candidates[0]?.absolute_difference_mm, 0.04875)

measurement.head_geometry!.length_convention_evidence = 'countersunk'
const countersunk = buildCvGroundingBasis(measurement, true)
assert.equal(countersunk.hard_physical_facts.purchase_length_dimension, 'L_overall')
assert.equal(countersunk.hard_physical_facts.purchase_length_mm, 13.08)
assert.equal(buildCvGroundingBasis(measurement, false).mode, 'appearance_only')
console.log('CV grounding basis: physical premise is established before image semantics')
