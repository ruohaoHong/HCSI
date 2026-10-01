import type { FixedDimension, MeasurementResult } from './measurement'

export const MEASUREMENT_UNCERTAINTY_SCHEMA = 'hcsi.measurement-uncertainty.v1' as const

export type UncertaintyStatus = 'estimated' | 'not_estimated' | 'upper_bound_only' | 'assumption_limited'
export type BiasStatus = 'resolved' | 'unresolved' | 'not_estimated' | 'not_applicable'

export interface QuantityUncertainty {
  quantity: FixedDimension
  status: UncertaintyStatus
  standard_uncertainty_mm: number | null
  method: string
  primitive_component_ids: string[]
  evidence_ref: string
}

export interface PrimitiveUncertaintyComponent {
  component_id: string
  type:
    | 'ruler_tick_localization'
    | 'ruler_scale_fit'
    | 'screw_edge_localization'
    | 'axis_angle'
    | 'crest_localization'
    | 'bearing_plane'
    | 'tip'
    | 'head_top'
  affected_quantities: FixedDimension[]
  status: UncertaintyStatus
  standard_uncertainty_mm: number | null
  evidence_ref: string
  note: string
}

export interface SystematicBiasComponent {
  bias_component_id: string
  type:
    | 'scale_plane_mismatch'
    | 'depth_parallax'
    | 'lens_distortion_residual'
    | 'ruler_grammar_ambiguity'
    | 'perspective_transfer'
    | 'axis_projection_bias'
    | 'occlusion'
    | 'glare'
    | 'endpoint_semantic_ambiguity'
  affected_quantities: FixedDimension[]
  direction_known: boolean
  estimated_bias_mm: number | null
  bound_mm: number | null
  status: BiasStatus
  evidence_ref: string
  mitigation: string
}

export interface MeasurementUncertaintyV1 {
  schema_version: typeof MEASUREMENT_UNCERTAINTY_SCHEMA
  quantities: QuantityUncertainty[]
  primitives: PrimitiveUncertaintyComponent[]
  covariance: {
    quantities: FixedDimension[]
    matrix_mm2: Array<Array<number | null>>
    status: 'complete' | 'partial' | 'not_estimated'
    null_semantics: 'not_estimated'
    note: string
  }
  systematic_bias_ledger: SystematicBiasComponent[]
  systematic_bias_status: 'unresolved' | 'resolved' | 'not_estimated'
}

export type BiasReadinessStatus =
  | 'ready'
  | 'blocked_unresolved_bias'
  | 'blocked_unestimated_bias'

export interface BiasReadinessAssessment {
  status: BiasReadinessStatus
  quantities: FixedDimension[]
  relevant_component_ids: string[]
  blocking_component_ids: string[]
  reason_codes: string[]
}

export type CovarianceReadinessStatus = 'complete' | 'partial' | 'not_estimated' | 'invalid'

export interface CovarianceReadinessAssessment {
  status: CovarianceReadinessStatus
  quantities: FixedDimension[]
  matrix_mm2: number[][] | null
  reason_codes: string[]
}

function intersects<T>(a: T[], b: T[]): boolean {
  return a.some(value => b.includes(value))
}

const DP_REQUIRED_SYSTEMATIC_BIAS_TYPES: SystematicBiasComponent['type'][] = [
  'scale_plane_mismatch',
  'depth_parallax',
  'perspective_transfer',
  'axis_projection_bias',
  'lens_distortion_residual',
  'ruler_grammar_ambiguity',
  'occlusion',
  'glare',
]

/**
 * Positive authorization gate for decision-relevant systematic bias.
 * Only resolved/not_applicable components are safe. Missing knowledge is never safe.
 */
export function assessJointBiasReadiness(
  uncertainty: MeasurementUncertaintyV1,
  quantities: FixedDimension[],
): BiasReadinessAssessment {
  const relevant = uncertainty.systematic_bias_ledger.filter(component =>
    intersects(component.affected_quantities, quantities)
  )
  const requiredTypes = quantities.some(quantity => quantity === 'D' || quantity === 'P')
    ? DP_REQUIRED_SYSTEMATIC_BIAS_TYPES
    : []
  const missingRequired = requiredTypes.filter(type =>
    !uncertainty.systematic_bias_ledger.some(component => component.type === type)
  )
  const unresolved = relevant.filter(component => component.status === 'unresolved')
  const unestimated = relevant.filter(component => component.status === 'not_estimated')
  const status: BiasReadinessStatus = unresolved.length > 0
    ? 'blocked_unresolved_bias'
    : unestimated.length > 0 || missingRequired.length > 0
      ? 'blocked_unestimated_bias'
      : 'ready'
  return {
    status,
    quantities:[...quantities],
    relevant_component_ids:relevant.map(component => component.bias_component_id),
    blocking_component_ids:unresolved.length > 0
      ? unresolved.map(component => component.bias_component_id)
      : [
          ...unestimated.map(component => component.bias_component_id),
          ...missingRequired.map(type => `missing:${type}`),
        ],
    reason_codes:[
      ...(unresolved.length > 0 ? ['relevant_systematic_bias_unresolved'] : []),
      ...(unestimated.length > 0 ? ['relevant_systematic_bias_not_estimated'] : []),
      ...(missingRequired.length > 0 ? ['required_systematic_bias_component_missing'] : []),
    ],
  }
}

