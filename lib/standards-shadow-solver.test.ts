import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import type { MeasurementV2 } from './measurement-v2'
import { MEASUREMENT_V2_SCHEMA } from './measurement-v2'
import {
  STANDARDS_CATALOGUE_SCHEMA,
  type StandardsCatalogue,
} from './standards-catalogue'
import { enumerateShadowCandidates } from './standards-shadow-solver'

const measurement = {
  schema_version: MEASUREMENT_V2_SCHEMA,
  observations: [
    { quantity: 'D', value_mm: 13.7 },
    { quantity: 'P', value_mm: 2.051 },
  ],
} as MeasurementV2

const catalogue: StandardsCatalogue = {
  schema_version: STANDARDS_CATALOGUE_SCHEMA,
  catalogue_id: 'shadow-test',
  catalogue_version: 'test-v1',
  scope: {
    systems: ['iso_metric', 'unified_inch'],
    families: ['machine_thread'],
  },
  sources: [{
    source_id: 'fixture',
    authority: 'test',
    title: 'test fixture',
    edition: 'test',
    locator: 'local test',
    access: 'derived_engineering',
    notes: ['Not production standards data.'],
  }],
  records: [
    {
      record_id: 'metric-near',
      standard_system: 'iso_metric',
      family: 'machine_thread',
      designation: 'metric fixture',
      nominal_diameter_mm: 14,
      nominal_pitch_mm: 2,
      length_convention: 'head_underface_to_tip',
      source_ids: ['fixture'],
      aliases: [],
    },
    {
      record_id: 'inch-near',
      standard_system: 'unified_inch',
      family: 'machine_thread',
      designation: 'inch fixture',
      nominal_diameter_mm: 13.5,
      nominal_pitch_mm: 2.1167,
      length_convention: 'head_underface_to_tip',
      source_ids: ['fixture'],
      aliases: [],
    },
    {
      record_id: 'far',
      standard_system: 'iso_metric',
      family: 'machine_thread',
      designation: 'far fixture',
      nominal_diameter_mm: 10,
      nominal_pitch_mm: 1.5,
      length_convention: 'head_underface_to_tip',
      source_ids: ['fixture'],
      aliases: [],
    },
  ],
}

test('enumerates cross-system catalogue candidates without choosing a winner', () => {
  const before = structuredClone(measurement)
  const result = enumerateShadowCandidates(measurement, catalogue)

  assert.equal(result.decision.status, 'unresolved')
  assert.equal(result.decision.selected_candidate_id, null)
  assert.deepEqual(result.candidates.map(candidate => candidate.standard_system),
    ['iso_metric', 'unified_inch'])
  assert.deepEqual(measurement, before)
  assert.equal(measurement.observations[0].value_mm, 13.7)
  assert.equal(measurement.observations[1].value_mm, 2.051)
})

test('residuals are against raw observations and are not nominal snapping', () => {
  const result = enumerateShadowCandidates(measurement, catalogue)
  const metric = result.candidates.find(candidate => candidate.standard_system === 'iso_metric')
  assert.ok(metric)
  assert.ok(Math.abs((metric.residuals.D?.residual_mm ?? 0) - -0.3) < 1e-12)
  assert.ok(Math.abs((metric.residuals.P?.residual_mm ?? 0) - 0.051) < 1e-12)
  assert.equal(metric.score.measurement_log_likelihood, null)
  assert.equal(metric.score.rank, null)
})

test('returns no normative match rather than inventing a designation', () => {
  const result = enumerateShadowCandidates(measurement, catalogue, {
    diameter_window_mm: 0.01,
    pitch_window_mm: 0.01,
  })
  assert.equal(result.decision.status, 'no_normative_match')
  assert.equal(result.candidates.length, 0)
})

test('rejects catalogue records without provenance before enumeration', () => {
  const invalid = structuredClone(catalogue)
  invalid.records[0].source_ids = []
  assert.throws(
    () => enumerateShadowCandidates(measurement, invalid),
    /invalid_standards_catalogue:missing_provenance:metric-near/,
  )
})
