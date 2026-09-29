import assert from 'node:assert/strict'
import type { MeasurementResult } from './measurement'
import { buildCvDimensionCandidate, buildCvGroundingBasis } from './cv-grounding-basis'

const dim = (mm: number, diagnostics: Record<string, number> = {}) => ({
  status: 'measured' as const, value_px: mm * 10, value_mm: mm,
  confidence: 'verified' as const, risk_signals: [], reason_codes: [], diagnostics,
})
const measurement = {
  dimensions: {
    D: dim(4.17, { edge_diameter_uncertainty_mm: 0.02 }),
    P: dim(0.8), L_underhead: dim(10.27), L_overall: dim(13.08),
    B: { ...dim(8), confidence: 'measured_with_risk' as const,
      risk_signals: ['thread_boundary_resolution_limited_by_visible_pitch'] },
    K: dim(2.84), DK: dim(8.287),
  },
  head_geometry: {
    status: 'measured', quality: 'reliable', length_convention_evidence: 'protruding',
    height_to_width: 0.343, bearing_width_ratio: 0.972, mid_width_ratio: 0.83,
    top_width_ratio: 0.555, max_width_position: 0.16, width_trend: -0.41,
    profile_points: [
      { axial_fraction: 0.08, width_ratio: 0.98, center_offset_ratio: 0 },
      { axial_fraction: 0.185, width_ratio: 0.95, center_offset_ratio: 0 },
      { axial_fraction: 0.29, width_ratio: 0.91, center_offset_ratio: 0 },
      { axial_fraction: 0.395, width_ratio: 0.87, center_offset_ratio: 0 },
      { axial_fraction: 0.5, width_ratio: 0.82, center_offset_ratio: 0 },
      { axial_fraction: 0.605, width_ratio: 0.76, center_offset_ratio: 0 },
      { axial_fraction: 0.71, width_ratio: 0.69, center_offset_ratio: 0 },
      { axial_fraction: 0.815, width_ratio: 0.62, center_offset_ratio: 0 },
      { axial_fraction: 0.92, width_ratio: 0.56, center_offset_ratio: 0 },
    ],
  },
} as unknown as MeasurementResult

const protruding = buildCvGroundingBasis(measurement, true)
assert.equal(protruding.mode, 'cv_grounded_specification')
assert.equal(protruding.hard_physical_facts.purchase_length_dimension, 'L_underhead')
assert.equal(protruding.hard_physical_facts.purchase_length_mm, 10.27)
assert.equal(protruding.unit_conversions.pitch_tpi_exact, 31.75)
assert.equal(protruding.unit_conversions.purchase_length_inch_decimal, 0.404331)
assert.equal(protruding.unit_conversions.purchase_length_dyadic_approx?.label, '13/32 in')
assert.equal(protruding.unit_conversions.purchase_length_dyadic_approx?.difference_mm, 0.04875)
assert.equal(protruding.unit_conversions.imperial_numbered_thread_math?.numbered_size_index_exact, 8.013325)
assert.equal(protruding.unit_conversions.imperial_numbered_thread_math?.nearest_integer_size, 8)
assert.equal(protruding.unit_conversions.imperial_numbered_thread_math?.reconstructed_diameter_inch, 0.164)
assert.equal(protruding.unit_conversions.imperial_numbered_thread_math?.diameter_difference_mm, 0.0044)
assert.equal(protruding.unit_conversions.imperial_numbered_thread_math?.nearest_integer_tpi, 32)
assert.equal(protruding.unit_conversions.imperial_numbered_thread_math?.reconstructed_pitch_mm, 0.79375)
assert.equal(protruding.unit_conversions.imperial_numbered_thread_math?.pitch_difference_mm, 0.00625)
assert.equal(protruding.unit_conversions.imperial_numbered_thread_math?.diameter_cv_uncertainty_mm, 0.02)
assert.equal(protruding.unit_conversions.imperial_numbered_thread_math?.diameter_residual_over_cv_uncertainty, 0.22)
assert.equal(protruding.unit_conversions.imperial_numbered_thread_math?.eligible_as_numbered_size_evidence, true)
assert.match(protruding.unit_conversions.imperial_numbered_thread_math?.note ?? '', /not a UNC\/UNF lookup table/)
assert.equal(protruding.optional_thread_extent?.role, 'support_only')
assert.equal(protruding.head_shape_math.K_over_DK, 0.342705)
assert.equal(protruding.head_shape_math.DK_over_D, 1.98729)
assert.equal(protruding.head_shape_math.top_over_underside_width, 0.570988)
assert.equal(protruding.head_shape_math.normalized_profile.length, 9)
assert.equal(protruding.head_shape_math.lower_half_slope, -0.380952)
assert.equal(protruding.head_shape_math.upper_half_slope, -0.619048)
assert.equal(protruding.head_shape_math.slope_change, -0.238096)
assert.equal(protruding.head_shape_glyph.width_columns, 31)
assert.equal(protruding.head_shape_glyph.head_rows, 17)
assert.equal(protruding.head_shape_glyph.shank_rows, 5)
assert.equal(protruding.head_shape_glyph.ascii?.split('\n').length, 22)
assert.equal(/pan|round|socket|truss|button/i.test(protruding.head_shape_glyph.ascii ?? ''), false)
assert.equal(protruding.head_shape_signature.geometry_class, 'protruding')
assert.equal(protruding.head_shape_signature.axial_aspect_K_over_DK, 0.342705)
assert.equal(protruding.head_shape_signature.radial_envelope_DK_over_D, 1.98729)
assert.equal(protruding.head_shape_signature.global_width_cv, 0.175689)
assert.equal(protruding.head_shape_signature.middle_width_cv, 0.096581)
assert.equal(protruding.head_shape_signature.middle_linear_slope, -0.52381)
assert.equal(protruding.head_shape_signature.upper_linear_slope, -0.638095)
assert.equal(protruding.head_shape_signature.curvature_change_median, 0.095238)
assert.equal(protruding.head_shape_signature.upper_narrowing_share, 0.309524)
assert.match(protruding.head_shape_signature.note, /no head-style names/)
assert.match(protruding.head_shape_math.note, /not a head-style lookup table/)
assert.equal('arithmetic_nominal_hints' in protruding, false,
  'CV grounding must not contain nominal candidate tables or standard mappings')
