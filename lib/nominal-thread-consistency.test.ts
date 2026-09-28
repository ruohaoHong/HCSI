import assert from 'node:assert/strict'
import type { MeasurementResult } from './measurement'
import { assessNominalThreadConsistency as assess } from './nominal-thread-consistency'

function m(D: number, P: number): MeasurementResult {
  const d = (value: number) => ({ status: 'measured' as const, value_px: 10,
    value_mm: value, confidence: 'verified' as const, risk_signals: [],
    reason_codes: [], diagnostics: {} })
  return { dimensions: { D: d(D), P: d(P) } } as unknown as MeasurementResult
}
assert.equal(assess('M6 × 1.0 × 40 mm', m(5.98, 1.015), 'metric').status, 'consistent')
assert.equal(assess('M8 × 1.25 × 40 mm', m(5.98, 1.015), 'metric').status, 'inconsistent')
assert.equal(assess('#8-32 UNC × 13/32"', m(4.17, 0.8), 'imperial').status, 'consistent')
assert.equal(assess('#10-24 × 3/8"', m(4.17, 0.8), 'imperial').status, 'inconsistent')
assert.equal(assess('1/4-20 × 1"', m(6.34, 1.27), 'imperial').status, 'consistent')
assert.equal(assess('unknown', m(4.17, 0.8), 'imperial').status, 'unparseable')
console.log('Nominal thread compatibility: D and P/TPI are checked against CV')
