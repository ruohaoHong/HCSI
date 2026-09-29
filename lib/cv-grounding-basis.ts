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
  mode: 'cv_grounded_specification' | 'dimension_grounded_semantic_pending' | 'appearance_only'
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
  evidence_partition: {
    bearing_plane: {
      status: 'supported' | 'unsupported'
      source: 'bearing_plane' | 'coarse_transition' | 'unavailable'
      length_dimension: 'L_underhead' | null
      length_mm: number | null
    }
    envelope_dimensions: {
      status: 'supported' | 'partial' | 'unavailable'
      K_mm: number | null
      DK_mm: number | null
    }
    silhouette_integrity: {
      status: 'reliable' | 'degraded' | 'unusable' | 'unavailable'
      reason_codes: string[]
      can_constrain_head_subtype: boolean
    }
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
    imperial_numbered_thread_math: {
      numbered_size_index_exact: number
      nearest_integer_size: number
      reconstructed_diameter_inch: number
      diameter_difference_mm: number
      nearest_integer_tpi: number
      reconstructed_pitch_mm: number
      pitch_difference_mm: number
      diameter_cv_uncertainty_mm: number | null
      diameter_residual_over_cv_uncertainty: number | null
      eligible_as_numbered_size_evidence: boolean
      formula: 'diameter_inch = 0.060 + 0.013 * size_number'
      note: string
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
  head_shape_signature: {
    geometry_class: 'countersunk' | 'protruding' | 'ambiguous' | 'unknown'
    axial_aspect_K_over_DK: number | null
    radial_envelope_DK_over_D: number | null
    global_width_cv: number | null
    middle_width_cv: number | null
    middle_linear_slope: number | null
    upper_linear_slope: number | null
    curvature_change_median: number | null
    upper_narrowing_share: number | null
    centerline_drift_ratio: number | null
    profile_roughness: number | null
    silhouette_integrity: 'reliable' | 'degraded' | 'unusable' | 'unavailable'
    note: string
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

export interface CvDimensionCandidate {
  status: 'candidate' | 'unavailable'
  specification: string | null
  source: 'imperial_numbered_arithmetic' | null
  evidence_level: 'estimated' | 'unconfirmed'
  excludes: Array<'head_style' | 'drive_form' | 'drive_size' | 'thread_series'>
  reason_codes: string[]
  note: string
}

/**
 * Preserve independently supported dimension notation without promoting it to
 * a complete purchase specification.  This is deliberately limited to the
 * already-established reversible numbered-thread arithmetic; it does not add
 * a catalogue lookup, thread-series label, head style, or drive claim.
 */
export function buildCvDimensionCandidate(basis: CvGroundingBasis): CvDimensionCandidate {
  const numbered = basis.unit_conversions.imperial_numbered_thread_math
  const length = basis.unit_conversions.purchase_length_dyadic_approx
  if (basis.mode === 'appearance_only' ||
      !numbered?.eligible_as_numbered_size_evidence || !length) {
    return {
      status: 'unavailable',
      specification: null,
      source: null,
      evidence_level: 'unconfirmed',
      excludes: ['head_style', 'drive_form', 'drive_size', 'thread_series'],
      reason_codes: ['cv_dimension_candidate_not_supported'],
      note: 'No independent dimension-only nominal candidate is exposed.',
    }
  }
  return {
    status: 'candidate',
    specification: `#${numbered.nearest_integer_size}-${numbered.nearest_integer_tpi} × ${length.label}`,
    source: 'imperial_numbered_arithmetic',
    evidence_level: 'estimated',
    excludes: ['head_style', 'drive_form', 'drive_size', 'thread_series'],
    reason_codes: [
      'numbered_diameter_residual_within_cv_uncertainty',
      'nearest_integer_tpi_from_measured_pitch',
      'length_quantized_to_nearest_1_64_inch',
    ],
    note: 'Dimension-only CV arithmetic candidate; not a complete purchase specification and not proof of catalogue availability.',
  }
}

function numberedImperialThreadMath(
  diameterMm: number | null,
  pitchMm: number | null,
  diameterCvUncertaintyMm: number | null,
): CvGroundingBasis['unit_conversions']['imperial_numbered_thread_math'] {
  if (diameterMm === null || pitchMm === null) return null
  const diameterInch = diameterMm / 25.4
  const numberedSizeIndex = (diameterInch - 0.060) / 0.013
  const nearestSize = Math.round(numberedSizeIndex)
  const tpiExact = 25.4 / pitchMm
  const nearestTpi = Math.round(tpiExact)
  if (!Number.isFinite(numberedSizeIndex) || !Number.isFinite(tpiExact) ||
      nearestSize < 0 || nearestTpi <= 0) return null

  const reconstructedDiameterInch = 0.060 + 0.013 * nearestSize
  const reconstructedPitchMm = 25.4 / nearestTpi
  const diameterDifferenceMm = Math.abs(diameterInch - reconstructedDiameterInch) * 25.4
  const residualOverUncertainty = diameterCvUncertaintyMm !== null &&
    Number.isFinite(diameterCvUncertaintyMm) && diameterCvUncertaintyMm > 0
      ? diameterDifferenceMm / diameterCvUncertaintyMm
      : null
  return {
    numbered_size_index_exact: Number(numberedSizeIndex.toFixed(6)),
    nearest_integer_size: nearestSize,
    reconstructed_diameter_inch: Number(reconstructedDiameterInch.toFixed(6)),
    diameter_difference_mm: Number(diameterDifferenceMm.toFixed(6)),
    nearest_integer_tpi: nearestTpi,
    reconstructed_pitch_mm: Number(reconstructedPitchMm.toFixed(6)),
    pitch_difference_mm: Number(Math.abs(pitchMm - reconstructedPitchMm).toFixed(6)),
    diameter_cv_uncertainty_mm: diameterCvUncertaintyMm === null
      ? null
      : Number(diameterCvUncertaintyMm.toFixed(6)),
    diameter_residual_over_cv_uncertainty: residualOverUncertainty === null
      ? null
      : Number(residualOverUncertainty.toFixed(6)),
    eligible_as_numbered_size_evidence: residualOverUncertainty !== null &&
      residualOverUncertainty <= 1,
    formula: 'diameter_inch = 0.060 + 0.013 * size_number',
    note: 'Pure arithmetic inversion of the Unified numbered-screw diameter relation plus nearest-integer TPI. Numbered-size evidence is eligible only when its reconstructed diameter residual stays inside the CV diameter uncertainty. This is not a UNC/UNF lookup table and does not prove catalogue availability.',
  }
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

function mean(values: number[]): number | null {
  if (values.length === 0 || values.some(value => !Number.isFinite(value))) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function coefficientOfVariation(values: number[]): number | null {
  const average = mean(values)
  if (average === null || Math.abs(average) < 1e-9) return null
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length
  return Number((Math.sqrt(variance) / Math.abs(average)).toFixed(6))
}

function linearSlope(
  points: Array<{ axial_fraction: number; width_ratio: number }>,
): number | null {
  if (points.length < 2) return null
  const xMean = mean(points.map(point => point.axial_fraction))
  const yMean = mean(points.map(point => point.width_ratio))
  if (xMean === null || yMean === null) return null
  let numerator = 0
  let denominator = 0
  for (const point of points) {
    numerator += (point.axial_fraction - xMean) * (point.width_ratio - yMean)
    denominator += (point.axial_fraction - xMean) ** 2
  }
  if (denominator < 1e-12) return null
  return Number((numerator / denominator).toFixed(6))
}

function curvatureChangeMedian(
  points: Array<{ axial_fraction: number; width_ratio: number }>,
): number | null {
  if (points.length < 3) return null
  const slopes: number[] = []
  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index].axial_fraction - points[index - 1].axial_fraction
    if (!Number.isFinite(dx) || Math.abs(dx) < 1e-9) return null
    slopes.push((points[index].width_ratio - points[index - 1].width_ratio) / dx)
  }
  const changes = slopes.slice(1).map((slope, index) => Math.abs(slope - slopes[index]))
  if (changes.length === 0) return null
  const sorted = [...changes].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
  return Number(median.toFixed(6))
}

function upperNarrowingShare(
  points: Array<{ axial_fraction: number; width_ratio: number }>,
): number | null {
  if (points.length < 3) return null
  const maxWidth = Math.max(...points.map(point => point.width_ratio))
  const topWidth = nearestProfileWidth(points, 0.92)
  const upperStartWidth = nearestProfileWidth(points, 0.71)
  if (topWidth === null || upperStartWidth === null) return null
  const totalNarrowing = maxWidth - topWidth
  if (totalNarrowing <= 1e-6) return 0
  const upperNarrowing = Math.max(0, upperStartWidth - topWidth)
  return Number(Math.min(1, upperNarrowing / totalNarrowing).toFixed(6))
}

export function buildCvGroundingBasis(
  measurement: MeasurementResult | null,
  allowPreciseSpec: boolean,
): CvGroundingBasis {
  const dims = measurement?.dimensions
  const head = measurement?.head_geometry
  const D = trusted(dims?.D)
  const P = trusted(dims?.P)
  const K = trusted(dims?.K)
  const DK = trusted(dims?.DK)
  const underHeadLength = trusted(dims?.L_underhead)
  const overallLength = trusted(dims?.L_overall)

  // Keep three physically different questions separate:
  // 1) is there a defensible bearing plane for under-head length,
  // 2) are K/DK envelope dimensions measured,
  // 3) is the full side silhouette trustworthy enough to constrain a head subtype.
  // A failure in (3) must not erase evidence already established by (1) or (2).
  const headMeasured = head?.status === 'measured'
  const silhouetteReliable = headMeasured && head.quality === 'reliable'
  const bearingPlaneSupported =
    headMeasured && head.boundary_source === 'bearing_plane' && underHeadLength !== null
  const envelopeStatus =
    K !== null && DK !== null ? 'supported'
      : K !== null || DK !== null ? 'partial'
        : 'unavailable'

  const geometryClass: CvGroundingBasis['hard_physical_facts']['head_geometry_class'] =
    bearingPlaneSupported
      ? 'protruding'
      : silhouetteReliable
        ? head.length_convention_evidence
        : 'unknown'
  const lengthDimension: 'L_underhead' | 'L_overall' | null =
    bearingPlaneSupported
      ? 'L_underhead'
      : silhouetteReliable && geometryClass === 'countersunk'
        ? 'L_overall'
        : silhouetteReliable && geometryClass === 'protruding'
          ? 'L_underhead'
          : null
  const L = lengthDimension === 'L_underhead'
    ? underHeadLength
    : lengthDimension === 'L_overall'
      ? overallLength
      : null

  const dUncertaintyRaw = dims?.D?.diagnostics?.edge_diameter_uncertainty_mm
  const dUncertainty = typeof dUncertaintyRaw === 'number' &&
    Number.isFinite(dUncertaintyRaw) && dUncertaintyRaw > 0
      ? dUncertaintyRaw
      : null

  // allowPreciseSpec is the non-silhouette physical preflight.  After the
  // purchase-policy split, a false value means scale/object/capture/core
  // dimensions are not trustworthy and must still fail closed.
  const dimensionGrounded =
    allowPreciseSpec &&
    D !== null && P !== null && K !== null && DK !== null && L !== null &&
    (bearingPlaneSupported || silhouetteReliable)
  const ready = dimensionGrounded && silhouetteReliable
  const mode: CvGroundingBasis['mode'] = ready
    ? 'cv_grounded_specification'
    : dimensionGrounded
      ? 'dimension_grounded_semantic_pending'
      : 'appearance_only'

  const normalizedProfile = silhouetteReliable
    ? (head?.profile_points ?? [])
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
  const topOverUnderside = silhouetteReliable
    ? ratio(head?.top_width_ratio ?? null, head?.bearing_width_ratio ?? null)
    : null
  const middleProfile = normalizedProfile.filter(
    point => point.axial_fraction >= 0.29 && point.axial_fraction <= 0.71,
  )
  const upperProfile = normalizedProfile.filter(point => point.axial_fraction >= 0.605)
  const signatureGlobalCv = coefficientOfVariation(
    normalizedProfile.map(point => point.width_ratio),
  )
  const signatureMiddleCv = coefficientOfVariation(
    middleProfile.map(point => point.width_ratio),
  )
  const signatureMiddleSlope = linearSlope(middleProfile)
  const signatureUpperSlope = linearSlope(upperProfile)
  const signatureCurvature = curvatureChangeMedian(normalizedProfile)
  const signatureUpperNarrowingShare = upperNarrowingShare(normalizedProfile)

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

  const silhouetteStatus: CvGroundingBasis['evidence_partition']['silhouette_integrity']['status'] =
    headMeasured ? head.quality : 'unavailable'

  return {
    mode,
    rule: ready
      ? 'Trusted CV measurements are the physical premise. The image may add semantic labels but must not resize or override them.'
      : dimensionGrounded
        ? 'D/P/L/K/DK remain grounded physical evidence. Head silhouette integrity is insufficient for subtype verification, so the original image must resolve head semantics without overriding measured dimensions.'
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
    evidence_partition: {
      bearing_plane: {
        status: bearingPlaneSupported ? 'supported' : 'unsupported',
        source: headMeasured ? head.boundary_source : 'unavailable',
        length_dimension: bearingPlaneSupported ? 'L_underhead' : null,
        length_mm: bearingPlaneSupported ? underHeadLength : null,
      },
      envelope_dimensions: {
        status: envelopeStatus,
        K_mm: K,
        DK_mm: DK,
      },
      silhouette_integrity: {
        status: silhouetteStatus,
        reason_codes: headMeasured ? [...(head.reason_codes ?? [])] : [],
        can_constrain_head_subtype: silhouetteReliable,
      },
    },
    unit_conversions: {
      diameter_inch_decimal: D === null ? null : Number((D / 25.4).toFixed(6)),
      pitch_tpi_exact: P === null ? null : Number((25.4 / P).toFixed(6)),
      purchase_length_inch_decimal: L === null ? null : Number((L / 25.4).toFixed(6)),
      purchase_length_dyadic_approx: nearestDyadic64(L === null ? null : L / 25.4),
      imperial_numbered_thread_math: numberedImperialThreadMath(D, P, dUncertainty),
      note: 'Pure unit conversions, numbered-thread arithmetic inversion, and nearest 1/64-inch length quantization only. These are mathematical transforms of CV measurements, not a nominal-size lookup table or proof that a stocked standard exists.',
    },
    head_support: {
      height_to_width_ratio: headMeasured ? head.height_to_width : null,
      underside_width_ratio: headMeasured ? head.bearing_width_ratio : null,
      mid_width_ratio: headMeasured ? head.mid_width_ratio : null,
      top_width_ratio: headMeasured ? head.top_width_ratio : null,
      max_width_position: headMeasured ? head.max_width_position : null,
      width_trend: headMeasured ? head.width_trend : null,
      quality: headMeasured ? head.quality : 'unavailable',
    },
    head_shape_signature: {
      geometry_class: geometryClass,
      axial_aspect_K_over_DK: ratio(K, DK),
      radial_envelope_DK_over_D: ratio(DK, D),
      global_width_cv: silhouetteReliable ? signatureGlobalCv : null,
      middle_width_cv: silhouetteReliable ? signatureMiddleCv : null,
      middle_linear_slope: silhouetteReliable ? signatureMiddleSlope : null,
      upper_linear_slope: silhouetteReliable ? signatureUpperSlope : null,
      curvature_change_median: silhouetteReliable ? signatureCurvature : null,
      upper_narrowing_share: silhouetteReliable ? signatureUpperNarrowingShare : null,
      centerline_drift_ratio: silhouetteReliable
        ? (head?.centerline_drift_ratio ?? null)
        : null,
      profile_roughness: silhouetteReliable
        ? (head?.profile_roughness ?? null)
        : null,
      silhouette_integrity: silhouetteStatus,
      note: 'Dimensionless measured shape signature only. It contains no head-style names, catalogue mappings, or numeric thresholds that imply a semantic label.',
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
      note: silhouetteReliable
        ? 'Dimensionless arithmetic derived from measured head geometry. These values describe silhouette shape; they are not a head-style lookup table and do not themselves name pan/button/socket/etc.'
        : 'K/DK and DK/D remain measured envelope ratios. Detailed silhouette-derived ratios/profile are withheld because silhouette integrity is not reliable; no head subtype should be manufactured from the degraded profile.',
    },
    optional_thread_extent: optionalB,
    image_role: [
      'Resolve the specific head subtype only within the physically supported geometry class.',
      silhouetteReliable
        ? 'Use the reliable normalized side silhouette as a physical constraint on head subtype.'
        : 'Detailed side-silhouette integrity is not reliable; use the original image for head subtype semantics and do not reconstruct a subtype from the degraded profile.',
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
