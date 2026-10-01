import type { MeasurementV2, NominalCandidate, NominalCandidateSet, StandardSystem } from './measurement-v2'
import { MEASUREMENT_V2_SCHEMA, NOMINAL_CANDIDATE_SCHEMA, getObservedMm } from './measurement-v2'
import type { StandardsCatalogue, ThreadStandardRecord } from './standards-catalogue'
import { findCatalogueDesignation, validateStandardsCatalogue } from './standards-catalogue'
import { evaluateCandidatePhysicalEvidence } from './physical-evidence-likelihood'

const MM_PER_INCH = 25.4

export interface StandardsShadowResult {
  mode: 'shadow'
  contract_version: 'hcsi.standards-shadow.v1'
  measurement_v2: MeasurementV2
  standards_snapshot: NonNullable<NominalCandidateSet['standards_snapshot']>
  legacy_nominal: string | null
  new_candidates: NominalCandidate[]
  candidate_summary: {
    total: number
    iso_metric: number
    unified_inch: number
    top_candidate_id: string | null
  }
  disagreement_reason: string[]
  purchase_ready: false
  purchase_ready_reason: 'shadow_mode_not_authoritative'
  scoring_state: {
    model_id: 'phase1-euclidean-dp-residual-v1'
    calibrated_probability_available: false
    covariance_available: boolean
    tolerance_likelihood_available: boolean
    todo: string
  }
}

function residual(observedMm: number | null, nominalMm: number) {
  if (observedMm === null) return undefined
  const value = observedMm - nominalMm
  return {
    observed_mm: observedMm,
    nominal_mm: nominalMm,
    residual_mm: value,
    absolute_residual_mm: Math.abs(value),
  }
}

function lengthObservation(measurement: MeasurementV2) {
  const under = getObservedMm(measurement, 'L_underhead')
  if (under !== null) return { dimension: 'L_underhead' as const, value_mm: under }
  const overall = getObservedMm(measurement, 'L_overall')
  if (overall !== null) return { dimension: 'L_overall' as const, value_mm: overall }
  return null
}

function unique(values: number[]) {
  return [...new Set(values.map(value => Number(value.toFixed(9))))].sort((a,b) => a-b)
}

function metricLengthHypotheses(observedMm: number) {
  const step = 5
  const base = Math.round(observedMm / step) * step
  return unique([Math.max(step,base-step),Math.max(step,base),base+step]).map(nominal => ({
    nominal_mm: nominal,
    residual_mm: observedMm - nominal,
    label: `${nominal} mm`,
  }))
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a,b] = [b,a%b]
  return Math.abs(a) || 1
}

function inchLabel(numerator: number, denominator: number) {
  const g = gcd(numerator,denominator)
  const n = numerator/g, d = denominator/g
  const whole = Math.floor(n/d), rem = n%d
  if (rem === 0) return `${whole} in`
  return whole > 0 ? `${whole} ${rem}/${d} in` : `${rem}/${d} in`
}

function unifiedLengthHypotheses(observedMm: number) {
  const denominator = 64
  const rounded = Math.round(observedMm / MM_PER_INCH * denominator)
  return unique([Math.max(1,rounded-1),Math.max(1,rounded),rounded+1]).map(numerator => {
    const nominal = numerator / denominator * MM_PER_INCH
    return { nominal_mm: nominal, residual_mm: observedMm - nominal, label: inchLabel(numerator,denominator) }
  })
}

