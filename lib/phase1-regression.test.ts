import type { MeasurementV2 } from './measurement-v2'
import { MEASUREMENT_V2_SCHEMA } from './measurement-v2'
import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { enumerateShadowCandidates } from './standards-shadow-solver'

function ok(v: unknown,m='assertion failed'): asserts v { if (!v) throw new Error(m) }
function equal(a: unknown,b: unknown,m='values differ') { if (a !== b) throw new Error(`${m}: ${String(a)} !== ${String(b)}`) }

type Case = {
  id:'B'|'D'|'E'
  D:number
  P:number
  Lkey:'L_underhead'|'L_overall'
  L:number
  expected:string
}

const cases: Case[] = [
  {id:'B',D:6,P:1,Lkey:'L_overall',L:40,expected:'M6 × 1.0'},
  {id:'D',D:4.1656,P:0.79375,Lkey:'L_underhead',L:10.31875,expected:'#8-32 UNC'},
  {id:'E',D:3,P:0.5,Lkey:'L_underhead',L:30,expected:'M3 × 0.5'},
]

for (const c of cases) {
  const measurement = {
    schema_version:MEASUREMENT_V2_SCHEMA,
    observations:[
      {quantity:'D',value_mm:c.D},
      {quantity:'P',value_mm:c.P},
      {quantity:c.Lkey,value_mm:c.L},
    ],
  } as MeasurementV2
  const before = JSON.stringify(measurement)
  const result = enumerateShadowCandidates(measurement,STANDARDS_CATALOGUE_V1)
  equal(JSON.stringify(measurement),before,`Case ${c.id} raw measurement mutated`)
  ok(result.candidates.some(candidate => candidate.designation === c.expected),`Case ${c.id} expected candidate missing: ${c.expected}`)
  ok(result.candidates.some(candidate => candidate.standard_system === 'iso_metric'),`Case ${c.id} metric universe missing`)
  ok(result.candidates.some(candidate => candidate.standard_system === 'unified_inch'),`Case ${c.id} Unified universe missing`)
  equal(result.decision.selected_candidate_id,null,`Case ${c.id} shadow solver selected a winner`)
  equal(result.decision.purchase_ready,false,`Case ${c.id} shadow solver became purchase-ready`)
}

console.log('B/D/E Phase 1 regression: measurement parity + cross-system candidate-set correctness passed')
