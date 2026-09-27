import type { FixedDimension, MeasurementResult } from './measurement'
import type { HeadStyle } from './identification'
import { selectLengthFromCv } from './cv-length-policy'

export type PurchaseGateReason =
  | 'measurement_unavailable' | 'scale_unreliable' | 'object_unreliable'
  | 'geometry_quality_unreliable' | 'missing_D' | 'missing_P'
  | 'missing_head_geometry' | 'missing_length_candidate'
  | 'head_unresolved' | 'selected_length_unmeasured'

export interface PurchaseGate {
  allowed: boolean
  stage: 'cv_preflight' | 'final'
  reasons: PurchaseGateReason[]
  required_dimensions: FixedDimension[]
  selected_length: 'L_underhead' | 'L_overall' | null
}

// Only image-observable checks gate CV readiness. A single photograph cannot
// independently establish coplanarity, but unknown capture metadata alone
// must not turn successful physical observations into a measurement failure.
const OBSERVABLE_REQUIRED_CHECKS = [
  'scale_available', 'scale_observation_support', 'perspective_risk',
  'object_geometry', 'segmentation_risk',
] as const
const CAPTURE_METADATA_ONLY = new Set([
  'same_plane_unverified', 'capture_orientation_unverified',
  'object_ruler_alignment_unknown',
])
function usableDimension(measurement: MeasurementResult | null, key: FixedDimension): boolean {
  const dim = measurement?.dimensions?.[key]
  if (dim?.status !== 'measured' || !Number.isFinite(dim.value_mm) || (dim.value_mm ?? 0) <= 0) return false
  // Presence of a real observed geometric risk is different from lacking
  // independent capture confirmation. Keep the latter in internal diagnostics.
  return dim.risk_signals.every(reason => CAPTURE_METADATA_ONLY.has(reason))
}

export function preflightPurchaseGate(measurement: MeasurementResult | null): PurchaseGate {
  const reasons: PurchaseGateReason[] = []
  if (!measurement) return { allowed: false, stage: 'cv_preflight', reasons: ['measurement_unavailable'],
    required_dimensions: ['D','P','K','DK'], selected_length: null }
  if (measurement.measurement_status !== 'valid' || !measurement.ruler.detected ||
    measurement.scale_px_per_cm === null || measurement.scale_px_per_cm <= 0) {
    reasons.push('scale_unreliable')
  }
  if (!measurement.object.detected || !measurement.object.contour_reliable) reasons.push('object_unreliable')
  const checks = new Map(measurement.confidence_evaluation.checks.map(check => [check.id, check.status]))
  // A failed or unknown observable check is a reason to stop full-spec inference.
  if (OBSERVABLE_REQUIRED_CHECKS.some(id => checks.get(id) !== 'passed')) {
    reasons.push('geometry_quality_unreliable')
  }
  for (const key of ['D','P'] as const) {
    if (!usableDimension(measurement, key)) reasons.push(key === 'D' ? 'missing_D' : 'missing_P')
  }
  if (!usableDimension(measurement, 'K') || !usableDimension(measurement, 'DK')) reasons.push('missing_head_geometry')
  if (!usableDimension(measurement, 'L_underhead') && !usableDimension(measurement, 'L_overall')) {
    reasons.push('missing_length_candidate')
  }
  return { allowed: reasons.length === 0, stage: 'cv_preflight', reasons,
    required_dimensions: ['D','P','K','DK'], selected_length: null }
}

export function finalPurchaseGate(measurement: MeasurementResult | null, head: HeadStyle): PurchaseGate {
  const before = preflightPurchaseGate(measurement)
  const reasons = [...before.reasons]
  const selected = selectLengthFromCv(head, measurement)
  if (selected.dimension === null) reasons.push('head_unresolved')
  else if (!usableDimension(measurement, selected.dimension)) reasons.push('selected_length_unmeasured')
  return { allowed: reasons.length === 0, stage: 'final', reasons,
    required_dimensions: [...before.required_dimensions, ...(selected.dimension ? [selected.dimension] : [])],
    selected_length: selected.dimension }
}

export function publicPurchaseGuidance(gate: PurchaseGate, itemName: string): string {
  const name = itemName || '此五金'
  if (gate.allowed) return ''
  if (gate.reasons.includes('measurement_unavailable') || gate.reasons.includes('scale_unreliable')) {
    return `${name}（目前沒有可信尺度，請將螺絲與清楚的尺平放同一平面後重拍，或持實物至五金行確認規格）`
  }
  if (gate.reasons.includes('object_unreliable') || gate.reasons.includes('geometry_quality_unreliable')) {
    return `${name}（照片尚不足以可靠量測，請避免螺絲與尺重疊，清楚拍攝側面並減少透視後重試）`
  }
  if (gate.reasons.includes('head_unresolved') || gate.reasons.includes('selected_length_unmeasured')) {
    return `${name}（頭型或對應長度尚未可靠確認，請補拍完整頭部、螺絲尖端與旁邊的尺）`
  }
  return `${name}（部分必要尺寸尚未可靠量到，請補拍清楚的螺絲側面和同平面的尺，或持實物至五金行確認）`
}