function candidateFromRecord(catalogue: StandardsCatalogue, record: ThreadStandardRecord, measurement: MeasurementV2): NominalCandidate {
  const d = residual(getObservedMm(measurement,'D'), record.nominal_diameter_mm)
  const p = residual(getObservedMm(measurement,'P'), record.nominal_pitch_mm)
  const distance = d && p ? Math.sqrt(d.residual_mm ** 2 + p.residual_mm ** 2) : null
  const l = lengthObservation(measurement)
  const hypotheses = l
    ? record.standard_system === 'iso_metric'
      ? metricLengthHypotheses(l.value_mm)
      : unifiedLengthHypotheses(l.value_mm)
    : []
  const nearestLength = hypotheses.slice().sort((a,b) => Math.abs(a.residual_mm)-Math.abs(b.residual_mm))[0]

  const candidate: NominalCandidate = {
    candidate_id: `${catalogue.snapshot.snapshot_id}:${record.record_id}`,
    standard_system: record.standard_system,
    family: record.family,
    designation: record.designation,
    nominal: {
      diameter_mm: record.nominal_diameter_mm,
      pitch_mm: record.nominal_pitch_mm,
      tpi: record.tpi,
      length_mm: null,
      length_convention: record.length_convention,
    },
    standard_ref: {
      catalogue_id: catalogue.catalogue_id,
      catalogue_version: catalogue.catalogue_version,
      snapshot_id: catalogue.snapshot.snapshot_id,
      record_id: record.record_id,
      provenance: record.source_ids.join(','),
    },
    residuals: {
      ...(d ? { D: d } : {}),
      ...(p ? { P: p } : {}),
      ...(l && nearestLength ? {
        [l.dimension]: {
          observed_mm: l.value_mm,
          nominal_mm: nearestLength.nominal_mm,
          residual_mm: nearestLength.residual_mm,
          absolute_residual_mm: Math.abs(nearestLength.residual_mm),
        },
      } : {}),
    },
    length_comparison: {
      observed_dimension: l?.dimension ?? null,
      observed_mm: l?.value_mm ?? null,
      product_standard_length_validation: 'not_implemented_phase1',
      hypotheses,
    },
    score: {
      model_id: 'phase1-euclidean-dp-residual-v1',
      status: 'provisional_uncalibrated_no_covariance',
      residual_distance_mm: distance,
      measurement_log_likelihood: null,
      rank: null,
    },
  }
  candidate.physical_evidence = evaluateCandidatePhysicalEvidence(measurement,candidate)
  return candidate
}

/**
 * Enumerate BOTH loaded systems before ranking. There is no metric/imperial
 * preclassification and no threshold that can erase a rival system.
 */
export function enumerateShadowCandidates(measurement: MeasurementV2, catalogue: StandardsCatalogue): NominalCandidateSet {
  if (measurement.schema_version !== MEASUREMENT_V2_SCHEMA) throw new Error('unsupported_measurement_schema')
  const validation = validateStandardsCatalogue(catalogue)
  if (!validation.valid) throw new Error(`invalid_standards_catalogue:${validation.errors.join('|')}`)

  const candidates = catalogue.records
    .map(record => candidateFromRecord(catalogue,record,measurement))
    .sort((a,b) => {
      const av = a.score.residual_distance_mm ?? Number.POSITIVE_INFINITY
      const bv = b.score.residual_distance_mm ?? Number.POSITIVE_INFINITY
      return av !== bv ? av-bv : a.candidate_id.localeCompare(b.candidate_id)
    })
    .map((candidate,index) => ({...candidate,score:{...candidate.score,rank:index+1}}))

  return {
    schema_version: NOMINAL_CANDIDATE_SCHEMA,
    measurement_schema_version: MEASUREMENT_V2_SCHEMA,
    standards_snapshot: {
      snapshot_id: catalogue.snapshot.snapshot_id,
      snapshot_version: catalogue.snapshot.snapshot_version,
      coverage_status: catalogue.snapshot.coverage_status,
    },
    candidates,
    decision: {
      selected_candidate_id: null,
      status: candidates.length ? 'shadow_unresolved' : 'no_normative_match',
      purchase_ready: false,
    },
  }
}

function counts(candidates: NominalCandidate[]): Record<StandardSystem,number> {
  return {
    iso_metric: candidates.filter(c => c.standard_system === 'iso_metric').length,
    unified_inch: candidates.filter(c => c.standard_system === 'unified_inch').length,
  }
}


