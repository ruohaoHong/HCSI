import assert from 'node:assert/strict'
import type { IdentificationResult } from './identification'
import type { PurchaseGate } from './cv-purchase-policy'
import type { DriveEvidence } from './drive-evidence'
import { assessPurchaseSpecificationCompleteness } from './purchase-spec-completeness'

const gate: PurchaseGate = {
  allowed: true, stage: 'final', reasons: [],
  required_dimensions: ['D', 'P', 'L_underhead'], selected_length: 'L_underhead',
}
const result = {
  category: 'fasteners',
  fastener_interpretation: {
    head_style: 'pan', drive_form: '十字', thread_system: 'metric',
    length_convention: 'under_head', nominal_specification: 'M3 × 0.5 × 12 mm',
  },
} as unknown as IdentificationResult
const visibleDrive: DriveEvidence = {
  display_form: '十字', form_observed: true, size_status: 'not_measured', reason_codes: [],
}

assert.equal(assessPurchaseSpecificationCompleteness(result, gate, visibleDrive).complete, true)
assert.equal(
  assessPurchaseSpecificationCompleteness({
    ...result,
    fastener_interpretation: { ...result.fastener_interpretation!, nominal_specification: 'M3 × 12 mm' },
  }, gate, visibleDrive).complete,
  false,
)
assert.equal(assessPurchaseSpecificationCompleteness(result, gate, {
  ...visibleDrive, form_observed: false,
}).reason_codes.includes('drive_form_unresolved'), true)
assert.equal(assessPurchaseSpecificationCompleteness(result, {
  ...gate, allowed: false,
}, visibleDrive).reason_codes.includes('cv_purchase_gate_blocked'), true)
console.log('Purchase completeness: CV gate, head/thread semantics, D-P-L nominal components, and drive form are required')
