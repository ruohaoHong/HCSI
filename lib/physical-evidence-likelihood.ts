import type { MeasurementQuantity, MeasurementV2, NominalCandidate } from './measurement-v2'
import {
  assessCovarianceReadiness,
  assessJointBiasReadiness,
  type BiasReadinessAssessment,
  type CovarianceReadinessAssessment,
} from './measurement-uncertainty'
import { assessStandardsTolerance, type StandardsToleranceAssessment } from './standards-tolerance-model-v1'

export const PHYSICAL_EVIDENCE_MODEL = 'hcsi.physical-evidence-random-measurement.v1' as const

export type LocalMeasurementComponentStatus =
  | 'available_local_random_component'
  | 'uncertainty_unavailable'
  | 'measurement_unavailable'

export interface LocalMeasurementComponent {
  quantity: 'D' | 'P'
  observed_mm: number | null
  nominal_mm: number
  residual_mm: number | null
  random_standard_uncertainty_mm: number | null
  tolerance_status: StandardsToleranceAssessment['status']
  random_measurement_log_density: number | null
  status: LocalMeasurementComponentStatus
  interpretation: string
}

export type JointPhysicalEvidenceStatus =
  | 'available'
  | 'blocked_by_unresolved_systematic_bias'
  | 'blocked_by_unestimated_systematic_bias'
  | 'blocked_by_incomplete_covariance'
  | 'blocked_by_invalid_covariance'
  | 'blocked_by_missing_quantity_uncertainty'
  | 'unavailable'

