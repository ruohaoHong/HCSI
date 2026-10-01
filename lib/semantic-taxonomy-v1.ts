export const SEMANTIC_TAXONOMY_VERSION = 'hcsi.semantic-taxonomy.v1' as const

export const SEMANTIC_OBSERVATION_STATES = [
  'observed','not_observed','ambiguous','not_visible','unknown','open_set',
] as const
export type SemanticObservationState = (typeof SEMANTIC_OBSERVATION_STATES)[number]

export const SEMANTIC_VISIBILITY_STATES = [
  'visible','partially_visible','not_visible','unknown',
] as const
export type SemanticVisibility = (typeof SEMANTIC_VISIBILITY_STATES)[number]

export const SEMANTIC_FEATURE_DEFINITIONS = {
  'head.profile': {
    family:'head_profile',
    values:['countersunk','partially_countersunk','protruding','low_profile','domed','flat_top','not_visible','unknown','open_set'],
    not_visible_values:['not_visible'],
  },
  'head.morphology': {
    family:'head_morphology',
    values:['pan_like','button_like','truss_like','socket_cap_like','hex_head_like','flat_countersunk_like','oval_countersunk_like','round_like','not_visible','unknown','open_set'],
    not_visible_values:['not_visible'],
  },
  'drive.form': {
    family:'drive_form',
    values:['phillips_like','pozidriv_like','slotted','hex_socket','torx_like','square_like','external_hex','combination','none_visible','not_visible','unknown','open_set'],
    not_visible_values:['not_visible'],
  },
  'flange_washer.feature': {
    family:'flange_washer',
    values:['integral_flange_present','integral_flange_absent','washer_present','washer_absent','ambiguous','not_visible','unknown','open_set'],
    not_visible_values:['not_visible'],
  },
  'tip.morphology': {
    family:'tip_morphology',
    values:['flat_end','chamfered','pointed','drill_point_like','dog_point_like','not_visible','unknown','open_set'],
    not_visible_values:['not_visible'],
  },
  'thread.extent': {
    family:'thread_extent',
    values:['fully_threaded_visible','partially_threaded_visible','thread_start_or_end_not_visible','ambiguous','not_visible','unknown','open_set'],
    not_visible_values:['not_visible'],
  },
  'thread.morphology': {
    family:'thread_morphology',
    values:['machine_thread_like','coarse_thread_like','fine_thread_like','self_tapping_like','forming_like','not_visible','unknown','open_set'],
    not_visible_values:['not_visible'],
  },
  'markings.presence': {
    family:'markings_ocr',
    values:['marking_present','marking_absent','marking_not_visible','ambiguous','unknown','open_set'],
    not_visible_values:['marking_not_visible'],
  },
  'markings.ocr': {
    family:'markings_ocr',
    values:['text_detected','no_text_detected','text_not_visible','ambiguous','unknown','open_set'],
    not_visible_values:['text_not_visible'],
  },
} as const

export type SemanticFeatureId = keyof typeof SEMANTIC_FEATURE_DEFINITIONS
export type SemanticFeatureFamily = (typeof SEMANTIC_FEATURE_DEFINITIONS)[SemanticFeatureId]['family']

export const SEMANTIC_FEATURE_IDS = Object.keys(SEMANTIC_FEATURE_DEFINITIONS) as SemanticFeatureId[]
export const SEMANTIC_FEATURE_FAMILIES = [...new Set(
  SEMANTIC_FEATURE_IDS.map(id => SEMANTIC_FEATURE_DEFINITIONS[id].family)
)] as SemanticFeatureFamily[]

export function semanticValuesFor(featureId: SemanticFeatureId): readonly string[] {
  return SEMANTIC_FEATURE_DEFINITIONS[featureId].values
}

export function isSemanticFeatureId(value: unknown): value is SemanticFeatureId {
  return typeof value === 'string' && value in SEMANTIC_FEATURE_DEFINITIONS
}

export function isSemanticTaxonomyValue(featureId: SemanticFeatureId, value: unknown): value is string {
  return typeof value === 'string' && semanticValuesFor(featureId).includes(value as never)
}

export function isNotVisibleTaxonomyValue(featureId: SemanticFeatureId, value: string): boolean {
  return SEMANTIC_FEATURE_DEFINITIONS[featureId].not_visible_values.includes(value as never)
}
