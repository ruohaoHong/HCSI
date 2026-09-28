import assert from 'node:assert/strict'
import type { IdentificationResult } from './identification'
import type { FixedDimension, MeasurementResult } from './measurement'
import { evaluateHeadStyleConsistency } from './head-style-consistency'
import { finalPurchaseGate } from './cv-purchase-policy'
import { sanitizeDriveEvidence } from './drive-evidence'
import { assessPurchaseSpecificationCompleteness } from './purchase-spec-completeness'
import { selectLengthFromCv } from './cv-length-policy'

const dimensions = Object.fromEntries(
  (['D', 'P', 'L_underhead', 'L_overall', 'K', 'DK'] as FixedDimension[]).map(key => [key, {
    status: 'measured', value_px: 100, value_mm: 10,
    confidence: 'verified', risk_signals: [], reason_codes: [], diagnostics: {},
  }]),
)
dimensions.D = { ...dimensions.D!, value_mm: 6 }
dimensions.P = { ...dimensions.P!, value_mm: 1 }

const measurement = {
  measurement_status: 'valid', scale_px_per_cm: 100,
  ruler: { detected: true },
  object: { detected: true, contour_reliable: true },
  confidence_evaluation: { checks: [
    'scale_available', 'scale_observation_support', 'perspective_risk',
    'object_geometry', 'segmentation_risk',
  ].map(id => ({ id, status: 'passed' })) },
  dimensions,
  head_geometry: {
    status: 'measured', quality: 'reliable', reason_codes: [],
    boundary_source: 'coarse_transition', sample_count: 40,
    head_height_px: 30, head_width_p90_px: 60, shank_width_px: 25,
    height_to_width: 0.5, bearing_width_ratio: 0.65, mid_width_ratio: 0.8,
    top_width_ratio: 0.95, max_width_position: 0.8, width_trend: 0.2,
    centerline_drift_ratio: 0.02, profile_roughness: 0.01,
    length_convention_evidence: 'countersunk', profile_points: [],
  },
} as unknown as MeasurementResult

const conflict = evaluateHeadStyleConsistency('pan', measurement)
assert.equal(conflict.resolved_head_style, 'flat_countersunk')
assert.equal(selectLengthFromCv(conflict.resolved_head_style, measurement).dimension, 'L_overall')
assert.equal(finalPurchaseGate(measurement, conflict.resolved_head_style, conflict).allowed, false)

const supported = evaluateHeadStyleConsistency('flat_countersunk', measurement)
const length = selectLengthFromCv(supported.resolved_head_style, measurement)
assert.equal(length.dimension, 'L_overall')
const gate = finalPurchaseGate(measurement, supported.resolved_head_style, supported)
assert.equal(gate.allowed, true)
const drive = sanitizeDriveEvidence('Phillips PH2')
assert.equal(drive.display_form, '十字（尺寸待確認）')
const result = {
  category: 'fasteners',
  fastener_interpretation: {
    head_style: supported.resolved_head_style,
    drive_form: drive.display_form,
    thread_system: 'metric',
    length_convention: length.convention,
    nominal_specification: 'M6 × 1.0 × 10 mm',
  },
} as unknown as IdentificationResult
assert.equal(assessPurchaseSpecificationCompleteness(result, gate, drive).complete, true)
const driveNotVisible = sanitizeDriveEvidence('待確認')
assert.equal(assessPurchaseSpecificationCompleteness(result, gate, driveNotVisible).complete, true)
assert.deepEqual(assessPurchaseSpecificationCompleteness(result, gate, driveNotVisible).optional_unconfirmed_fields,
  ['drive_form', 'drive_size'])

measurement.dimensions!.B = {
  status: 'not_measured', value_px: null, value_mm: null,
  confidence: 'not_measured', risk_signals: [], reason_codes: ['optional_B_missing'], diagnostics: {},
}
assert.equal(finalPurchaseGate(measurement, supported.resolved_head_style, supported).allowed, true)

measurement.head_geometry!.quality = 'degraded'
assert.equal(finalPurchaseGate(measurement, supported.resolved_head_style, supported).allowed, false)
console.log('CV-first v2 integration: dimensions can survive silhouette degradation while the final purchase gate remains conservative')