export interface CandidatePhysicalEvidence {
  model_id: typeof PHYSICAL_EVIDENCE_MODEL
  semantics: 'random_measurement_nominal_proximity_not_standards_likelihood_or_posterior'
  D: LocalMeasurementComponent
  P: LocalMeasurementComponent
  tolerance: StandardsToleranceAssessment
  bias_readiness: BiasReadinessAssessment
  covariance_readiness: CovarianceReadinessAssessment
  systematic_bias_status: MeasurementV2['uncertainty']['systematic_bias_status']
  standards_likelihood: {
    available: false
    reason: 'tolerance_model_unavailable_or_not_integrated'
  }
  joint: {
    log_density: number | null
    status: JointPhysicalEvidenceStatus
    reason_codes: string[]
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

function gaussianLogDensity(residual: number, standardUncertainty: number): number {
  return -0.5 * Math.log(2 * Math.PI * standardUncertainty ** 2)
    - 0.5 * (residual / standardUncertainty) ** 2
}

function component(
  measurement: MeasurementV2,
  q: 'D' | 'P',
  nominal: number,
  tolerance: StandardsToleranceAssessment,
): LocalMeasurementComponent {
  const obs = observation(measurement,q)
  if (!obs) return {
    quantity:q, observed_mm:null, nominal_mm:nominal, residual_mm:null,
    random_standard_uncertainty_mm:null, tolerance_status:tolerance.status,
    random_measurement_log_density:null, status:'measurement_unavailable',
    interpretation:'No measurement exists for this quantity; no random-measurement density is computed.',
  }
  const s = sigma(measurement,q)
  const residual = obs.value_mm - nominal
  if (s === null) return {
    quantity:q, observed_mm:obs.value_mm, nominal_mm:nominal, residual_mm:residual,
    random_standard_uncertainty_mm:null, tolerance_status:tolerance.status,
    random_measurement_log_density:null, status:'uncertainty_unavailable',
    interpretation:'Residual is preserved, but no supported random standard uncertainty exists; no density is fabricated.',
  }
  return {
    quantity:q, observed_mm:obs.value_mm, nominal_mm:nominal, residual_mm:residual,
    random_standard_uncertainty_mm:s, tolerance_status:tolerance.status,
    random_measurement_log_density:gaussianLogDensity(residual,s),
    status:'available_local_random_component',
    interpretation:tolerance.status === 'available'
      ? 'Local random-measurement density around the catalogue nominal; standards tolerance remains a separate component.'
      : 'Local random-measurement nominal-proximity density only. It is not a standards-conformity likelihood, candidate probability, or posterior.',
  }
}

function gaussian2LogDensity(residualD: number, residualP: number, matrix: number[][]): number {
  if (matrix.length !== 2 || matrix.some(row => row.length !== 2)) throw new Error('joint_covariance_shape_invalid')
  const a = matrix[0][0], b = matrix[0][1], c = matrix[1][1]
  const det = a*c - b*b
  if (!(det > 0) || !Number.isFinite(det)) throw new Error('joint_covariance_not_positive_definite')
  const quadratic = (c*residualD*residualD - 2*b*residualD*residualP + a*residualP*residualP) / det
  return -Math.log(2*Math.PI) - 0.5*Math.log(det) - 0.5*quadratic
}

/**
 * Computes fail-closed random-measurement nominal-proximity evidence.
 * This layer is NOT a full standards likelihood and never computes a posterior.
 * Joint D/P density requires explicit safe bias readiness and complete covariance.
 */
export function evaluateCandidatePhysicalEvidence(
  measurement: MeasurementV2,
  candidate: NominalCandidate,
): CandidatePhysicalEvidence {
  const tolerance = assessStandardsTolerance(candidate)
  const D = component(measurement,'D',candidate.nominal.diameter_mm,tolerance)
  const P = component(measurement,'P',candidate.nominal.pitch_mm,tolerance)
  const biasReadiness = assessJointBiasReadiness(measurement.uncertainty,['D','P'])
  const covarianceReadiness = assessCovarianceReadiness(measurement.uncertainty,['D','P'])
  const missingQuantityUncertainty =
    D.random_measurement_log_density === null || P.random_measurement_log_density === null

  let status: JointPhysicalEvidenceStatus = 'unavailable'
  if (biasReadiness.status === 'blocked_unresolved_bias') {
    status = 'blocked_by_unresolved_systematic_bias'
  } else if (biasReadiness.status === 'blocked_unestimated_bias') {
    status = 'blocked_by_unestimated_systematic_bias'
  } else if (missingQuantityUncertainty) {
    status = 'blocked_by_missing_quantity_uncertainty'
  } else if (covarianceReadiness.status === 'invalid') {
    status = 'blocked_by_invalid_covariance'
  } else if (covarianceReadiness.status !== 'complete') {
    status = 'blocked_by_incomplete_covariance'
  } else {
    status = 'available'
  }

  const reasonCodes = [
    ...biasReadiness.reason_codes,
    ...covarianceReadiness.reason_codes,
    ...(missingQuantityUncertainty ? ['D_or_P_random_uncertainty_missing'] : []),
    ...(tolerance.status === 'unavailable'
      ? ['standards_tolerance_unavailable_full_standards_likelihood_not_computed']
      : []),
  ]

  let jointLogDensity: number | null = null
  if (status === 'available') {
    const matrix = covarianceReadiness.matrix_mm2
    if (!matrix || D.residual_mm === null || P.residual_mm === null) {
      throw new Error('joint_readiness_invariant_broken')
    }
    jointLogDensity = gaussian2LogDensity(D.residual_mm,P.residual_mm,matrix)
  }

  return {
    model_id:PHYSICAL_EVIDENCE_MODEL,
    semantics:'random_measurement_nominal_proximity_not_standards_likelihood_or_posterior',
    D,P,tolerance,
    bias_readiness:biasReadiness,
    covariance_readiness:covarianceReadiness,
    systematic_bias_status:measurement.uncertainty.systematic_bias_status,
    standards_likelihood:{
      available:false,
      reason:'tolerance_model_unavailable_or_not_integrated',
    },
    joint:{
      log_density:jointLogDensity,
      status,
      reason_codes:[...new Set(reasonCodes)],
      note:status === 'available'
        ? 'Multivariate Gaussian random-measurement nominal-proximity density using explicit complete D/P covariance. This is not a standards-conformity likelihood or posterior.'
        : 'Joint density is fail-closed. Unknown bias, missing random uncertainty, or incomplete/invalid covariance is never interpreted as safe or independent.',
    },
  }
}
