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
  let x = Math.abs(Math.round(a)), y = Math.abs(Math.round(b))
  while (y) [x, y] = [y, x % y]
  return x || 1
}

function fractionLabel(numerator: number, denominator: number): string {
  const whole = Math.floor(numerator / denominator)
  const rem = numerator % denominator
  if (rem === 0) return String(whole)
  const d = gcd(rem, denominator)
  const frac = `${rem / d}/${denominator / d}`
  return whole > 0 ? `${whole} ${frac}` : frac
}

function imperialLengthCandidates(mm: number | null) {
  if (mm === null) return []
  const inch = mm / 25.4
  const seen = new Set<string>()
  return [64, 32, 16, 8].flatMap(denominator => {
    const numerator = Math.round(inch * denominator)
    if (numerator <= 0) return []
    const label = fractionLabel(numerator, denominator)
    if (seen.has(label)) return []
    seen.add(label)
    const candidateMm = numerator / denominator * 25.4
    return [{
      fraction_inch: label,
      candidate_mm: Number(candidateMm.toFixed(5)),
      absolute_difference_mm: Number(Math.abs(mm - candidateMm).toFixed(5)),
    }]
  }).sort((a, b) => a.absolute_difference_mm - b.absolute_difference_mm)
}

function nearestNumberedScrew(D: number | null) {
  if (D === null) return null
  let best: { designation: string; nominal_D_mm: number; absolute_difference_mm: number } | null = null
  for (let gauge = 0; gauge <= 14; gauge++) {
    const mm = (0.060 + 0.013 * gauge) * 25.4
    const diff = Math.abs(D - mm)
    if (!best || diff < best.absolute_difference_mm) {
      best = {
        designation: `#${gauge}`,
        nominal_D_mm: Number(mm.toFixed(5)),
        absolute_difference_mm: Number(diff.toFixed(5)),
      }
    }
  }
  return best
}

export interface CvGroundingBasis {
  mode: 'cv_grounded_specification' | 'appearance_only'
  rule: string
  hard_physical_facts: {
    D_mm: number | null
    P_mm: number | null
    derived_tpi: number | null
    K_mm: number | null
    DK_mm: number | null
    head_geometry_class: 'countersunk' | 'protruding' | 'ambiguous' | 'unknown'
    purchase_length_dimension: 'L_underhead' | 'L_overall' | null
    purchase_length_mm: number | null
  }
  arithmetic_nominal_hints: {
    note: string
    diameter_inch: number | null
    nearest_numbered_screw: {
      designation: string
      nominal_D_mm: number
      absolute_difference_mm: number
    } | null
    pitch_tpi_exact: number | null
    nearest_integer_tpi: number | null
    length_inch_exact: number | null
    imperial_fraction_candidates: Array<{
      fraction_inch: string
      candidate_mm: number
      absolute_difference_mm: number
    }>
  }
  head_support: {
    height_to_width_ratio: number | null
    underside_width_ratio: number | null
    top_width_ratio: number | null
    quality: 'reliable' | 'degraded' | 'unusable' | 'unavailable'
  }
  optional_thread_extent: { B_mm: number; role: 'support_only' } | null
  image_role: string[]
  forbidden_image_inferences: string[]
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
      derived_tpi: P === null ? null : Number((25.4 / P).toFixed(3)),
      K_mm: K,
      DK_mm: DK,
      head_geometry_class: geometryClass,
      purchase_length_dimension: lengthDimension,
      purchase_length_mm: L,
    },
    arithmetic_nominal_hints: {
      note: 'Pure arithmetic proximity hints only; they do not certify that a catalogue/standard offers the candidate.',
      diameter_inch: D === null ? null : Number((D / 25.4).toFixed(5)),
      nearest_numbered_screw: nearestNumberedScrew(D),
      pitch_tpi_exact: P === null ? null : Number((25.4 / P).toFixed(5)),
      nearest_integer_tpi: P === null ? null : Math.round(25.4 / P),
      length_inch_exact: L === null ? null : Number((L / 25.4).toFixed(5)),
      imperial_fraction_candidates: imperialLengthCandidates(L),
    },
    head_support: {
      height_to_width_ratio: head?.status === 'measured' ? head.height_to_width : null,
      underside_width_ratio: head?.status === 'measured' ? head.bearing_width_ratio : null,
      top_width_ratio: head?.status === 'measured' ? head.top_width_ratio : null,
      quality: head?.status === 'measured' ? head.quality : 'unavailable',
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
      'Do not prefer a common nominal size when it fits the trusted CV facts worse.',
      'Do not infer drive size from head type, K/DK, or an unverified standard table.',
    ],
  }
}
