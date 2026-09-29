import assert from 'node:assert/strict'
import { selectLengthFromCv } from './cv-length-policy'
import type { MeasurementResult } from './measurement'

const measured = (value_px: number, value_mm: number) => ({
  status: 'measured' as const, value_px, value_mm,
  confidence: 'measured_with_risk' as const, risk_signals: ['same_plane_unverified'],
  reason_codes: [], diagnostics: {},
})
const unavailable = {
  status: 'not_measured' as const, value_px: null, value_mm: null,
  confidence: 'not_measured' as const, risk_signals: ['thread_boundaries_not_resolved'],
  reason_codes: ['thread_boundaries_not_resolved'], diagnostics: {},
}
const cv = { dimensions: {
  D: measured(48, 4.7), P: measured(8, 0.78),
  L_underhead: measured(224, 21.9), L_overall: measured(249, 24.3),
  B: unavailable, K: measured(25, 2.4), DK: measured(98, 9.6),
} } as unknown as MeasurementResult
const frozen = JSON.stringify(cv)

const other = selectLengthFromCv('other', cv)
assert.equal(other.convention, 'unresolved')
assert.equal(other.value_mm, null)
assert.equal(other.candidates.under_head?.value_mm, 21.9)
assert.equal(other.candidates.overall?.value_mm, 24.3)
assert.equal(cv.dimensions?.D?.value_mm, 4.7)
assert.equal(JSON.stringify(cv), frozen, 'LLM other must never mutate any successful CV result')

const pan = selectLengthFromCv('pan', cv)
assert.equal(pan.convention, 'under_head')
assert.equal(pan.value_px, 224)
assert.equal(pan.value_mm, 21.9)
const flat = selectLengthFromCv('flat_countersunk', cv)
assert.equal(flat.convention, 'overall')
assert.equal(flat.value_mm, 24.3)
const unknown = selectLengthFromCv('unknown', cv)
assert.equal(unknown.convention, 'unresolved')
assert.equal(unknown.value_mm, null)
assert.equal(JSON.stringify(cv), frozen)
console.log('CV-first length policy: other/unknown preserves all raw CV evidence; pan and flat conventions select raw candidate')
