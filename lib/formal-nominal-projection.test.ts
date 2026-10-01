import { strict as assert } from 'node:assert'
import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { buildStandardsAuthorityResult, type StandardsAuthorityResult } from './standards-shadow-solver'
import { MEASUREMENT_V2_SCHEMA, type MeasurementV2 } from './measurement-v2'
import { projectSelectedFormalNominal, resolveSelectedFormalCandidate } from './formal-nominal-projection'

const measurement = {
  schema_version:MEASUREMENT_V2_SCHEMA,
  source_schema_version:'hcsi.measurement.v1',
  image_sha256:'0'.repeat(64),
  observations:[
    {quantity:'D',value_mm:13.7,value_px:null,confidence:'verified',risk_signals:[],reason_codes:[],evidence_refs:[]},
    {quantity:'P',value_mm:2.051,value_px:null,confidence:'verified',risk_signals:[],reason_codes:[],evidence_refs:[]},
  ],
  head_geometry:null,
  scale:{system:'metric',px_per_cm:10,px_per_inch:25.4,source:'metric_ticks',confidence:1},
  capture_assumptions:{same_plane_required:true,same_plane_verified:false,same_plane_status:'unknown',near_overhead_required:true,near_overhead_status:'unknown',ruler_parallel_required:false,ruler_parallel_preferred:true},
  uncertainty:{schema_version:'hcsi.measurement-uncertainty.v1',quantities:[],primitives:[],covariance:{quantities:[],matrix_mm2:[],status:'not_estimated',null_semantics:'not_estimated',note:''},systematic_bias_ledger:[],systematic_bias_status:'unresolved'},
  immutability:{raw_measurements_are_nominally_snapped:false,nominal_solver_may_modify_measurement:false},
} as MeasurementV2

const base=buildStandardsAuthorityResult(measurement,STANDARDS_CATALOGUE_V1,{llmNominal:'#37-12'})
const m14=base.formal_candidates.find(x=>x.designation==='M14 × 2.0')
assert.ok(m14)

// Test 1 + 2: valid selected candidate projects canonically despite conflicting legacy nominal.
const selected={...base,decision:{...base.decision,selected_candidate_id:m14.candidate_id,status:'selected' as const,purchase_ready:true}}
assert.equal(resolveSelectedFormalCandidate(selected)?.candidate_id,m14.candidate_id)
const projection=projectSelectedFormalNominal(selected)
assert.equal(projection?.designation,'M14 × 2.0')
assert.notEqual(projection?.designation,selected.legacy_diagnostics.llm_nominal.value)
assert.equal(projection?.standard_ref.record_id,m14.standard_ref.record_id)
assert.equal(projection?.standards_snapshot.snapshot_id,base.standards_snapshot.snapshot_id)

// Test 3: invalid selected ID fails closed.
const invalid={...base,decision:{...base.decision,selected_candidate_id:'nonexistent-id',status:'selected' as const,purchase_ready:true}}
assert.throws(()=>projectSelectedFormalNominal(invalid),/invalid_selected_standards_candidate/)

// Test 4: unresolved means no public formal nominal.
assert.equal(projectSelectedFormalNominal(base),null)

// Duplicate IDs are also hard invalid rather than rank/fallback.
const duplicate={...selected,formal_candidates:[...selected.formal_candidates,{...m14}]} as StandardsAuthorityResult
assert.throws(()=>projectSelectedFormalNominal(duplicate),/matches=2/)

console.log('Formal projection seam: canonical selected candidate only; conflict and invalid-ID fallback are sealed')
