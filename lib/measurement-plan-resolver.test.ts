import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveMeasurementPlan } from './measurement-plan-resolver'

test('resolves a threaded bolt plan entirely from existing geometry vocabulary', () => {
  const resolved = resolveMeasurementPlan({
    minimum_sufficient_evidence: '區分公稱直徑、商品長度與螺紋週期',
    steps: [
      {
        operation: 'axial_distance',
        inputs: ['object_tip', 'width_transition'],
        purpose: '量測螺栓頭下有效長度',
      },
      {
        operation: 'outer_width',
        inputs: ['threaded_shank'],
        purpose: '量測螺紋桿身外徑',
      },
      {
        operation: 'periodicity',
        inputs: ['threaded_shank'],
        purpose: '量測螺紋重複週期',
      },
    ],
    proposed_concepts: [],
  })

  assert.equal(resolved.fully_supported, true)
  assert.equal(resolved.executable_steps.length, 3)
  assert.equal(resolved.unsupported_steps.length, 0)
  assert.deepEqual(
    resolved.steps.map((step) => step.resolution),
    ['supported_by_composition', 'supported_by_composition', 'supported_by_composition']
  )
})

test('preserves a necessary new concept without pretending the engine can execute it', () => {
  const resolved = resolveMeasurementPlan({
    minimum_sufficient_evidence: '需要牙型角才能排除剩餘候選',
    steps: [
      {
        operation: 'thread_flank_angle',
        inputs: ['threaded_shank'],
        purpose: '區分牙型規格',
      },
    ],
    proposed_concepts: [
      {
        name: 'thread_flank_angle',
        kind: 'analyzer',
        purpose: '量測螺紋牙側角',
        why_existing_capabilities_are_insufficient: 'periodicity 只能提供牙距，不能提供牙型角。',
      },
    ],
  })

  assert.equal(resolved.fully_supported, false)
  assert.equal(resolved.executable_steps.length, 0)
  assert.equal(resolved.unsupported_steps.length, 1)
  assert.deepEqual(resolved.unsupported_steps[0].unsupported_terms, ['thread_flank_angle'])
  assert.equal(resolved.proposed_concepts[0].name, 'thread_flank_angle')
})

test('executes supported evidence even when another requested concept is unsupported', () => {
  const resolved = resolveMeasurementPlan({
    minimum_sufficient_evidence: '先取得可量的外徑，同時保留尚未支援的角度需求',
    steps: [
      {
        operation: 'outer_width',
        inputs: ['threaded_shank'],
        purpose: '取得外徑',
      },
      {
        operation: 'thread_flank_angle',
        inputs: ['threaded_shank'],
        purpose: '取得牙型角',
      },
    ],
    proposed_concepts: [],
  })

  assert.equal(resolved.executable_steps.length, 1)
  assert.equal(resolved.unsupported_steps.length, 1)
  assert.equal(resolved.executable_steps[0].operation, 'outer_width')
})
