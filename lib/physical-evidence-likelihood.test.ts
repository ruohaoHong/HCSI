import { strict as assert } from 'node:assert'
import type { MeasurementResult } from './measurement'
import { toMeasurementV2 } from './measurement-v2'
import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { buildStandardsAuthorityResult } from './standards-shadow-solver'

const source={
  schema_version:'hcsi.measurement.v1',image_sha256:'c'.repeat(64),
  dimensions:{
    D:{status:'measured',value_px:137,value_mm:13.700,confidence:'verified',risk_signals:[],reason_codes:[],diagnostics:{edge_diameter_uncertainty_mm:0.08}},
    P:{status:'measured',value_px:20.51,value_mm:2.051,confidence:'verified',risk_signals:[],reason_codes:[],diagnostics:{}},
    L_underhead:{status:'measured',value_px:475.4,value_mm:47.540,confidence:'verified',risk_signals:[],reason_codes:[],diagnostics:{}},
  },
  head_geometry:null,scale_system:'metric',scale_px_per_cm:100,scale_px_per_inch:254,
  ruler:{scale_source:'metric_ticks',scale_confidence:0.9,scale_system:'metric'},
  object:{risk_signals:[],principal_angle_deg:0},
  capture_assumptions:{same_plane_required:true,same_plane_verified:false,same_plane_status:'unknown',near_overhead_required:true,near_overhead_status:'unknown',ruler_parallel_required:false,ruler_parallel_preferred:true},
} as unknown as MeasurementResult

const m=toMeasurementV2(source)
const before=JSON.stringify(m.observations)
const authority=buildStandardsAuthorityResult(m,STANDARDS_CATALOGUE_V1,{llmNominal:'#37-12'})
assert.equal(JSON.stringify(m.observations),before,'likelihood evaluation mutated raw measurements')
assert.equal(authority.decision.selected_candidate_id,null)
assert.equal(authority.decision.purchase_ready,false)
assert.ok(authority.formal_candidates.some(x=>x.standard_system==='iso_metric'))
assert.ok(authority.formal_candidates.some(x=>x.standard_system==='unified_inch'))
assert.equal(authority.formal_candidates.some(x=>x.designation.includes('#37-12')),false)

const m14=authority.formal_candidates.find(x=>x.designation==='M14 × 2.0')!
const u=authority.formal_candidates.find(x=>x.designation==='9/16-12 UNC')!
assert.ok(m14 && u)
assert.equal(m14.residuals.D?.residual_mm,-0.3000000000000007)
assert.ok(Math.abs((m14.residuals.P?.residual_mm ?? 0)-0.051)<1e-12)
assert.ok(Math.abs((u.residuals.D?.residual_mm ?? 0)-(-0.5875))<1e-12)
assert.ok(Math.abs((u.residuals.P?.residual_mm ?? 0)-(2.051-25.4/12))<1e-12)

assert.equal(m14.physical_evidence?.D.status,'available_local_random_component')
assert.equal(m14.physical_evidence?.P.status,'uncertainty_unavailable')
assert.equal(m14.physical_evidence?.tolerance.status,'unavailable')
assert.equal(m14.physical_evidence?.joint.status,'blocked_by_unresolved_systematic_bias')
assert.equal(m14.physical_evidence?.joint.log_density,null)
assert.ok((m14.physical_evidence?.D.random_measurement_log_density ?? -Infinity) > (u.physical_evidence?.D.random_measurement_log_density ?? -Infinity),
  'M14 should be more compatible on the supported D random component')
assert.equal(m14.physical_evidence?.semantics,'random_measurement_nominal_proximity_not_standards_likelihood_or_posterior')
assert.equal(m14.physical_evidence?.bias_readiness.status,'blocked_unresolved_bias')
assert.equal(m14.physical_evidence?.covariance_readiness.status,'partial')
assert.equal(m14.physical_evidence?.standards_likelihood.available,false)
assert.ok(m14.physical_evidence?.joint.reason_codes.includes('standards_tolerance_unavailable_full_standards_likelihood_not_computed'))

const l45=m14.length_comparison?.hypotheses.find(x=>x.nominal_mm===45)
assert.ok(l45)
assert.ok(Math.abs(l45.residual_mm-2.540)<1e-9)
assert.equal(m14.nominal.length_mm,null)
assert.equal(m14.length_comparison?.product_standard_length_validation,'not_implemented_phase1')

console.log('Case C physical foundation: cross-system preserved; D local nominal-proximity density comparable; P/tolerance/joint fail-closed; no winner selected')