export interface StandardsAuthorityResult {
  mode: 'standards_authority'
  contract_version: 'hcsi.standards-authority.v1'
  measurement_v2: MeasurementV2
  standards_snapshot: NonNullable<NominalCandidateSet['standards_snapshot']>
  formal_candidates: NominalCandidate[]
  decision: {
    selected_candidate_id: string | null
    status: 'unresolved' | 'selected' | 'no_normative_match'
    purchase_ready: boolean
    reason: 'deterministic_selection_not_implemented'
  }
  legacy_diagnostics: {
    llm_nominal: { value: string | null; authority: 'non_authoritative'; use: 'diagnostic_only' }
    dimension_candidate: { value: string | null; authority: 'non_authoritative'; use: 'diagnostic_only' }
  }
  candidate_summary: {
    total: number
    iso_metric: number
    unified_inch: number
    nearest_by_provisional_residual_candidate_id: string | null
  }
  scoring_state: StandardsShadowResult['scoring_state']
}

/**
 * Formal nominal source of truth. Candidate membership is defined exclusively
 * by the versioned catalogue. Ranking remains diagnostic: Phase 1 has no
 * calibrated evidence model and therefore cannot select a winner.
 */
export function buildStandardsAuthorityResult(
  measurement: MeasurementV2,
  catalogue: StandardsCatalogue,
  diagnostics: { llmNominal?: string | null; dimensionCandidate?: string | null } = {},
): StandardsAuthorityResult {
  const set = enumerateShadowCandidates(measurement,catalogue)
  const c = counts(set.candidates)
  return {
    mode:'standards_authority',
    contract_version:'hcsi.standards-authority.v1',
    measurement_v2:measurement,
    standards_snapshot:set.standards_snapshot!,
    formal_candidates:set.candidates,
    decision:{
      selected_candidate_id:null,
      status:set.candidates.length ? 'unresolved' : 'no_normative_match',
      purchase_ready:false,
      reason:'deterministic_selection_not_implemented',
    },
    legacy_diagnostics:{
      llm_nominal:{
        value:diagnostics.llmNominal ?? null,
        authority:'non_authoritative',
        use:'diagnostic_only',
      },
      dimension_candidate:{
        value:diagnostics.dimensionCandidate ?? null,
        authority:'non_authoritative',
        use:'diagnostic_only',
      },
    },
    candidate_summary:{
      total:set.candidates.length,
      iso_metric:c.iso_metric,
      unified_inch:c.unified_inch,
      nearest_by_provisional_residual_candidate_id:set.candidates[0]?.candidate_id ?? null,
    },
    scoring_state:{
      model_id:'phase1-euclidean-dp-residual-v1',
      calibrated_probability_available:false,
      covariance_available:measurement.uncertainty.covariance.status !== 'not_estimated',
      tolerance_likelihood_available:false,
      todo:'Phase 2A physical_evidence is measurement compatibility, not posterior probability. Tolerance remains unavailable until class-specific limits are versioned.',
    },
  }
}

export function buildStandardsShadowResult(
  measurement: MeasurementV2,
  catalogue: StandardsCatalogue,
  legacyNominal: string | null,
): StandardsShadowResult {
  const set = enumerateShadowCandidates(measurement,catalogue)
  const c = counts(set.candidates)
  const reasons: string[] = []
  if (legacyNominal && !findCatalogueDesignation(catalogue,legacyNominal)) reasons.push('legacy_nominal_not_in_loaded_catalogue')
  if (c.iso_metric > 0 && c.unified_inch > 0) reasons.push('cross_system_candidates_retained')
  reasons.push('raw_measurement_preserved_not_nominally_snapped')
  reasons.push('product_standard_length_validity_not_implemented')

  return {
    mode:'shadow',
    contract_version:'hcsi.standards-shadow.v1',
    measurement_v2:measurement,
    standards_snapshot:set.standards_snapshot!,
    legacy_nominal:legacyNominal,
    new_candidates:set.candidates,
    candidate_summary:{
      total:set.candidates.length,
      iso_metric:c.iso_metric,
      unified_inch:c.unified_inch,
      top_candidate_id:set.candidates[0]?.candidate_id ?? null,
    },
    disagreement_reason:reasons,
    purchase_ready:false,
    purchase_ready_reason:'shadow_mode_not_authoritative',
    scoring_state:{
      model_id:'phase1-euclidean-dp-residual-v1',
      calibrated_probability_available:false,
      covariance_available:false,
      tolerance_likelihood_available:false,
      todo:'Add covariance, systematic-bias ledger and standards tolerance likelihood before interpreting scores probabilistically.',
    },
  }
}
