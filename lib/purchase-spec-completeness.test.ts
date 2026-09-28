import assert from 'node:assert/strict'
import type { IdentificationResult } from './identification'
import type { PurchaseGate } from './cv-purchase-policy'
import type { DriveEvidence } from './drive-evidence'
import type { MeasurementResult } from './measurement'
import type { InternalNominalMapping } from './nominal-candidate-consistency'
import { assessPurchaseSpecificationCompleteness } from './purchase-spec-completeness'

const gate: PurchaseGate = {
  allowed: true, stage: 'final', reasons: [],
  required_dimensions: ['D', 'P', 'L_underhead'], selected_length: 'L_underhead',
  selected_length_mm: 12,
}
const measurement = {
  dimensions: {
    D: { status: 'measured', value_px: 30, value_mm: 3.0, confidence: 'verified',
      risk_signals: [], reason_codes: [], diagnostics: {} },
    P: { status: 'measured', value_px: 5, value_mm: 0.5, confidence: 'verified',
      risk_signals: [], reason_codes: [], diagnostics: {} },
  },
} as unknown as MeasurementResult
const result = {
  category: 'fasteners',
  fastener_interpretation: {
    head_style: 'pan', drive_form: '十字', thread_system: 'metric',
    length_convention: 'under_head', nominal_specification: 'M3 × 0.5 × 12 mm',
  },
} as unknown as IdentificationResult
const mapping: InternalNominalMapping = {
  nominal_diameter: { label: 'M3', equivalent_mm: 3 },
  nominal_pitch: { label: '0.5 mm', equivalent_mm: 0.5 },
  nominal_length: { label: '12 mm', equivalent_mm: 12 },
}
const visibleDrive: DriveEvidence = {
  display_form: '十字', form_observed: true, size_status: 'not_measured', reason_codes: [],
}

assert.equal(assessPurchaseSpecificationCompleteness(
  result, gate, visibleDrive, measurement, mapping).complete, true)
assert.equal(assessPurchaseSpecificationCompleteness(
  result, gate, visibleDrive, measurement, {
    ...mapping, nominal_length: { label: '11 mm', equivalent_mm: 11 },
  }).reason_codes.includes('nominal_candidate_inconsistent'), true)
assert.equal(assessPurchaseSpecificationCompleteness(
  result, gate, visibleDrive, measurement, {
    ...mapping, nominal_pitch: { label: '', equivalent_mm: null },
  }).reason_codes.includes('nominal_candidate_incomplete'), true)

const sideViewDrive = assessPurchaseSpecificationCompleteness(result, gate, {
  ...visibleDrive, display_form: '待確認', form_observed: false,
}, measurement, mapping)
assert.equal(sideViewDrive.complete, true, 'drive face is not required for dimensional purchase evidence')
assert.deepEqual(sideViewDrive.optional_unconfirmed_fields, ['drive_form', 'drive_size'])
assert.equal(assessPurchaseSpecificationCompleteness(result, {
  ...gate, allowed: false,
}, visibleDrive, measurement, mapping).reason_codes.includes('cv_purchase_gate_blocked'), true)
console.log('Purchase completeness: LLM nominal mapping is internal; drive remains optional')
