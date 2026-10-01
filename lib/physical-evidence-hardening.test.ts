import { strict as assert } from 'node:assert'
import type { FixedDimension } from './measurement'
import type { MeasurementV2, NominalCandidate } from './measurement-v2'
import {
  assessCovarianceReadiness,
  assessJointBiasReadiness,
  type BiasStatus,
  type MeasurementUncertaintyV1,
  type SystematicBiasComponent,
} from './measurement-uncertainty'
import { evaluateCandidatePhysicalEvidence } from './physical-evidence-likelihood'
import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { buildStandardsAuthorityResult } from './standards-shadow-solver'

const relevantBiasTypes: SystematicBiasComponent['type'][] = [
  'scale_plane_mismatch',
  'depth_parallax',
  'perspective_transfer',
  'axis_projection_bias',
  'lens_distortion_residual',
  'ruler_grammar_ambiguity',
  'occlusion',
  'glare',
]

function biasLedger(depthStatus: BiasStatus): SystematicBiasComponent[] {
  return relevantBiasTypes.map(type => ({
    bias_component_id:type,
    type,
    affected_quantities:['D','P'],
    direction_known:false,
    estimated_bias_mm:null,
    bound_mm:null,
    status:type === 'depth_parallax' ? depthStatus : 'resolved',
    evidence_ref:'synthetic',
    mitigation:'synthetic-test',
  }))
}

function uncertainty(
  matrix: Array<Array<number | null>>,
  depthStatus: BiasStatus = 'resolved',
  dSigma = 0.1,
  pSigma = 0.05,
): MeasurementUncertaintyV1 {
  return {
    schema_version:'hcsi.measurement-uncertainty.v1',
    quantities:[
      {quantity:'D',status:'estimated',standard_uncertainty_mm:dSigma,method:'synthetic',primitive_component_ids:[],evidence_ref:'synthetic'},
      {quantity:'P',status:'estimated',standard_uncertainty_mm:pSigma,method:'synthetic',primitive_component_ids:[],evidence_ref:'synthetic'},
    ],
    primitives:[],
    covariance:{
      quantities:['D','P'],
      matrix_mm2:matrix,
      status:matrix.flat().every(v => v !== null) ? 'complete' : 'partial',
      null_semantics:'not_estimated',
      note:'synthetic',
    },
    systematic_bias_ledger:biasLedger(depthStatus),
    systematic_bias_status:depthStatus === 'resolved' ? 'resolved' : depthStatus === 'unresolved' ? 'unresolved' : 'not_estimated',
  }
}

function measurement(u: MeasurementUncertaintyV1): MeasurementV2 {
  return {
    schema_version:'hcsi.measurement.v2',
    source_schema_version:'hcsi.measurement.v1',
    image_sha256:'f'.repeat(64),
    observations:[
      {quantity:'D',value_mm:13.7,value_px:null,confidence:'verified',risk_signals:[],reason_codes:[],evidence_refs:[]},
      {quantity:'P',value_mm:2.051,value_px:null,confidence:'verified',risk_signals:[],reason_codes:[],evidence_refs:[]},
      {quantity:'L_underhead',value_mm:47.54,value_px:null,confidence:'verified',risk_signals:[],reason_codes:[],evidence_refs:[]},
    ],
    head_geometry:null,
    scale:{system:'metric',px_per_cm:100,px_per_inch:254,source:'metric_ticks',confidence:1},
    capture_assumptions:{same_plane_required:true,same_plane_verified:true,same_plane_status:'verified',near_overhead_required:true,near_overhead_status:'verified',ruler_parallel_required:false,ruler_parallel_preferred:true},
    uncertainty:u,
    immutability:{raw_measurements_are_nominally_snapped:false,nominal_solver_may_modify_measurement:false},
  }
}

const candidate: NominalCandidate = {
  candidate_id:'synthetic:m14x2',
  standard_system:'iso_metric',
  family:'iso_metric_machine_thread',
  designation:'M14 × 2.0',
  nominal:{diameter_mm:14,pitch_mm:2,tpi:null,length_mm:null,length_convention:'family_specific'},
  standard_ref:{catalogue_id:'synthetic',catalogue_version:'1',record_id:'m14',provenance:'synthetic'},
  residuals:{},
  score:{measurement_log_likelihood:null,rank:null},
}

// A0 — missing required D/P bias component is itself unsafe.
{
  const u=uncertainty([[0.01,0],[0,0.0025]],'resolved')
  u.systematic_bias_ledger = u.systematic_bias_ledger.filter(item => item.type !== 'glare')
  const m=measurement(u)
  const readiness=assessJointBiasReadiness(m.uncertainty,['D','P'])
  assert.equal(readiness.status,'blocked_unestimated_bias')
  assert.ok(readiness.reason_codes.includes('required_systematic_bias_component_missing'))
  assert.ok(readiness.blocking_component_ids.includes('missing:glare'))
  const result=evaluateCandidatePhysicalEvidence(m,candidate)
  assert.equal(result.joint.status,'blocked_by_unestimated_systematic_bias')
  assert.equal(result.joint.log_density,null)
}

