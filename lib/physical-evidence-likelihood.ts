import type { MeasurementQuantity, MeasurementV2, NominalCandidate } from './measurement-v2'
import { assessStandardsTolerance, type StandardsToleranceAssessment } from './standards-tolerance-model-v1'

export const PHYSICAL_EVIDENCE_MODEL = 'hcsi.physical-evidence-likelihood.v1' as const

export interface LikelihoodComponent {
  quantity: 'D' | 'P'
  observed_mm: number | null
  nominal_mm: number
  residual_mm: number | null
  random_standard_uncertainty_mm: number | null
  tolerance_status: StandardsToleranceAssessment['status']
  log_likelihood: number | null
  status: 'available_random_only' | 'uncertainty_unavailable' | 'measurement_unavailable'
  interpretation: string
}

export interface CandidatePhysicalEvidence {
  model_id: typeof PHYSICAL_EVIDENCE_MODEL
  semantics: 'measurement_compatibility_not_posterior_probability'
  D: LikelihoodComponent
  P: LikelihoodComponent
  tolerance: StandardsToleranceAssessment
  systematic_bias_status: MeasurementV2['uncertainty']['systematic_bias_status']
  joint: {
    log_likelihood: number | null
    status: 'available' | 'partial_components_only' | 'blocked_by_systematic_bias' | 'unavailable'
    covariance_status: MeasurementV2['uncertainty']['covariance']['status']
    note: string
  }
}

function observation(measurement: MeasurementV2, q: MeasurementQuantity) {
  return measurement.observations.find(x => x.quantity === q) ?? null
}

function sigma(measurement: MeasurementV2, q: MeasurementQuantity): number | null {
  const item = measurement.uncertainty.quantities.find(x => x.quantity === q)
  return item && ['estimated','assumption_limited'].includes(item.status) && item.standard_uncertainty_mm !== null
    ? item.standard_uncertainty_mm
    : null
}

function gaussianLogLikelihood(residual: number, standardUncertainty: number): number {
  return -0.5 * Math.log(2 * Math.PI * standardUncertainty ** 2)
    - 0.5 * (residual / standardUncertainty) ** 2
}

function component(
  measurement: MeasurementV2,
  q: 'D' | 'P',
  nominal: number,
  tolerance: StandardsToleranceAssessment,
): LikelihoodComponent {
  const obs = observation(measurement,q)
  if (!obs) return {
    quantity:q, observed_mm:null, nominal_mm:nominal, residual_mm:null,
    random_standard_uncertainty_mm:null, tolerance_status:tolerance.status,
    log_likelihood:null, status:'measurement_unavailable',
    interpretation:'No measurement exists for this quantity.',
  }
  const s = sigma(measurement,q)
  const residual = obs.value_mm - nominal
  if (s === null) return {
    quantity:q, observed_mm:obs.value_mm, nominal_mm:nominal, residual_mm:residual,
    random_standard_uncertainty_mm:null, tolerance_status:tolerance.status,
    log_likelihood:null, status:'uncertainty_unavailable',
    interpretation:'Residual is preserved, but no supported random standard uncertainty exists; no likelihood is fabricated.',
  }
  return {
    quantity:q, observed_mm:obs.value_mm, nominal_mm:nominal, residual_mm:residual,
    random_standard_uncertainty_mm:s, tolerance_status:tolerance.status,
    log_likelihood:gaussianLogLikelihood(residual,s),
    status:'available_random_only',
    interpretation:tolerance.status === 'available'
      ? 'Random measurement likelihood component; standards tolerance is separately represented.'
      : 'Local random measurement-component likelihood only; total propagated uncertainty and standards tolerance are not silently approximated.',
  }
}

/**
 * Computes only mathematically supported measurement components. It never
 * converts this score into P(candidate correct), and never removes candidates.
 */
export function evaluateCandidatePhysicalEvidence(
  measurement: MeasurementV2,
  candidate: NominalCandidate,
): CandidatePhysicalEvidence {
  const tolerance = assessStandardsTolerance(candidate)
  const D = component(measurement,'D',candidate.nominal.diameter_mm,tolerance)
  const P = component(measurement,'P',candidate.nominal.pitch_mm,tolerance)
  const available = [D,P].filter(x => x.log_likelihood !== null)
  const unresolvedBias = measurement.uncertainty.systematic_bias_status === 'unresolved'
  const both = available.length === 2
  return {
    model_id:PHYSICAL_EVIDENCE_MODEL,
    semantics:'measurement_compatibility_not_posterior_probability',
    D,P,tolerance,
    systematic_bias_status:measurement.uncertainty.systematic_bias_status,
    joint:{
      log_likelihood: both && !unresolvedBias
        ? (D.log_likelihood as number) + (P.log_likelihood as number)
        : null,
      status:unresolvedBias
        ? 'blocked_by_systematic_bias'
        : both
          ? 'available'
          : available.length > 0
            ? 'partial_components_only'
            : 'unavailable',
      covariance_status:measurement.uncertainty.covariance.status,
      note:unresolvedBias
        ? 'Joint likelihood is withheld because unresolved systematic bias is not zero-mean random noise.'
        : both
          ? 'Independent-component sum is used only when both supported uncertainties exist; off-diagonal covariance is not fabricated.'
          : 'One or more D/P uncertainty components are unavailable; joint likelihood is withheld.',
    },
  }
}
