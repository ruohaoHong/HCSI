import { strict as assert } from 'node:assert'
import type { MeasurementResult, FixedDimension } from './measurement'
import { preflightPurchaseGate, finalPurchaseGate, publicPurchaseGuidance } from './cv-purchase-policy'

const keys: FixedDimension[] = ['D','P','L_underhead','L_overall','B','K','DK']
function fixture(): MeasurementResult {
  return {
    measurement_status: 'valid', scale_px_per_cm: 100,
    ruler: { detected: true },
    object: { detected: true, contour_reliable: true },
    confidence_evaluation: { checks: [
      'scale_available','scale_observation_support','perspective_risk','object_geometry','segmentation_risk'
    ].map(id => ({ id, status: 'passed' })) },
    dimensions: Object.fromEntries(keys.map(key => [key, {
      status: 'measured', value_px: 100, value_mm: 10, confidence: 'verified',
      risk_signals: [], reason_codes: [], diagnostics: {},
    }])),
    head_geometry: {
      status: 'measured', quality: 'reliable', reason_codes: [],
      boundary_source: 'bearing_plane', sample_count: 30,
      head_height_px: 30, head_width_p90_px: 60, shank_width_px: 25,
      height_to_width: 0.5, bearing_width_ratio: 0.9, mid_width_ratio: 0.9,
      top_width_ratio: 0.8, max_width_position: 0.2, width_trend: -0.1,
      centerline_drift_ratio: 0.02, profile_roughness: 0.01,
      length_convention_evidence: 'protruding', profile_points: [],
    },
  } as unknown as MeasurementResult
}
let cv = fixture()
assert.equal(preflightPurchaseGate(cv).allowed, true)
assert.equal(finalPurchaseGate(cv, 'pan').selected_length, 'L_underhead')
assert.equal(finalPurchaseGate(cv, 'flat_countersunk').selected_length, 'L_overall')
cv.dimensions!.B = { status: 'not_measured', value_px: null, value_mm: null,
  confidence: 'not_measured', risk_signals: ['thread_tip_boundary_unresolved'],
  reason_codes: ['thread_tip_boundary_unresolved'], diagnostics: {} }
assert.equal(finalPurchaseGate(cv, 'pan').allowed, true, 'B never blocks')
cv.dimensions!.L_overall = { ...cv.dimensions!.L_overall!, status: 'not_measured',
  value_px: null, value_mm: null, confidence: 'not_measured' }
assert.equal(finalPurchaseGate(cv, 'pan').allowed, true, 'wrong L should not block')
assert.equal(finalPurchaseGate(cv, 'flat_countersunk').allowed, false, 'correct L required')
assert.equal(finalPurchaseGate(cv, 'unknown').allowed, false, 'unknown head cannot choose L')
cv.dimensions!.D = { ...cv.dimensions!.D!, status: 'not_measured', value_px: null, value_mm: null,
  confidence: 'not_measured' }
assert.equal(preflightPurchaseGate(cv).allowed, false, 'P alone is insufficient')
assert.equal(publicPurchaseGuidance(finalPurchaseGate(cv, 'pan'), '螺絲').includes('尚未可靠量到'), true)
cv = fixture()
cv.dimensions!.D!.risk_signals = ['same_plane_unverified']
assert.equal(preflightPurchaseGate(cv).allowed, true, 'unknown capture metadata is not a measurement failure')
cv.dimensions!.D!.risk_signals = ['edge_diameter_unreliable']
assert.equal(preflightPurchaseGate(cv).allowed, false, 'observable CV risks must not be waived')
cv = fixture()
cv.confidence_evaluation.checks.find(c => c.id === 'perspective_risk')!.status = 'failed'
assert.equal(preflightPurchaseGate(cv).allowed, false, 'excessive perspective blocks precise purchase spec')
cv = fixture()
cv.confidence_evaluation.checks.push({ id: 'same_plane', status: 'failed' } as never)
assert.equal(preflightPurchaseGate(cv).allowed, false, 'explicitly rejected coplanarity must block')
cv = fixture()
cv.head_geometry!.quality = 'degraded'
assert.equal(preflightPurchaseGate(cv).allowed, true,
  'degraded silhouette must not erase otherwise valid dimensional preflight evidence')
assert.equal(finalPurchaseGate(cv, 'pan').allowed, false,
  'degraded silhouette still blocks a complete purchase spec until head semantics are resolved safely')
assert.equal(finalPurchaseGate(cv, 'pan').reasons.includes('head_geometry_unreliable'), true)
cv = fixture()
cv.head_geometry!.length_convention_evidence = 'countersunk'
assert.equal(finalPurchaseGate(cv, 'pan').allowed, false, 'physical head conflict blocks a complete purchase spec')
console.log('CV purchase evidence gates: all tests passed')