function positiveDefinite(matrix: number[][]): boolean {
  const n = matrix.length
  const lower = Array.from({length:n}, () => Array(n).fill(0))
  for (let i=0;i<n;i++) {
    for (let j=0;j<=i;j++) {
      let sum = 0
      for (let k=0;k<j;k++) sum += lower[i][k] * lower[j][k]
      if (i === j) {
        const value = matrix[i][i] - sum
        if (!(value > 0) || !Number.isFinite(value)) return false
        lower[i][j] = Math.sqrt(value)
      } else {
        if (!(lower[j][j] > 0)) return false
        lower[i][j] = (matrix[i][j] - sum) / lower[j][j]
      }
    }
  }
  return true
}

/**
 * Completeness is assessed for the exact quantities to be fused.
 * Explicit numeric zero covariance is known; null means unknown.
 */
export function assessCovarianceReadiness(
  uncertainty: MeasurementUncertaintyV1,
  quantities: FixedDimension[],
): CovarianceReadinessAssessment {
  const covariance = uncertainty.covariance
  const indexes = quantities.map(quantity => covariance.quantities.indexOf(quantity))
  if (indexes.some(index => index < 0)) {
    return {
      status:'not_estimated',
      quantities:[...quantities],
      matrix_mm2:null,
      reason_codes:['covariance_quantity_missing'],
    }
  }
  if (covariance.matrix_mm2.length !== covariance.quantities.length ||
      covariance.matrix_mm2.some(row => row.length !== covariance.quantities.length)) {
    return {
      status:'invalid',
      quantities:[...quantities],
      matrix_mm2:null,
      reason_codes:['covariance_matrix_shape_invalid'],
    }
  }
  const raw = indexes.map(i => indexes.map(j => covariance.matrix_mm2[i][j]))
  const known = raw.flat().filter(value => value !== null).length
  if (known === 0) {
    return {status:'not_estimated',quantities:[...quantities],matrix_mm2:null,reason_codes:['covariance_not_estimated']}
  }
  if (raw.some(row => row.some(value => value === null))) {
    return {status:'partial',quantities:[...quantities],matrix_mm2:null,reason_codes:['covariance_entries_missing']}
  }
  const matrix = raw as number[][]
  if (matrix.some(row => row.some(value => !Number.isFinite(value)))) {
    return {status:'invalid',quantities:[...quantities],matrix_mm2:null,reason_codes:['covariance_nonfinite']}
  }
  for (let i=0;i<matrix.length;i++) {
    if (!(matrix[i][i] > 0)) {
      return {status:'invalid',quantities:[...quantities],matrix_mm2:null,reason_codes:['covariance_variance_nonpositive']}
    }
    for (let j=i+1;j<matrix.length;j++) {
      if (Math.abs(matrix[i][j]-matrix[j][i]) > 1e-12) {
        return {status:'invalid',quantities:[...quantities],matrix_mm2:null,reason_codes:['covariance_not_symmetric']}
      }
    }
  }
  if (matrix.length === 2) {
    const determinant = matrix[0][0]*matrix[1][1] - matrix[0][1]*matrix[1][0]
    const scale = Math.max(
      Math.abs(matrix[0][0]*matrix[1][1]),
      Math.abs(matrix[0][1]*matrix[1][0]),
      Number.MIN_VALUE,
    )
    if (!(determinant > Number.EPSILON * scale * 64)) {
      return {status:'invalid',quantities:[...quantities],matrix_mm2:null,reason_codes:['covariance_singular_or_near_singular']}
    }
  }
  if (!positiveDefinite(matrix)) {
    return {status:'invalid',quantities:[...quantities],matrix_mm2:null,reason_codes:['covariance_not_positive_definite']}
  }
  return {status:'complete',quantities:[...quantities],matrix_mm2:matrix,reason_codes:[]}
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

const ALL: FixedDimension[] = ['D','P','L_underhead','L_overall','B','K','DK']

/**
 * Builds only uncertainty terms directly supported by current CV diagnostics.
 * Unknown covariance is null, never zero. Systematic effects remain outside Σ.
 */
export function buildMeasurementUncertainty(source: MeasurementResult): MeasurementUncertaintyV1 {
  const measured = ALL.filter(q => source.dimensions?.[q]?.status === 'measured')
  const dSigma = source.dimensions?.D?.diagnostics?.edge_diameter_uncertainty_mm
  const dEstimated = finitePositive(dSigma)

  const primitives: PrimitiveUncertaintyComponent[] = [
    {
      component_id:'ruler-scale-fit',
      type:'ruler_scale_fit',
      affected_quantities:measured,
      status:'not_estimated',
      standard_uncertainty_mm:null,
      evidence_ref:'ruler.px_per_cm/local_px_per_cm',
      note:'A scale estimate exists, but the current service does not expose a calibrated scale-fit standard uncertainty.',
    },
    {
      component_id:'screw-edge-localization-D',
      type:'screw_edge_localization',
      affected_quantities:['D'],
      status:dEstimated ? 'estimated' : 'not_estimated',
      standard_uncertainty_mm:dEstimated ? dSigma : null,
      evidence_ref:'dimensions.D.diagnostics.edge_diameter_uncertainty_mm',
      note:dEstimated ? 'Direct CV edge-diameter uncertainty diagnostic.' : 'No directly supported D localization uncertainty was emitted.',
    },
    {
      component_id:'crest-localization-P',
      type:'crest_localization',
      affected_quantities:['P'],
      status:'not_estimated',
      standard_uncertainty_mm:null,
      evidence_ref:'dimensions.P.diagnostics',
      note:'Crest/edge diagnostics exist, but are not yet a calibrated pitch-estimator standard uncertainty.',
    },
    {
      component_id:'bearing-plane-L',
      type:'bearing_plane',
      affected_quantities:['L_underhead'],
      status:'not_estimated',
      standard_uncertainty_mm:null,
      evidence_ref:'geometry_steps.head_underface',
      note:'Bearing-plane landmark is observable when resolved; its mm uncertainty is not currently estimated.',
    },
    {
      component_id:'tip-L',
      type:'tip',
      affected_quantities:['L_underhead','L_overall'],
      status:'not_estimated',
      standard_uncertainty_mm:null,
      evidence_ref:'geometry_steps.object_tip',
      note:'Tip landmark uncertainty is not currently estimated.',
    },
    {
      component_id:'head-top-L',
      type:'head_top',
      affected_quantities:['L_overall','K'],
      status:'not_estimated',
      standard_uncertainty_mm:null,
      evidence_ref:'geometry_steps.head_top',
      note:'Head-top landmark uncertainty is not currently estimated.',
    },
    {
      component_id:'axis-angle',
      type:'axis_angle',
      affected_quantities:measured,
      status:'not_estimated',
      standard_uncertainty_mm:null,
      evidence_ref:'object.principal_angle_deg',
      note:'Axis orientation is measured, but its propagated mm uncertainty is not currently available.',
    },
    {
      component_id:'ruler-tick-localization',
      type:'ruler_tick_localization',
      affected_quantities:measured,
      status:'not_estimated',
      standard_uncertainty_mm:null,
      evidence_ref:'ruler.reference_points',
      note:'Tick locations feed scale inference but no calibrated localization uncertainty is exposed.',
    },
  ]

  const quantities: QuantityUncertainty[] = measured.map(quantity => {
    if (quantity === 'D' && dEstimated) return {
      quantity,
      status:'assumption_limited',
      standard_uncertainty_mm:dSigma,
      method:'local_cv_edge_diameter_component_only',
      primitive_component_ids:['screw-edge-localization-D'],
      evidence_ref:'dimensions.D.diagnostics.edge_diameter_uncertainty_mm',
    }
    return {
      quantity,
      status:'not_estimated',
      standard_uncertainty_mm:null,
      method:'not_estimated_from_current_cv_outputs',
      primitive_component_ids: primitives.filter(p => p.affected_quantities.includes(quantity)).map(p => p.component_id),
      evidence_ref:`dimensions.${quantity}`,
    }
  })

  const matrix = measured.map((q,i) => measured.map((r,j) => {
    if (i === j && q === 'D' && r === 'D' && dEstimated) return dSigma * dSigma
    return null
  }))

  const samePlane = source.capture_assumptions.same_plane_status
  const nearOverhead = source.capture_assumptions.near_overhead_status
  const allMeasured = measured
  const systematic_bias_ledger: SystematicBiasComponent[] = [
    {
      bias_component_id:'scale-plane-mismatch',
      type:'scale_plane_mismatch',
      affected_quantities:allMeasured,
      direction_known:false, estimated_bias_mm:null, bound_mm:null,
      status:samePlane === 'verified' ? 'resolved' : 'unresolved',
      evidence_ref:'capture_assumptions.same_plane_status',
      mitigation:'Require ruler and fastener in the same physical plane; future active capture may request a corrected image.',
    },
    {
      bias_component_id:'depth-parallax',
      type:'depth_parallax',
      affected_quantities:allMeasured,
      direction_known:false, estimated_bias_mm:null, bound_mm:null,
      status:samePlane === 'verified' ? 'resolved' : 'unresolved',
      evidence_ref:'capture_assumptions.same_plane_status',
      mitigation:'Do not absorb into random covariance; resolve capture geometry before high-authority decision.',
    },
    {
      bias_component_id:'perspective-transfer',
      type:'perspective_transfer',
      affected_quantities:allMeasured,
      direction_known:false, estimated_bias_mm:null, bound_mm:null,
      status:nearOverhead === 'verified' ? 'resolved' : 'unresolved',
      evidence_ref:'capture_assumptions.near_overhead_status',
      mitigation:'Preserve as systematic ambiguity unless capture geometry supports projection transfer.',
    },
    {
      bias_component_id:'lens-distortion-residual',
      type:'lens_distortion_residual',
      affected_quantities:allMeasured,
      direction_known:false, estimated_bias_mm:null, bound_mm:null,
      status:'not_estimated',
      evidence_ref:'image/calibration',
      mitigation:'Requires calibrated camera/distortion evidence; no empirical fudge factor is applied.',
    },
    {
      bias_component_id:'ruler-grammar-ambiguity',
      type:'ruler_grammar_ambiguity',
      affected_quantities:allMeasured,
      direction_known:false, estimated_bias_mm:null, bound_mm:null,
      status:source.ruler.scale_system === 'unknown' ? 'unresolved' : 'not_estimated',
      evidence_ref:'ruler.scale_system/scale_source',
      mitigation:'Retain scale-source provenance; quantify only when scale grammar uncertainty is calibrated.',
    },
    {
      bias_component_id:'axis-projection-bias',
      type:'axis_projection_bias',
      affected_quantities:allMeasured,
      direction_known:false, estimated_bias_mm:null, bound_mm:null,
      status:nearOverhead === 'verified' ? 'not_estimated' : 'unresolved',
      evidence_ref:'object.principal_angle_deg/capture_assumptions.near_overhead_status',
      mitigation:'Requires 3D/capture assumptions beyond current single-view evidence.',
    },
    {
      bias_component_id:'endpoint-semantic-ambiguity',
      type:'endpoint_semantic_ambiguity',
      affected_quantities:['L_underhead','L_overall','K'],
      direction_known:false, estimated_bias_mm:null, bound_mm:null,
      status:measured.some(q => ['L_underhead','L_overall','K'].includes(q)) ? 'not_estimated' : 'not_applicable',
      evidence_ref:'dimensions/geometry_steps/head_geometry',
      mitigation:'Keep bearing-plane, tip and head-top semantics explicit; do not snap to nominal length.',
    },
    {
      bias_component_id:'occlusion',
      type:'occlusion',
      affected_quantities:allMeasured,
      direction_known:false, estimated_bias_mm:null, bound_mm:null,
      status:source.object.risk_signals.some(x => /occlu/i.test(x)) ? 'unresolved' : 'not_estimated',
      evidence_ref:'object.risk_signals',
      mitigation:'Treat unresolved occlusion as missing information, not zero-mean noise.',
    },
    {
      bias_component_id:'glare',
      type:'glare',
      affected_quantities:allMeasured,
      direction_known:false, estimated_bias_mm:null, bound_mm:null,
      status:source.object.risk_signals.some(x => /glare|reflect/i.test(x)) ? 'unresolved' : 'not_estimated',
      evidence_ref:'object.risk_signals',
      mitigation:'Treat unresolved glare as missing information, not zero-mean noise.',
    },
  ]

  return {
    schema_version:MEASUREMENT_UNCERTAINTY_SCHEMA,
    quantities,
    primitives,
    covariance:{
      quantities:measured,
      matrix_mm2:matrix,
      status:dEstimated ? 'partial' : 'not_estimated',
      null_semantics:'not_estimated',
      note:'Only directly supported local diagonal variance components are populated; this is not total propagated covariance. Unknown variances/covariances are null, never zero.',
    },
    systematic_bias_ledger,
    systematic_bias_status:systematic_bias_ledger.some(x => x.status === 'unresolved')
      ? 'unresolved'
      : systematic_bias_ledger.some(x => x.status === 'not_estimated')
        ? 'not_estimated'
        : 'resolved',
  }
}
