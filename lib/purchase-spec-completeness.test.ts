import assert from 'node:assert/strict'
import type { IdentificationResult } from './identification'
import type { PurchaseGate } from './cv-purchase-policy'
import type { DriveEvidence } from './drive-evidence'
import { assessPurchaseSpecificationCompleteness } from './purchase-spec-completeness'

const gate: PurchaseGate = {
  allowed: true, stage: 'final', reasons: [],
  required_dimensions: ['D', 'P', 'L_underhead'], selected_length: 'L_underhead',
  selected_length_mm: 12,
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
assert.equal(assessPurchaseSpecificationCompleteness({
  ...result, fastener_interpretation: {
    ...result.fastener_interpretation!, nominal_specification: 'M3 × 0.5 × 11 mm',
  },
}, gate, visibleDrive).reason_codes.includes('nominal_length_inconsistent'), true)
assert.equal(
  assessPurchaseSpecificationCompleteness({
    ...result,
    fastener_interpretation: { ...result.fastener_interpretation!, nominal_specification: 'M3 × 12 mm' },
  }, gate, visibleDrive).complete,
  false,
)
const sideViewDrive = assessPurchaseSpecificationCompleteness(result, gate, {
  ...visibleDrive, display_form: '待確認', form_observed: false,
})
assert.equal(sideViewDrive.complete, true, 'drive face is not required for dimensional purchase evidence')
assert.deepEqual(sideViewDrive.reason_codes, [])
assert.deepEqual(sideViewDrive.optional_unconfirmed_fields, ['drive_form', 'drive_size'])
assert.deepEqual(assessPurchaseSpecificationCompleteness(result, gate, visibleDrive).optional_unconfirmed_fields, ['drive_size'])
assert.equal(assessPurchaseSpecificationCompleteness(result, {
  ...gate, allowed: false,
}, visibleDrive).reason_codes.includes('cv_purchase_gate_blocked'), true)
console.log('Purchase completeness: complete D/P/L does not depend on optional drive evidence')