const dimensionCandidate = buildCvDimensionCandidate(protruding)
assert.equal(dimensionCandidate.status, 'candidate')
assert.equal(dimensionCandidate.specification, '#8-32 × 13/32 in')
assert.equal(dimensionCandidate.source, 'imperial_numbered_arithmetic')
assert.deepEqual(dimensionCandidate.excludes,
  ['head_style', 'drive_form', 'drive_size', 'thread_series'])
assert.match(dimensionCandidate.note, /not a complete purchase specification/)

measurement.head_geometry!.length_convention_evidence = 'countersunk'
measurement.head_geometry!.boundary_source = 'coarse_transition'
const countersunk = buildCvGroundingBasis(measurement, true)
assert.equal(countersunk.hard_physical_facts.purchase_length_dimension, 'L_overall')
assert.equal(countersunk.hard_physical_facts.purchase_length_mm, 13.08)
assert.equal(buildCvGroundingBasis(measurement, false).mode, 'appearance_only')

const metricLike = structuredClone(measurement) as unknown as MeasurementResult
metricLike.dimensions!.D = dim(5.98, { edge_diameter_uncertainty_mm: 0.045 })
metricLike.dimensions!.P = dim(1.015)
const metricLikeBasis = buildCvGroundingBasis(metricLike, true)
assert.equal(metricLikeBasis.unit_conversions.imperial_numbered_thread_math?.nearest_integer_size, 13)
assert.equal(metricLikeBasis.unit_conversions.imperial_numbered_thread_math?.diameter_difference_mm, 0.1634)
assert.equal(metricLikeBasis.unit_conversions.imperial_numbered_thread_math?.diameter_residual_over_cv_uncertainty, 3.631111)
assert.equal(metricLikeBasis.unit_conversions.imperial_numbered_thread_math?.eligible_as_numbered_size_evidence, false,
  'nearest integer alone must not turn a metric-like diameter into numbered imperial evidence')
assert.equal(buildCvDimensionCandidate(metricLikeBasis).status, 'unavailable',
  'an ineligible numbered conversion must not become a public dimension candidate')

const degradedBearing = structuredClone(measurement) as unknown as MeasurementResult
degradedBearing.head_geometry!.length_convention_evidence = 'protruding'
degradedBearing.head_geometry!.quality = 'degraded'
degradedBearing.head_geometry!.boundary_source = 'bearing_plane'
degradedBearing.head_geometry!.reason_codes = ['head_profile_centerline_drift']
const partial = buildCvGroundingBasis(degradedBearing, true)
assert.equal(partial.mode, 'dimension_grounded_semantic_pending')
assert.equal(partial.hard_physical_facts.head_geometry_class, 'protruding')
assert.equal(partial.hard_physical_facts.purchase_length_dimension, 'L_underhead')
assert.equal(partial.hard_physical_facts.purchase_length_mm, 10.27)
assert.equal(partial.evidence_partition.bearing_plane.status, 'supported')
assert.equal(partial.evidence_partition.envelope_dimensions.status, 'supported')
assert.equal(partial.evidence_partition.silhouette_integrity.status, 'degraded')
assert.equal(partial.evidence_partition.silhouette_integrity.can_constrain_head_subtype, false)
assert.equal(partial.head_shape_math.K_over_DK, 0.342705)
assert.equal(partial.head_shape_math.DK_over_D, 1.98729)
assert.equal(partial.head_shape_math.normalized_profile.length, 0,
  'degraded silhouette must not be handed to LLM as subtype geometry')
assert.equal(partial.head_shape_math.top_over_underside_width, null)
assert.equal(partial.head_shape_glyph.ascii, null)
assert.equal(partial.head_shape_signature.middle_width_cv, null)
assert.equal(partial.head_shape_signature.middle_linear_slope, null)
assert.equal(partial.head_shape_signature.silhouette_integrity, 'degraded')
assert.equal(buildCvDimensionCandidate(partial).status, 'candidate',
  'dimension-only arithmetic may survive a silhouette-only quality failure')
console.log('CV grounding basis: physical dimensions, bearing plane and silhouette integrity are independent evidence')
