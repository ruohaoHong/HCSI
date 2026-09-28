import type { CvDimensionEvidence, MeasurementResult } from './measurement'

const METADATA_ONLY_RISKS = new Set([
  'same_plane_unverified',
  'capture_orientation_unverified',
  'object_ruler_alignment_unknown',
])

function trusted(dim: CvDimensionEvidence | undefined): number | null {
  if (!dim || dim.status !== 'measured' || typeof dim.value_mm !== 'number' ||
      !Number.isFinite(dim.value_mm) || dim.value_mm <= 0) return null
  return dim.risk_signals.every(reason => METADATA_ONLY_RISKS.has(reason))
    ? dim.value_mm : null
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y !== 0) [x, y] = [y, x % y]
  return x || 1
}

function nearestDyadic64(inches: number | null): {
  label: string
  decimal_inch: number
  difference_mm: number
  resolution: '1/64 in'
} | null {
  if (inches === null || !Number.isFinite(inches) || inches <= 0) return null
  const numerator64 = Math.round(inches * 64)
  if (numerator64 <= 0) return null
  const divisor = gcd(numerator64, 64)
  const numerator = numerator64 / divisor
  const denominator = 64 / divisor
  const whole = Math.floor(numerator / denominator)
  const remainder = numerator % denominator
  const label = remainder === 0
    ? `${whole} in`
    : whole > 0
      ? `${whole} ${remainder}/${denominator} in`
      : `${remainder}/${denominator} in`
  const decimal = numerator64 / 64
  return {
    label,
    decimal_inch: Number(decimal.toFixed(6)),
    difference_mm: Number((Math.abs(decimal - inches) * 25.4).toFixed(6)),
    resolution: '1/64 in',
  }
}

export interface CvGroundingBasis {
  mode: 'cv_grounded_specification' | 'appearance_only'
  rule: string
  hard_physical_facts: {
    D_mm: number | null
    P_mm: number | null
    K_mm: number | null
    DK_mm: number | null
    head_geometry_class: 'countersunk' | 'protruding' | 'ambiguous' | 'unknown'
    purchase_length_dimension: 'L_underhead' | 'L_overall' | null
    purchase_length_mm: number | null
  }
  unit_conversions: {
    diameter_inch_decimal: number | null
    pitch_tpi_exact: number | null
    purchase_length_inch_decimal: number | null
    purchase_length_dyadic_approx: {
      label: string
      decimal_inch: number
      difference_mm: number
      resolution: '1/64 in'
    } | null
    note: string
  }
  head_support: {
    height_to_width_ratio: number | null
    underside_width_ratio: number | null
    mid_width_ratio: number | null
    top_width_ratio: number | null
    max_width_position: number | null
    width_trend: number | null
    quality: 'reliable' | 'degraded' | 'unusable' | 'unavailable'
  }
  head_shape_math: {
    K_over_DK: number | null
    DK_over_D: number | null
    top_over_underside_width: number | null
    width_drop_underside_to_top: number | null
    lower_half_slope: number | null
    upper_half_slope: number | null
    slope_change: number | null
    normalized_profile: Array<{
      axial_fraction: number
      width_ratio: number
    }>
    note: string
  }
  optional_thread_extent: { B_mm: number; role: 'support_only' } | null
  image_role: string[]
  forbidden_image_inferences: string[]
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || !Number.isFinite(numerator) ||
      !Number.isFinite(denominator) || Math.abs(denominator) < 1e-9) return null
  return Number((numerator / denominator).toFixed(6))
}

function nearestProfileWidth(
  points: Array<{ axial_fraction: number; width_ratio: number }>,
  target: number,
): number | null {
  if (points.length === 0) return null
  const ordered = [...points].sort(
    (a, b) => Math.abs(a.axial_fraction - target) - Math.abs(b.axial_fraction - target)
  )
  return Number.isFinite(ordered[0].width_ratio) ? ordered[0].width_ratio : null
}

