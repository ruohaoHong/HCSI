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
    status: 'partial' | 'not_estimated'
    null_semantics: 'not_estimated'
    note: string
  }
  systematic_bias_ledger: SystematicBiasComponent[]
  systematic_bias_status: 'unresolved' | 'resolved' | 'not_estimated'
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
    systematic_bias_status:systematic_bias_ledger.some(x => x.status === 'unresolved') ? 'unresolved' : 'not_estimated',
  }
}
