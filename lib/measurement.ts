export type MeasurementStatus = 'valid' | 'no_reference' | 'unreliable'
export type AnalysisMode = 'measurement_assisted' | 'appearance_only'
export type GeometryStepMeasurementStatus = 'measured' | 'not_measured'
export type RulerScaleSystem = 'metric' | 'imperial' | 'dual' | 'unknown'
export type RulerScaleSource = 'rulernet_cm' | 'imperial_ticks' | 'rulernet_cm+imperial_ticks' | 'visual_dual' | 'none'

export interface MeasurementRulerDiagnostics {
  detected: boolean
  mark_count: number
  scale_system: RulerScaleSystem
  scale_source: RulerScaleSource
  scale_confidence: number
  px_per_cm: number | null
  px_per_inch: number | null
  reference_interval_cm: number | null
  median_px_per_cm: number | null
  local_px_per_cm: number | null
  perspective_ratio: number | null
  perspective_step_pct: number | null
  perspective_ok: boolean
}

export interface MeasurementObjectDiagnostics {
  detected: boolean
  contour_reliable: boolean
  contour_area_px: number | null
  contour_area_ratio: number | null
  solidity: number | null
  principal_length_px: number | null
  principal_width_px: number | null
  min_area_length_px: number | null
  min_area_width_px: number | null
  principal_angle_deg: number | null
  ruler_alignment_deg: number | null
  segmentation_method: string
  risk_signals: string[]
}

export interface GeometryStepLandmark {
  x_px: number
  y_px: number
}

export interface GeometryStepMeasurement {
  operation: string
  inputs: string[]
  purpose: string
  status: GeometryStepMeasurementStatus
  value_px: number | null
  value_mm: number | null
  landmarks: Record<string, GeometryStepLandmark>
  reason_codes: string[]
}

export interface MeasurementResult {
  schema_version: 'hcsi.measurement.v1'
  image_sha256: string
  measurement_status: MeasurementStatus
  analysis_mode: AnalysisMode
  measurement_valid: boolean
  retry_recommended: boolean
  length_mm: number | null
  width_mm: number | null
  scale_system: RulerScaleSystem
  scale_px_per_cm: number | null
  scale_px_per_inch: number | null
  geometry_steps: GeometryStepMeasurement[]
  image: { width_px: number; height_px: number }
  ruler: MeasurementRulerDiagnostics
  object: MeasurementObjectDiagnostics
  reason_codes: string[]
  capture_assumptions: {
    same_plane_required: boolean
    same_plane_verified: boolean
    near_overhead_required: boolean
    ruler_parallel_required: boolean
    ruler_parallel_preferred: boolean
  }
}

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isGeometryStepMeasurement(value: unknown): value is GeometryStepMeasurement {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.operation !== 'string' || typeof candidate.purpose !== 'string') return false
  if (!Array.isArray(candidate.inputs) || !candidate.inputs.every((item) => typeof item === 'string')) return false
  if (!['measured', 'not_measured'].includes(String(candidate.status))) return false
  if (!isFiniteNumberOrNull(candidate.value_px) || !isFiniteNumberOrNull(candidate.value_mm)) return false
  if (!Array.isArray(candidate.reason_codes) || !candidate.reason_codes.every((item) => typeof item === 'string')) return false
  if (!candidate.landmarks || typeof candidate.landmarks !== 'object' || Array.isArray(candidate.landmarks)) return false

  for (const landmark of Object.values(candidate.landmarks as Record<string, unknown>)) {
    if (!landmark || typeof landmark !== 'object') return false
    const point = landmark as Record<string, unknown>
    if (typeof point.x_px !== 'number' || !Number.isFinite(point.x_px)) return false
    if (typeof point.y_px !== 'number' || !Number.isFinite(point.y_px)) return false
  }

  if (candidate.status === 'measured') {
    if (candidate.value_px === null || candidate.value_mm === null || candidate.reason_codes.length > 0) return false
  } else if (candidate.value_px !== null || candidate.value_mm !== null) {
    return false
  }
  return true
}

function isRulerDiagnostics(value: unknown): value is MeasurementRulerDiagnostics {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.detected !== 'boolean' || typeof candidate.mark_count !== 'number') return false
  if (!['metric', 'imperial', 'dual', 'unknown'].includes(String(candidate.scale_system))) return false
  if (!['rulernet_cm', 'imperial_ticks', 'rulernet_cm+imperial_ticks', 'visual_dual', 'none'].includes(String(candidate.scale_source))) return false
  if (typeof candidate.scale_confidence !== 'number' || !Number.isFinite(candidate.scale_confidence)) return false
  for (const key of ['px_per_cm', 'px_per_inch', 'reference_interval_cm', 'median_px_per_cm', 'local_px_per_cm', 'perspective_ratio', 'perspective_step_pct']) {
    if (!isFiniteNumberOrNull(candidate[key])) return false
  }
  if (typeof candidate.perspective_ok !== 'boolean') return false
  return true
}

export function isMeasurementResult(value: unknown): value is MeasurementResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (candidate.schema_version !== 'hcsi.measurement.v1') return false
  if (typeof candidate.image_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.image_sha256)) return false
  if (!['valid', 'no_reference', 'unreliable'].includes(String(candidate.measurement_status))) return false
  if (!['measurement_assisted', 'appearance_only'].includes(String(candidate.analysis_mode))) return false
  if (!['metric', 'imperial', 'dual', 'unknown'].includes(String(candidate.scale_system))) return false
  if (typeof candidate.measurement_valid !== 'boolean' || typeof candidate.retry_recommended !== 'boolean') return false
  if (!isFiniteNumberOrNull(candidate.length_mm) || !isFiniteNumberOrNull(candidate.width_mm)) return false
  if (!isFiniteNumberOrNull(candidate.scale_px_per_cm) || !isFiniteNumberOrNull(candidate.scale_px_per_inch)) return false
  if (!Array.isArray(candidate.geometry_steps) || !candidate.geometry_steps.every(isGeometryStepMeasurement)) return false
  if (!Array.isArray(candidate.reason_codes) || !candidate.reason_codes.every((item) => typeof item === 'string')) return false
  const ruler = candidate.ruler
  const object = candidate.object
  const image = candidate.image
  const assumptions = candidate.capture_assumptions
  if (!isRulerDiagnostics(ruler) || !object || typeof object !== 'object') return false
  if (!image || typeof image !== 'object' || !assumptions || typeof assumptions !== 'object') return false

  const status = candidate.measurement_status as MeasurementStatus
  const expectedValid = status === 'valid'
  if (candidate.measurement_valid !== expectedValid) return false
  if ((candidate.analysis_mode === 'measurement_assisted') !== expectedValid) return false
  if (expectedValid) {
    if (candidate.scale_system === 'unknown') return false
    if (candidate.length_mm === null || candidate.width_mm === null || candidate.scale_px_per_cm === null || candidate.scale_px_per_inch === null) return false
  } else if (candidate.length_mm !== null || candidate.width_mm !== null || candidate.scale_px_per_cm !== null || candidate.scale_px_per_inch !== null) {
    return false
  }
  return true
}
