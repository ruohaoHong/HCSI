import type { MeasurementV2 } from './measurement-v2'
import { MEASUREMENT_V2_SCHEMA } from './measurement-v2'
import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { buildStandardsAuthorityResult } from './standards-shadow-solver'

function ok(v: unknown,m='assertion failed'): asserts v { if (!v) throw new Error(m) }
function equal(a: unknown,b: unknown,m='values differ') { if (a !== b) throw new Error(`${m}: ${String(a)} !== ${String(b)}`) }
function near(a: number,b: number,e=1e-9) { if (Math.abs(a-b)>e) throw new Error(`${a} !~= ${b}`) }

const measurement = {
  schema_version: MEASUREMENT_V2_SCHEMA,
  observations: [
    { quantity:'D', value_mm:13.700 },
    { quantity:'P', value_mm:2.051 },
    { quantity:'L_underhead', value_mm:47.540 },
  ],
  uncertainty:{
    schema_version:'hcsi.measurement-uncertainty.v1',
    quantities:[],primitives:[],
    covariance:{quantities:[],matrix_mm2:[],status:'not_estimated',null_semantics:'not_estimated',note:'synthetic regression fixture'},
    systematic_bias_ledger:[],systematic_bias_status:'not_estimated',
  },
} as MeasurementV2
const before = JSON.stringify(measurement)

const authority = buildStandardsAuthorityResult(
  measurement,
  STANDARDS_CATALOGUE_V1,
  {
    llmNominal:'#37-12 × 1 7/8 in',
    dimensionCandidate:'#37-12 × 1 7/8 in',
  },
)

equal(authority.mode,'standards_authority')
equal(authority.contract_version,'hcsi.standards-authority.v1')
equal(JSON.stringify(measurement),before,'authority mutated raw measurement')
equal(authority.decision.status,'unresolved')
equal(authority.decision.selected_candidate_id,null)
equal(authority.decision.purchase_ready,false)
equal(authority.legacy_diagnostics.llm_nominal.authority,'non_authoritative')
equal(authority.legacy_diagnostics.llm_nominal.use,'diagnostic_only')
equal(authority.legacy_diagnostics.dimension_candidate.authority,'non_authoritative')

const designations = authority.formal_candidates.map(c => c.designation)
ok(designations.includes('M14 × 2.0'),'M14 × 2.0 missing')
ok(designations.includes('9/16-12 UNC'),'Unified neighbor missing')
equal(designations.some(d => /#37-12/i.test(d)),false,'invalid #37-12 entered formal universe')
ok(authority.formal_candidates.some(c => c.standard_system === 'iso_metric'),'metric universe missing')
ok(authority.formal_candidates.some(c => c.standard_system === 'unified_inch'),'Unified universe missing')

for (const candidate of authority.formal_candidates) {
  ok(candidate.candidate_id.startsWith(authority.standards_snapshot.snapshot_id + ':'),'candidate id lacks snapshot')
  ok(candidate.standard_ref.catalogue_id.length > 0)
  ok(candidate.standard_ref.catalogue_version.length > 0)
  ok(candidate.standard_ref.record_id.length > 0)
  ok(candidate.standard_ref.provenance.length > 0)
}

const m14 = authority.formal_candidates.find(c => c.designation === 'M14 × 2.0')
ok(m14)
near(m14.residuals.D!.observed_mm,13.700)
near(m14.residuals.P!.observed_mm,2.051)
near(m14.length_comparison!.observed_mm!,47.540)
const l45 = m14.length_comparison!.hypotheses.find(h => h.nominal_mm === 45)
ok(l45,'45 mm hypothesis missing')
near(l45.residual_mm,2.540)
equal(m14.nominal.length_mm,null,'length hypothesis was promoted to formal product length')

console.log('Standards authority migration: catalogue-only candidates, unresolved decision, immutable Case C evidence passed')
