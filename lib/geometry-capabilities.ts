export const GEOMETRY_LANDMARKS = [
  'object_tip',
  'width_transition',
] as const

export const GEOMETRY_REGIONS = [
  'threaded_shank',
] as const

export const GEOMETRY_OPERATORS = [
  'axial_distance',
  'outer_width',
] as const

export const GEOMETRY_ANALYZERS = [
  'periodicity',
] as const

export type GeometryLandmark = (typeof GEOMETRY_LANDMARKS)[number]
export type GeometryRegion = (typeof GEOMETRY_REGIONS)[number]
export type GeometryOperator = (typeof GEOMETRY_OPERATORS)[number]
export type GeometryAnalyzer = (typeof GEOMETRY_ANALYZERS)[number]
export type GeometryVocabulary =
  | GeometryLandmark
  | GeometryRegion
  | GeometryOperator
  | GeometryAnalyzer

export type GeometryCapabilityKind = 'landmark' | 'region' | 'operator' | 'analyzer'

export interface GeometryCapability {
  name: GeometryVocabulary
  kind: GeometryCapabilityKind
  description: string
}

export const GEOMETRY_CAPABILITIES: readonly GeometryCapability[] = [
  {
    name: 'object_tip',
    kind: 'landmark',
    description: 'Locate a visible terminal point of the selected object along its principal axis.',
  },
  {
    name: 'width_transition',
    kind: 'landmark',
    description: 'Locate a stable transition where object width changes along its principal axis.',
  },
  {
    name: 'threaded_shank',
    kind: 'region',
    description: 'Identify the elongated threaded shaft region, excluding a wider head when separable.',
  },
  {
    name: 'axial_distance',
    kind: 'operator',
    description: 'Measure distance between two supported landmarks projected along the object principal axis.',
  },
  {
    name: 'outer_width',
    kind: 'operator',
    description: 'Measure the outer envelope width of a supported region perpendicular to its principal axis.',
  },
  {
    name: 'periodicity',
    kind: 'analyzer',
    description: 'Estimate repeated spatial spacing inside a supported region, such as visible thread repetition.',
  },
] as const

const CAPABILITY_NAMES = new Set<string>(GEOMETRY_CAPABILITIES.map((capability) => capability.name))

export interface ProposedGeometryConcept {
  name: string
  kind: GeometryCapabilityKind | 'unknown'
  purpose: string
  why_existing_capabilities_are_insufficient: string
}

export interface GeometryPlanStep {
  operation: string
  inputs: string[]
  purpose: string
}

export type GeometryPlanStepResolution = 'supported_directly' | 'supported_by_composition' | 'unsupported_proposed'

export interface ResolvedGeometryPlanStep extends GeometryPlanStep {
  resolution: GeometryPlanStepResolution
  unsupported_terms: string[]
}

/**
 * Resolve a semantic planner step against what the deterministic geometry engine
 * currently claims it can do. The planner is intentionally allowed to propose
 * new concepts; unsupported terms are surfaced instead of being silently mapped
 * to the nearest known capability.
 *
 * A step using one known capability directly is `supported_directly`. A known
 * operator/analyzer applied to one or more known landmark/region inputs is
 * `supported_by_composition`. Anything else is `unsupported_proposed`.
 */
export function resolveGeometryPlanStep(step: GeometryPlanStep): ResolvedGeometryPlanStep {
  const terms = [step.operation, ...step.inputs]
  const unsupportedTerms = [...new Set(terms.filter((term) => !CAPABILITY_NAMES.has(term)))]

  if (unsupportedTerms.length > 0) {
    return {
      ...step,
      resolution: 'unsupported_proposed',
      unsupported_terms: unsupportedTerms,
    }
  }

  return {
    ...step,
    resolution: step.inputs.length > 0 ? 'supported_by_composition' : 'supported_directly',
    unsupported_terms: [],
  }
}

export function geometryCapabilityPromptReference(): string {
  const grouped = GEOMETRY_CAPABILITIES.map(
    ({ name, kind, description }) => `- ${name} [${kind}]: ${description}`
  ).join('\n')

  return `目前 deterministic geometry engine 已知能力如下：\n${grouped}\n\n優先重用或組合上述固定詞彙。若判定規格所必需的幾何概念不存在，可以提出新的 concept；不要把新概念硬套成最接近的既有詞彙。只規劃足以排除規格歧義的最小必要物理證據，避免非必要量測。`
}
