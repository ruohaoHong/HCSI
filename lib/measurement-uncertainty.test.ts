import { strict as assert } from 'node:assert'
import type { MeasurementResult } from './measurement'
import { toMeasurementV2 } from './measurement-v2'

const source={
  schema_version:'hcsi.measurement.v1',
  image_sha256:'a'.repeat(64),
  dimensions:{
    D:{status:'measured',value_px:137,value_mm:13.7,confidence:'verified',risk_signals:[],reason_codes:[],diagnostics:{edge_diameter_uncertainty_mm:0.08}},
    P:{status:'measured',value_px:20.51,value_mm:2.051,confidence:'verified',risk_signals:[],reason_codes:[],diagnostics:{selected_crest_count:8}},
    L_underhead:{status:'measured',value_px:475.4,value_mm:47.54,confidence:'verified',risk_signals:[],reason_codes:[],diagnostics:{}},
  },
  head_geometry:null,
  scale_system:'metric',scale_px_per_cm:100,scale_px_per_inch:254,
  ruler:{scale_source:'metric_ticks',scale_confidence:0.9,scale_system:'metric'},
  object:{risk_signals:[],principal_angle_deg:2},
  capture_assumptions:{same_plane_required:true,same_plane_verified:false,same_plane_status:'unknown',near_overhead_required:true,near_overhead_status:'unknown',ruler_parallel_required:false,ruler_parallel_preferred:true},
} as unknown as MeasurementResult

const before=JSON.stringify(source)
const m=toMeasurementV2(source)
assert.equal(JSON.stringify(source),before,'measurement adapter mutated source')
assert.equal(m.observations.find(x=>x.quantity==='D')?.value_mm,13.7)
assert.equal(m.observations.find(x=>x.quantity==='P')?.value_mm,2.051)
assert.equal(m.observations.find(x=>x.quantity==='L_underhead')?.value_mm,47.54)

const d=m.uncertainty.quantities.find(x=>x.quantity==='D')!
const p=m.uncertainty.quantities.find(x=>x.quantity==='P')!
assert.equal(d.status,'assumption_limited')
assert.equal(d.standard_uncertainty_mm,0.08)
assert.equal(p.status,'not_estimated')
assert.equal(p.standard_uncertainty_mm,null)

assert.equal(m.uncertainty.covariance.status,'partial')
const di=m.uncertainty.covariance.quantities.indexOf('D')
const pi=m.uncertainty.covariance.quantities.indexOf('P')
assert.equal(m.uncertainty.covariance.matrix_mm2[di][di],0.0064)
assert.equal(m.uncertainty.covariance.matrix_mm2[pi][pi],null,'missing P variance must not become zero')
assert.equal(m.uncertainty.covariance.matrix_mm2[di][pi],null,'unknown covariance must not become zero')

const depth=m.uncertainty.systematic_bias_ledger.find(x=>x.type==='depth_parallax')!
assert.equal(depth.status,'unresolved')
assert.equal(depth.estimated_bias_mm,null)
assert.equal(depth.bound_mm,null)
assert.equal(m.uncertainty.systematic_bias_status,'unresolved')
assert.ok(m.uncertainty.primitives.some(x=>x.type==='crest_localization' && x.status==='not_estimated'))

assert.ok(Object.isFrozen(m))
assert.throws(()=>{(m.observations[0] as {value_mm:number}).value_mm=14})

console.log('Measurement uncertainty: supported D sigma only; missing covariance stays null; depth bias remains unresolved')
