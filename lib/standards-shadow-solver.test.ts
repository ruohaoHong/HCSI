import type { MeasurementV2 } from './measurement-v2'
import { MEASUREMENT_V2_SCHEMA } from './measurement-v2'
import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { buildStandardsShadowResult, enumerateShadowCandidates } from './standards-shadow-solver'

function ok(v: unknown, m='assertion failed'): asserts v { if (!v) throw new Error(m) }
function equal(a: unknown,b: unknown,m='values differ') { if (a !== b) throw new Error(`${m}: ${String(a)} !== ${String(b)}`) }
function near(a: number,b: number,e=1e-9) { if (Math.abs(a-b)>e) throw new Error(`${a} !~= ${b}`) }

const measurement = {
  schema_version: MEASUREMENT_V2_SCHEMA,
  observations: [
    { quantity:'D', value_mm:13.700 },
    { quantity:'P', value_mm:2.051 },
    { quantity:'L_underhead', value_mm:47.540 },
  ],
} as MeasurementV2

const before = structuredClone(measurement)
const set = enumerateShadowCandidates(measurement,STANDARDS_CATALOGUE_V1)
equal(set.decision.status,'shadow_unresolved')
equal(set.decision.selected_candidate_id,null)
equal(set.decision.purchase_ready,false)
equal(set.candidates.length,64)
ok(set.candidates.some(c => c.standard_system === 'iso_metric'))
ok(set.candidates.some(c => c.standard_system === 'unified_inch'))
ok(set.candidates.some(c => c.designation === 'M14 × 2'))
ok(set.candidates.some(c => c.designation === '9/16-12 UNC'))
equal(set.candidates.some(c => /#37-12/i.test(c.designation)),false)
equal(JSON.stringify(measurement),JSON.stringify(before),'solver mutated raw measurement')

const m14 = set.candidates.find(c => c.designation === 'M14 × 2')
ok(m14)
near(m14.residuals.D!.observed_mm,13.700)
near(m14.residuals.D!.residual_mm,-0.300)
near(m14.residuals.P!.observed_mm,2.051)
near(m14.residuals.P!.residual_mm,0.051)
equal(m14.nominal.length_mm,null)
equal(m14.length_comparison?.observed_mm,47.540)
equal(m14.length_comparison?.product_standard_length_validation,'not_implemented_phase1')
const l45 = m14.length_comparison?.hypotheses.find(h => h.nominal_mm === 45)
ok(l45,'45 mm comparison hypothesis missing')
near(l45.residual_mm,2.540)
near(m14.residuals.L_underhead!.observed_mm,47.540)
ok(m14.residuals.L_underhead!.nominal_mm !== 47.540,'measurement was snapped to nominal')

const shadow = buildStandardsShadowResult(measurement,STANDARDS_CATALOGUE_V1,'#37-12 × 1 7/8 in')
equal(shadow.purchase_ready,false)
equal(shadow.legacy_nominal,'#37-12 × 1 7/8 in')
ok(shadow.disagreement_reason.includes('legacy_nominal_not_in_loaded_catalogue'))
ok(shadow.disagreement_reason.includes('cross_system_candidates_retained'))
equal(shadow.scoring_state.covariance_available,false)
equal(shadow.scoring_state.calibrated_probability_available,false)

console.log('Case C architecture regression: raw 13.700/2.051/47.540 preserved; M14 + Unified retained; #37 excluded')
