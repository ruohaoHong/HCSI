import assert from 'node:assert/strict'
import type { IdentificationResult } from './identification'
import type { PurchaseGate } from './cv-purchase-policy'
import type { DriveEvidence } from './drive-evidence'
import { assessPurchaseSpecificationCompleteness } from './purchase-spec-completeness'

const gate: PurchaseGate = {
  allowed: true, stage: 'final', reasons: [],
  required_dimensions: ['D', 'P', 'L_underhead'],
  selected_length: 'L_underhead', selected_length_mm: 12,
}
const result = {
  category: 'fasteners',
  fastener_interpretation: {
    head_style: 'pan', drive_form: '十字', thread_system: 'metric',
    length_convention: 'under_head', nominal_specification: 'M3 × 0.5 × 12 mm',
  },
} as unknown as IdentificationResult
const selectedStandardsDecision = {
  selected_candidate_id: 'hcsi-standards-v1-2026-10-01:metric-m3-p0_5',
  purchase_ready: true,
}
const unresolvedStandardsDecision = {
  selected_candidate_id: null,
  purchase_ready: false,
}

const visibleDrive: DriveEvidence = {
  display_form: '十字', form_observed: true, size_status: 'not_measured', reason_codes: [],
}

assert.equal(assessPurchaseSpecificationCompleteness(result, gate, visibleDrive, selectedStandardsDecision).complete, true)
assert.equal(assessPurchaseSpecificationCompleteness({
  ...result,
  fastener_interpretation: { ...result.fastener_interpretation!, nominal_specification: '' },
}, gate, visibleDrive, selectedStandardsDecision).reason_codes.includes('nominal_specification_missing'), true)

const sideViewDrive = assessPurchaseSpecificationCompleteness(result, gate, {
  ...visibleDrive, display_form: '待確認', form_observed: false,
}, selectedStandardsDecision)
assert.equal(sideViewDrive.complete, true, 'drive face is not required for dimensional purchase evidence')
assert.deepEqual(sideViewDrive.optional_unconfirmed_fields, ['drive_form', 'drive_size'])
assert.equal(assessPurchaseSpecificationCompleteness(result, {
  ...gate, allowed: false,
}, visibleDrive, selectedStandardsDecision).reason_codes.includes('cv_purchase_gate_blocked'), true)
assert.equal(
  assessPurchaseSpecificationCompleteness(result, gate, visibleDrive, unresolvedStandardsDecision)
    .reason_codes.includes('standards_candidate_not_selected'),
  true,
)
assert.equal(
  assessPurchaseSpecificationCompleteness(result, gate, visibleDrive, unresolvedStandardsDecision).complete,
  false,
)
console.log('Purchase completeness: standards selection is mandatory; legacy nominal and drive evidence cannot open readiness')
