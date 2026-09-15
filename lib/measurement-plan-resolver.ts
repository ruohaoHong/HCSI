import {
  type GeometryPlanStep,
  type ProposedGeometryConcept,
  type ResolvedGeometryPlanStep,
  resolveGeometryPlanStep,
} from './geometry-capabilities'

/**
 * Open-ended semantic plan produced by the LLM. `proposed_concepts` is not an
 * executable escape hatch: it is a place to preserve geometry concepts the
 * planner believes are necessary but the engine does not yet support.
 */
export interface SemanticMeasurementPlan {
  minimum_sufficient_evidence: string
  steps: GeometryPlanStep[]
  proposed_concepts: ProposedGeometryConcept[]
}

export interface ResolvedMeasurementPlan {
  minimum_sufficient_evidence: string
  steps: ResolvedGeometryPlanStep[]
  executable_steps: ResolvedGeometryPlanStep[]
  unsupported_steps: ResolvedGeometryPlanStep[]
  proposed_concepts: ProposedGeometryConcept[]
  fully_supported: boolean
}

/**
 * Capability boundary between the LLM planner and deterministic geometry.
 *
 * The planner may think beyond today's vocabulary. The resolver never guesses,
 * aliases, or silently substitutes unsupported terms. Only supported steps are
 * handed to the executor; unsupported ideas remain visible as proposals so real
 * demand can guide future engine capabilities.
 */
export function resolveMeasurementPlan(plan: SemanticMeasurementPlan): ResolvedMeasurementPlan {
  const steps = plan.steps.map(resolveGeometryPlanStep)
  const executableSteps = steps.filter((step) => step.resolution !== 'unsupported_proposed')
  const unsupportedSteps = steps.filter((step) => step.resolution === 'unsupported_proposed')

  return {
    minimum_sufficient_evidence: plan.minimum_sufficient_evidence,
    steps,
    executable_steps: executableSteps,
    unsupported_steps: unsupportedSteps,
    proposed_concepts: dedupeProposedConcepts(plan.proposed_concepts),
    fully_supported: unsupportedSteps.length === 0,
  }
}

function dedupeProposedConcepts(concepts: ProposedGeometryConcept[]): ProposedGeometryConcept[] {
  const seen = new Set<string>()
  return concepts.filter((concept) => {
    const key = `${concept.kind}:${concept.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