export function buildCvGroundingBasis(
  measurement: MeasurementResult | null,
  allowPreciseSpec: boolean,
): CvGroundingBasis {
  const dims = measurement?.dimensions
  const head = measurement?.head_geometry
  const headReliable = head?.status === 'measured' && head.quality === 'reliable'
  const geometryClass = headReliable ? head.length_convention_evidence : 'unknown'
  const lengthDimension =
    geometryClass === 'countersunk' ? 'L_overall'
      : geometryClass === 'protruding' ? 'L_underhead'
        : null
  const D = trusted(dims?.D)
  const P = trusted(dims?.P)
  const K = trusted(dims?.K)
  const DK = trusted(dims?.DK)
  const L = lengthDimension ? trusted(dims?.[lengthDimension]) : null
  const ready = allowPreciseSpec && D !== null && P !== null &&
    K !== null && DK !== null && L !== null && headReliable

  const normalizedProfile = head?.status === 'measured'
    ? head.profile_points
        .filter(point => Number.isFinite(point.axial_fraction) && Number.isFinite(point.width_ratio))
        .map(point => ({
          axial_fraction: Number(point.axial_fraction.toFixed(6)),
          width_ratio: Number(point.width_ratio.toFixed(6)),
        }))
    : []
  const lowerWidth = nearestProfileWidth(normalizedProfile, 0.08)
  const middleWidth = nearestProfileWidth(normalizedProfile, 0.50)
  const upperWidth = nearestProfileWidth(normalizedProfile, 0.92)
  const lowerHalfSlope = lowerWidth !== null && middleWidth !== null
    ? Number(((middleWidth - lowerWidth) / 0.42).toFixed(6))
    : null
  const upperHalfSlope = middleWidth !== null && upperWidth !== null
    ? Number(((upperWidth - middleWidth) / 0.42).toFixed(6))
    : null
  const topOverUnderside = ratio(
    head?.status === 'measured' ? head.top_width_ratio : null,
    head?.status === 'measured' ? head.bearing_width_ratio : null,
  )

  const B = dims?.B
  const bRisks = B?.risk_signals.filter(reason =>
    !METADATA_ONLY_RISKS.has(reason) &&
    reason !== 'thread_boundary_resolution_limited_by_visible_pitch'
  ) ?? []
  const optionalB = allowPreciseSpec && B?.status === 'measured' &&
    typeof B.value_mm === 'number' && Number.isFinite(B.value_mm) &&
    B.value_mm > 0 && bRisks.length === 0
      ? { B_mm: B.value_mm, role: 'support_only' as const }
      : null

  return {
    mode: ready ? 'cv_grounded_specification' : 'appearance_only',
    rule: ready
      ? 'Trusted CV measurements are the physical premise. The image may add semantic labels but must not resize or override them.'
      : 'Core CV evidence is incomplete. Use the image for appearance only; do not output a precise nominal purchase specification.',
    hard_physical_facts: {
      D_mm: D,
      P_mm: P,
      K_mm: K,
      DK_mm: DK,
      head_geometry_class: geometryClass,
      purchase_length_dimension: lengthDimension,
      purchase_length_mm: L,
    },
    unit_conversions: {
      diameter_inch_decimal: D === null ? null : Number((D / 25.4).toFixed(6)),
      pitch_tpi_exact: P === null ? null : Number((25.4 / P).toFixed(6)),
      purchase_length_inch_decimal: L === null ? null : Number((L / 25.4).toFixed(6)),
      purchase_length_dyadic_approx: nearestDyadic64(L === null ? null : L / 25.4),
      note: 'Pure unit conversions and a nearest 1/64-inch dyadic representation only. This is arithmetic formatting, not a nominal screw-size table or proof that a standard size exists.',
    },
    head_support: {
      height_to_width_ratio: head?.status === 'measured' ? head.height_to_width : null,
      underside_width_ratio: head?.status === 'measured' ? head.bearing_width_ratio : null,
      mid_width_ratio: head?.status === 'measured' ? head.mid_width_ratio : null,
      top_width_ratio: head?.status === 'measured' ? head.top_width_ratio : null,
      max_width_position: head?.status === 'measured' ? head.max_width_position : null,
      width_trend: head?.status === 'measured' ? head.width_trend : null,
      quality: head?.status === 'measured' ? head.quality : 'unavailable',
    },
    head_shape_math: {
      K_over_DK: ratio(K, DK),
      DK_over_D: ratio(DK, D),
      top_over_underside_width: topOverUnderside,
      width_drop_underside_to_top: topOverUnderside === null
        ? null
        : Number((1 - topOverUnderside).toFixed(6)),
      lower_half_slope: lowerHalfSlope,
      upper_half_slope: upperHalfSlope,
      slope_change: lowerHalfSlope === null || upperHalfSlope === null
        ? null
        : Number((upperHalfSlope - lowerHalfSlope).toFixed(6)),
      normalized_profile: normalizedProfile,
      note: 'Dimensionless arithmetic derived only from measured head geometry. These values describe silhouette shape; they are not a head-style lookup table and do not themselves name pan/button/socket/etc.',
    },
    optional_thread_extent: optionalB,
    image_role: [
      'Resolve the specific head subtype only within the CV-compatible head geometry class.',
      'Observe full-thread/partial-thread appearance; B is optional support only.',
      'Identify drive form only when the drive face is actually visible.',
      'Identify non-dimensional appearance and material features.',
    ],
    forbidden_image_inferences: [
      'Do not estimate D, P, L, K or DK from apparent pixel size.',
      'Do not prefer a common nominal size when it fits trusted CV facts worse.',
      'Do not infer drive size from head type, K/DK, or an unverified standard table.',
    ],
  }
}
