import assert from 'node:assert/strict'
import type { HeadGeometryEvidence, MeasurementResult } from './measurement'
import { evaluateHeadStyleConsistency } from './head-style-consistency'

function measurement(
  convention: HeadGeometryEvidence['length_convention_evidence'],
  quality: HeadGeometryEvidence['quality'] = 'reliable',
): MeasurementResult {
  return { head_geometry: {
    status: 'measured', quality, reason_codes: [],
    boundary_source: 'bearing_plane', sample_count: 30,
    head_height_px: 30, head_width_p90_px: 60, shank_width_px: 25,
    height_to_width: 0.5, bearing_width_ratio: 0.9, mid_width_ratio: 0.9,
    top_width_ratio: 0.8, max_width_position: 0.2, width_trend: -0.1,
    centerline_drift_ratio: 0.02, profile_roughness: 0.01,
    length_convention_evidence: convention, profile_points: [],
  } } as unknown as MeasurementResult
}

const conflict = evaluateHeadStyleConsistency('pan', measurement('countersunk'))
assert.equal(conflict.status, 'conflict')
assert.equal(conflict.resolved_head_style, 'flat_countersunk', 'trusted CV countersunk geometry determines the length class')
assert.equal(conflict.excluded_candidates.includes('pan'), true)
assert.equal(evaluateHeadStyleConsistency('flat_countersunk', measurement('protruding')).resolved_head_style, 'unknown',
  'protruding silhouette does not uniquely imply a particular protruding head')

const supported = evaluateHeadStyleConsistency('pan', measurement('protruding'))
assert.equal(supported.status, 'consistent')
assert.equal(supported.resolved_head_style, 'pan')
assert.deepEqual(supported.excluded_candidates, ['flat_countersunk'])

const ambiguous = evaluateHeadStyleConsistency('button', measurement('ambiguous'))
assert.equal(ambiguous.status, 'consistent')
assert.equal(ambiguous.resolved_head_style, 'button')
assert.equal(ambiguous.selection_basis, 'llm_visual_plus_cv_constraints')

const degraded = evaluateHeadStyleConsistency('flat_countersunk', measurement('countersunk', 'degraded'))
assert.equal(degraded.status, 'insufficient')
assert.equal(degraded.resolved_head_style, 'flat_countersunk')

const unresolved = evaluateHeadStyleConsistency('unknown', measurement('protruding'))
assert.equal(unresolved.status, 'insufficient')
assert.equal(unresolved.resolved_head_style, 'unknown')
console.log('Head-style consistency: reliable CV conflicts are rejected; ambiguous geometry preserves combined visual choice')
