import assert from 'node:assert/strict'
import type { MeasurementResult } from './measurement'
import type { PurchaseGate } from './cv-purchase-policy'
import { assessNominalCandidateConsistency, type InternalNominalMapping } from './nominal-candidate-consistency'

const dim = (mm: number) => ({ status: 'measured' as const, value_px: mm * 10,
  value_mm: mm, confidence: 'verified' as const, risk_signals: [],
  reason_codes: [], diagnostics: {} })
const measurement = { dimensions: { D: dim(4.17), P: dim(0.8) } } as unknown as MeasurementResult
const gate = { allowed: true, stage: 'final', reasons: [],
  required_dimensions: ['D','P','L_underhead'], selected_length: 'L_underhead',
  selected_length_mm: 10.27 } as PurchaseGate
const good: InternalNominalMapping = {
  nominal_diameter: { label: '#8', equivalent_mm: 4.1656 },
  nominal_pitch: { label: '32 TPI', equivalent_mm: 0.79375 },
  nominal_length: { label: '13/32 in', equivalent_mm: 10.31875 },
}
assert.equal(assessNominalCandidateConsistency(good, measurement, gate).status, 'consistent')
assert.equal(assessNominalCandidateConsistency({
  ...good, nominal_length: { label: '3/8 in', equivalent_mm: 9.525 },
}, measurement, gate).status, 'inconsistent')
assert.equal(assessNominalCandidateConsistency({
  ...good, nominal_diameter: { label: '', equivalent_mm: null },
}, measurement, gate).status, 'incomplete')
assert.equal(assessNominalCandidateConsistency(null, measurement, gate).status, 'incomplete')
console.log('Nominal candidate consistency: server compares LLM-declared equivalents only; no standards table')
