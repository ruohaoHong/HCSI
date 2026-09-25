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

export type FastenerLengthConvention = 'under_head_to_tip' | 'overall' | 'unresolved'

export interface MeasurementResolutionContext {
  category?: string
  head_style?: string
}

export interface ResolvedMeasurementPlan {
  minimum_sufficient_evidence: string
  length_convention: FastenerLengthConvention
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
export function resolveMeasurementPlan(
  plan: SemanticMeasurementPlan,
  context: MeasurementResolutionContext = {}
): ResolvedMeasurementPlan {
  const lengthConvention = resolveFastenerLengthConvention(context)
  const conventionAwareSteps = plan.steps.map((step) =>
    applyFastenerLengthConvention(step, context, lengthConvention)
  )
  const steps = conventionAwareSteps.map(resolveGeometryPlanStep)
  const executableSteps = steps.filter((step) => step.resolution !== 'unsupported_proposed')
  const unsupportedSteps = steps.filter((step) => step.resolution === 'unsupported_proposed')

  return {
    minimum_sufficient_evidence: plan.minimum_sufficient_evidence,
    length_convention: lengthConvention,
    steps,
    executable_steps: executableSteps,
    unsupported_steps: unsupportedSteps,
    proposed_concepts: dedupeProposedConcepts(plan.proposed_concepts),
    fully_supported: unsupportedSteps.length === 0,
  }
}


const PROTRUDING_HEAD_STYLES = new Set(['hex', 'pan', 'button', 'socket_cap', 'round'])

export function resolveFastenerLengthConvention(
  context: MeasurementResolutionContext
): FastenerLengthConvention {
  if (context.category !== 'fasteners') return 'unresolved'
  if (context.head_style === 'flat_countersunk') return 'overall'
  if (context.head_style && PROTRUDING_HEAD_STYLES.has(context.head_style)) return 'under_head_to_tip'
  return 'unresolved'
}

function applyFastenerLengthConvention(
  step: GeometryPlanStep,
  context: MeasurementResolutionContext,
  convention: FastenerLengthConvention
): GeometryPlanStep {
  if (context.category !== 'fasteners' || convention === 'unresolved') return step
  if (step.operation !== 'axial_distance' || !step.inputs.includes('object_tip')) return step

  const lengthAnchors = new Set(['width_transition', 'head_underface', 'head_top'])
  if (!step.inputs.some((input) => lengthAnchors.has(input))) return step

  const anchor = convention === 'overall' ? 'head_top' : 'head_underface'
  return {
    ...step,
    inputs: step.inputs.map((input) => (lengthAnchors.has(input) ? anchor : input)),
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
