import assert from 'node:assert/strict'

import { resolveMeasurementPlan, type SemanticMeasurementPlan } from '../../lib/measurement-plan-resolver'

const plan: SemanticMeasurementPlan = {
  minimum_sufficient_evidence: '需要螺絲軸向長度',
  steps: [
    {
      operation: 'axial_distance',
      inputs: ['object_tip', 'width_transition'],
      purpose: '量測採購規格 L',
    },
  ],
  proposed_concepts: [],
}

const flat = resolveMeasurementPlan(plan, {
  category: 'fasteners',
  head_style: 'flat_countersunk',
})
assert.equal(flat.length_convention, 'overall')
assert.deepEqual(flat.executable_steps[0]?.inputs, ['object_tip', 'head_top'])

const hex = resolveMeasurementPlan(plan, {
  category: 'fasteners',
  head_style: 'hex',
})
assert.equal(hex.length_convention, 'under_head_to_tip')
assert.deepEqual(hex.executable_steps[0]?.inputs, ['object_tip', 'head_underface'])

const unknown = resolveMeasurementPlan(plan, {
  category: 'fasteners',
  head_style: 'unknown',
})
assert.equal(unknown.length_convention, 'unresolved')
assert.deepEqual(unknown.executable_steps[0]?.inputs, ['object_tip', 'width_transition'])

console.log('measurement-plan-resolver length convention smoke: ok')