// A — not_estimated relevant systematic bias blocks joint.
{
  const m=measurement(uncertainty([[0.01,0],[0,0.0025]],'not_estimated'))
  const readiness=assessJointBiasReadiness(m.uncertainty,['D','P'])
  assert.equal(readiness.status,'blocked_unestimated_bias')
  const result=evaluateCandidatePhysicalEvidence(m,candidate)
  assert.equal(result.joint.status,'blocked_by_unestimated_systematic_bias')
  assert.equal(result.joint.log_density,null)
}

// B — unresolved relevant systematic bias blocks joint.
{
  const m=measurement(uncertainty([[0.01,0],[0,0.0025]],'unresolved'))
  assert.equal(assessJointBiasReadiness(m.uncertainty,['D','P']).status,'blocked_unresolved_bias')
  const result=evaluateCandidatePhysicalEvidence(m,candidate)
  assert.equal(result.joint.status,'blocked_by_unresolved_systematic_bias')
  assert.equal(result.joint.log_density,null)
}

// C — unknown Cov(D,P)=null is incomplete, never implicit independence.
{
  const m=measurement(uncertainty([[0.01,null],[null,0.0025]],'resolved'))
  const readiness=assessCovarianceReadiness(m.uncertainty,['D','P'])
  assert.equal(readiness.status,'partial')
  assert.equal(readiness.matrix_mm2,null)
  const result=evaluateCandidatePhysicalEvidence(m,candidate)
  assert.equal(result.joint.status,'blocked_by_incomplete_covariance')
  assert.equal(result.joint.log_density,null)
}

// D — explicit measured/declared zero covariance is known and can permit a joint density.
{
  const m=measurement(uncertainty([[0.01,0],[0,0.0025]],'resolved'))
  const readiness=assessCovarianceReadiness(m.uncertainty,['D','P'])
  assert.equal(readiness.status,'complete')
  assert.deepEqual(readiness.matrix_mm2,[[0.01,0],[0,0.0025]])
  const result=evaluateCandidatePhysicalEvidence(m,candidate)
  assert.equal(result.joint.status,'available')
  assert.equal(typeof result.joint.log_density,'number')
  const independentEquivalent =
    (result.D.random_measurement_log_density as number) +
    (result.P.random_measurement_log_density as number)
  assert.ok(Math.abs((result.joint.log_density as number)-independentEquivalent)<1e-12)
}

// E — asymmetric, non-positive variance, or singular covariance fails closed.
{
  const invalidMatrices: Array<Array<Array<number|null>>> = [
    [[0.01,0.001],[0.002,0.0025]],
    [[0,0],[0,0.0025]],
    [[0.01,0.005],[0.005,0.0025]],
  ]
  for (const matrix of invalidMatrices) {
    const m=measurement(uncertainty(matrix,'resolved'))
    assert.equal(assessCovarianceReadiness(m.uncertainty,['D','P']).status,'invalid')
    const result=evaluateCandidatePhysicalEvidence(m,candidate)
    assert.equal(result.joint.status,'blocked_by_invalid_covariance')
    assert.equal(result.joint.log_density,null)
  }
}

// F — tolerance unavailable leaves only local random-measurement nominal proximity semantics.
{
  const m=measurement(uncertainty([[0.01,0],[0,0.0025]],'resolved'))
  const result=evaluateCandidatePhysicalEvidence(m,candidate)
  assert.equal(result.tolerance.status,'unavailable')
  assert.equal(result.standards_likelihood.available,false)
  assert.equal(result.semantics,'random_measurement_nominal_proximity_not_standards_likelihood_or_posterior')
  assert.equal(typeof result.D.random_measurement_log_density,'number')
  assert.match(result.D.interpretation,/not a standards-conformity likelihood, candidate probability, or posterior/)
  assert.ok(result.joint.reason_codes.includes('standards_tolerance_unavailable_full_standards_likelihood_not_computed'))
}

// G — stronger local density must never select a winner or open purchase.
{
  const m=measurement(uncertainty([[0.01,0],[0,0.0025]],'resolved'))
  const before=JSON.stringify(m.observations)
  const authority=buildStandardsAuthorityResult(m,STANDARDS_CATALOGUE_V1)
  assert.equal(authority.decision.selected_candidate_id,null)
  assert.equal(authority.decision.purchase_ready,false)
  assert.equal(JSON.stringify(m.observations),before)
  assert.ok(authority.formal_candidates.some(c=>c.standard_system==='iso_metric'))
  assert.ok(authority.formal_candidates.some(c=>c.standard_system==='unified_inch'))
}

console.log('Phase 2A.1 fail-closed hardening A-G passed: bias/covariance/tolerance semantics and no-selection invariants')
