import type { CandidateBlindSemanticRequest } from './candidate-blind-semantic-request'
import {
  SEMANTIC_EVIDENCE_SCHEMA,
  SEMANTIC_EXTRACTOR_VERSION,
  SEMANTIC_PROMPT_VERSION,
  type RawSemanticSensorOutput,
  type SemanticEvidenceSource,
  type SemanticEvidenceV1,
  type SemanticObservation,
} from './semantic-evidence-v1'
import {
  SEMANTIC_FEATURE_DEFINITIONS,
  SEMANTIC_FEATURE_IDS,
  SEMANTIC_TAXONOMY_VERSION,
  isNotVisibleTaxonomyValue,
  isSemanticFeatureId,
  isSemanticTaxonomyValue,
} from './semantic-taxonomy-v1'
import {
  SEMANTIC_REASON_CODE_TAXONOMY_VERSION,
  isSemanticObservationReasonCode,
  isSensorEmittableSemanticObservationReasonCode,
  isSemanticQualityReasonCode,
  type SemanticObservationReasonCode,
} from './semantic-reason-codes-v1'

const FORBIDDEN_NON_OCR_INTERPRETATION_PATTERNS = [
  /\bM\s*\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?\b/i,
  /#\s*\d+\s*-\s*\d+/i,
  /\b\d+\s*\/\s*\d+\s*-\s*\d+(?:\s*(?:UNC|UNF|UNEF))?\b/i,
  /\b(?:UNC|UNF|UNEF)\b/i,
  /\bmetric(?:[-\s]?like|\s+thread)?\b/i,
  /\bimperial(?:[-\s]?like|\s+thread)?\b/i,
  /\bunified(?:[-\s]?like|\s+thread)?\b/i,
  /\b(?:inch|inch-based)\s+thread\b/i,
  /\bISO(?:\s+thread|\s+fastener)?\b/i,
  /\bASME\b/i,
  /\b(?:candidate|winner|ranking|ranked|rank\s*\d+|top\s+candidate|best\s+match)\b/i,
  /\b\d+(?:\.\d+)?\s*(?:mm|cm|millimet(?:er|re)s?|inch(?:es)?|in\b|TPI)\b/i,
  /\d+(?:\.\d+)?\s*[″"]/,
]

const OCR_INTERPRETATION_PATTERNS = [
  /\b(?:probably|likely|maybe|apparently|presumably)\b/i,
  /\b(?:looks?|appears?|seems?)\s+(?:like|to\s+be)\b/i,
  /\b(?:candidate|winner|ranking|ranked|rank\s*\d+|top\s+candidate|best\s+match)\b/i,
  /\b(?:metric|imperial|unified|inch)\s+thread\b/i,
  /\b(?:ISO|ASME)\s+(?:thread|fastener|standard)\b/i,
  /\b(?:likely|probably)\s+(?:UNC|UNF|UNEF|ISO|ASME|metric|imperial|unified)\b/i,
]

const OCR_LITERAL_CHARS = /^[\p{L}\p{N}\s._+\-/#×:*()]+$/u

export function containsForbiddenSemanticClaim(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  return FORBIDDEN_NON_OCR_INTERPRETATION_PATTERNS.some(pattern => pattern.test(value))
}

export function normalizeLiteralOcrText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g,' ')
}

export function isSafeLiteralOcrTranscription(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const normalized=normalizeLiteralOcrText(value)
  if (!normalized || normalized.length > 64 || /[\r\n]/.test(value)) return false
  if (!OCR_LITERAL_CHARS.test(normalized)) return false
  return !OCR_INTERPRETATION_PATTERNS.some(pattern => pattern.test(normalized))
}

function numberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function observationErrors(value: unknown, rawSensor = false): string[] {
  const errors:string[]=[]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['observation_not_object']
  const v=value as Record<string,unknown>
  if (!isSemanticFeatureId(v.feature_id)) return ['feature_id_invalid']
  const featureId=v.feature_id
  if (!isSemanticTaxonomyValue(featureId,v.value)) errors.push('taxonomy_value_invalid')
  const states=new Set(['observed','not_observed','ambiguous','not_visible','unknown','open_set'])
  const visibility=new Set(['visible','partially_visible','not_visible','unknown'])
  if (!states.has(String(v.state))) errors.push('state_invalid')
  if (!visibility.has(String(v.visibility))) errors.push('visibility_invalid')
  if (!numberOrNull(v.raw_score) || (typeof v.raw_score === 'number' && (v.raw_score < 0 || v.raw_score > 1))) errors.push('raw_score_invalid')
  if (!numberOrNull(v.calibrated_probability) ||
      (typeof v.calibrated_probability === 'number' && (v.calibrated_probability < 0 || v.calibrated_probability > 1))) {
    errors.push('calibrated_probability_invalid')
  }
  if (!['uncalibrated','calibrated'].includes(String(v.calibration_status))) errors.push('calibration_status_invalid')
  if (v.calibration_status === 'uncalibrated' && v.calibrated_probability !== null) errors.push('uncalibrated_probability_must_be_null')

  if (!Array.isArray(v.reason_codes) || !v.reason_codes.every(rawSensor ? isSensorEmittableSemanticObservationReasonCode : isSemanticObservationReasonCode)) {
    errors.push('reason_codes_invalid_or_unrecognized')
  }

  if (!(v.freeform_description === null || typeof v.freeform_description === 'string')) {
    errors.push('freeform_description_invalid')
  }
  if (v.freeform_description !== null && v.state !== 'open_set') {
    errors.push('freeform_only_allowed_for_open_set')
  }
  if (containsForbiddenSemanticClaim(v.freeform_description)) {
    errors.push('freeform_description_contains_forbidden_inference')
  }

  if (!numberOrNull(v.character_confidence) ||
      (typeof v.character_confidence === 'number' && (v.character_confidence < 0 || v.character_confidence > 1))) {
    errors.push('character_confidence_invalid')
  }

  if (featureId === 'markings.ocr') {
    if (!(v.raw_text === null || typeof v.raw_text === 'string')) errors.push('raw_text_invalid')
    if (!(v.normalized_text === null || typeof v.normalized_text === 'string')) errors.push('normalized_text_invalid')
    if (typeof v.raw_text === 'string') {
      if (!isSafeLiteralOcrTranscription(v.raw_text)) errors.push('raw_text_not_literal_transcription')
      const expected=normalizeLiteralOcrText(v.raw_text)
      if (v.normalized_text !== expected) errors.push('normalized_text_not_deterministic_normalization')
    } else {
      if (v.normalized_text !== null) errors.push('normalized_text_requires_raw_text')
      if (v.character_confidence !== null) errors.push('character_confidence_requires_raw_text')
    }
    if (v.value === 'text_detected') {
      if (typeof v.raw_text !== 'string' || !v.raw_text.trim()) errors.push('text_detected_requires_literal_raw_text')
      if (v.state !== 'observed') errors.push('text_detected_requires_observed_state')
      if (!['visible','partially_visible'].includes(String(v.visibility))) errors.push('text_detected_requires_visible_region')
    } else if (v.raw_text !== null) {
      errors.push('raw_text_requires_text_detected_value')
    }
  } else if (v.raw_text !== null || v.normalized_text !== null || v.character_confidence !== null) {
    errors.push('ocr_fields_only_allowed_for_markings_ocr')
  }

  if (v.state === 'not_visible') {
    if (v.visibility !== 'not_visible') errors.push('not_visible_state_requires_not_visible_visibility')
    if (typeof v.value === 'string' && !isNotVisibleTaxonomyValue(featureId,v.value)) {
      errors.push('not_visible_state_requires_not_visible_value')
    }
  }
  if (v.visibility === 'not_visible' && v.state !== 'not_visible') errors.push('not_visible_visibility_requires_not_visible_state')
  if (typeof v.value === 'string' && isNotVisibleTaxonomyValue(featureId,v.value) && v.state !== 'not_visible') {
    errors.push('not_visible_value_requires_not_visible_state')
  }
  if (v.state === 'open_set' && v.value !== 'open_set') errors.push('open_set_state_requires_open_set_value')
  if (v.value === 'open_set' && v.state !== 'open_set') errors.push('open_set_value_requires_open_set_state')
  if (v.state === 'open_set' && (typeof v.freeform_description !== 'string' || !v.freeform_description.trim())) {
    errors.push('open_set_requires_freeform_description')
  }
  if (v.state === 'unknown' && v.value !== 'unknown') errors.push('unknown_state_requires_unknown_value')
  if (v.state === 'not_observed' && v.visibility === 'not_visible') errors.push('not_observed_is_not_not_visible')
  return errors
}

export function validateSemanticObservationV1(value: unknown, rawSensor = false): {valid:boolean;errors:string[]} {
  const errors=observationErrors(value,rawSensor)
  return {valid:errors.length===0,errors}
}

export function sanitizeRawSemanticSensorOutput(raw: RawSemanticSensorOutput): RawSemanticSensorOutput {
  return {
    ...raw,
    observations:raw.observations.map(observation => {
      const reasonCodes=[...(observation.reason_codes ?? [])] as SemanticObservationReasonCode[]
      const next={...observation}

      if (containsForbiddenSemanticClaim(next.freeform_description)) {
        next.freeform_description=null
        reasonCodes.push('FORBIDDEN_CLAIM_REMOVED')
      }

      if (next.feature_id === 'markings.ocr') {
        if (typeof next.raw_text === 'string' && isSafeLiteralOcrTranscription(next.raw_text)) {
          next.raw_text=next.raw_text.trim()
          next.normalized_text=normalizeLiteralOcrText(next.raw_text)
        } else if (next.raw_text !== null) {
          next.raw_text=null
          next.normalized_text=null
          next.character_confidence=null
          next.value='unknown'
          next.state='unknown'
          reasonCodes.push('FORBIDDEN_CLAIM_REMOVED')
        } else {
          next.normalized_text=null
          next.character_confidence=null
        }
      } else {
        next.raw_text=null
        next.normalized_text=null
        next.character_confidence=null
      }

      if (next.calibration_status === 'uncalibrated' && next.calibrated_probability !== null) {
        next.calibrated_probability=null
        reasonCodes.push('UNCALIBRATED_PROBABILITY_REMOVED')
      }
      return {...next,reason_codes:[...new Set(reasonCodes)]}
    }),
  }
}

export function validateRawSemanticSensorOutput(value: unknown): {valid:boolean;errors:string[]} {
  const errors:string[]=[]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {valid:false,errors:['sensor_output_not_object']}
  const v=value as Record<string,unknown>
  if (!Array.isArray(v.observations)) errors.push('observations_missing')
  else {
    if (v.observations.length !== SEMANTIC_FEATURE_IDS.length) errors.push('observation_count_invalid')
    const ids:string[]=[]
    for (const [index,observation] of v.observations.entries()) {
      const itemErrors=observationErrors(observation,true)
      errors.push(...itemErrors.map(error => `observation_${index}:${error}`))
      if (observation && typeof observation === 'object' && !Array.isArray(observation) &&
          typeof (observation as Record<string,unknown>).feature_id === 'string') {
        ids.push((observation as Record<string,unknown>).feature_id as string)
      }
    }
    if (new Set(ids).size !== ids.length) errors.push('feature_id_duplicate')
    for (const required of SEMANTIC_FEATURE_IDS) if (!ids.includes(required)) errors.push(`feature_missing:${required}`)
  }
  const quality=v.quality
  if (!quality || typeof quality !== 'object' || Array.isArray(quality)) errors.push('quality_invalid')
  else {
    const q=quality as Record<string,unknown>
    if (!['usable','limited','insufficient'].includes(String(q.status))) errors.push('quality_status_invalid')
    if (!Array.isArray(q.reason_codes) || !q.reason_codes.every(isSemanticQualityReasonCode)) {
      errors.push('quality_reason_codes_invalid_or_unrecognized')
    }
  }
  return {valid:errors.length===0,errors}
}

function validatePostprocessedSemanticSensorOutput(value: unknown): {valid:boolean;errors:string[]} {
  const errors:string[]=[]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {valid:false,errors:['sensor_output_not_object']}
  const v=value as Record<string,unknown>
  if (!Array.isArray(v.observations)) errors.push('observations_missing')
  else for (const [index,observation] of v.observations.entries()) {
    errors.push(...observationErrors(observation,false).map(error => `observation_${index}:${error}`))
  }
  const quality=v.quality
  if (!quality || typeof quality !== 'object' || Array.isArray(quality)) errors.push('quality_invalid')
  else {
    const q=quality as Record<string,unknown>
    if (!['usable','limited','insufficient'].includes(String(q.status))) errors.push('quality_status_invalid')
    if (!Array.isArray(q.reason_codes) || !q.reason_codes.every(isSemanticQualityReasonCode)) errors.push('quality_reason_codes_invalid_or_unrecognized')
  }
  return {valid:errors.length===0,errors}
}

export function buildSemanticEvidenceV1(
  rawInput: RawSemanticSensorOutput,
  request: CandidateBlindSemanticRequest,
  provenance: {model:string;model_version:string;sensor_type?:SemanticEvidenceSource['sensor_type']},
): SemanticEvidenceV1 {
  const raw=sanitizeRawSemanticSensorOutput(rawInput)
  const rawValidation=validatePostprocessedSemanticSensorOutput(raw)
  if (!rawValidation.valid) throw new Error(`invalid_semantic_sensor_output:${rawValidation.errors.join('|')}`)
  const sourceRef='semantic_first_pass_sensor_1'
  const cropRef=request.semantic_roi.crop_ref
  const groupId=cropRef
  const observations:SemanticObservation[]=raw.observations.map(observation => ({
    ...observation,
    feature_family:SEMANTIC_FEATURE_DEFINITIONS[observation.feature_id].family,
    source:sourceRef,
    evidence_refs:[cropRef],
    independence_group:groupId,
  }))
  const evidence:SemanticEvidenceV1={
    schema_version:SEMANTIC_EVIDENCE_SCHEMA,
    taxonomy_version:SEMANTIC_TAXONOMY_VERSION,
    reason_code_taxonomy_version:SEMANTIC_REASON_CODE_TAXONOMY_VERSION,
    extractor_version:SEMANTIC_EXTRACTOR_VERSION,
    observation_scope:{
      mode:'candidate_blind_first_pass',
      image_sha256:request.image.image_sha256,
      target_region_ref:cropRef,
      physical_measurements_included:false,
      standards_candidates_included:false,
      legacy_nominal_included:false,
      ground_truth_included:false,
    },
    observations,
    unknown_or_open_set:observations
      .filter(item => item.state === 'unknown' || item.state === 'open_set')
      .map(item => item.feature_id),
    evidence_sources:[{
      evidence_ref:sourceRef,
      sensor_type:provenance.sensor_type ?? 'vlm',
      model:provenance.model,
      model_version:provenance.model_version,
      prompt_version:SEMANTIC_PROMPT_VERSION,
      crop_ref:cropRef,
      image_sha256:request.image.image_sha256,
    }],
    independence_groups:[{
      group_id:groupId,
      crop_ref:cropRef,
      image_sha256:request.image.image_sha256,
      description:cropRef === 'target_region_1'
        ? 'All observations in this first pass read the same target ROI and are therefore not independent evidence.'
        : 'All observations in this first pass read the same full image and are therefore not independent evidence.',
    }],
    quality:raw.quality,
  }
  const validation=validateSemanticEvidenceV1(evidence)
  if (!validation.valid) throw new Error(`invalid_semantic_evidence_v1:${validation.errors.join('|')}`)
  return evidence
}

export function validateSemanticEvidenceV1(value: unknown): {valid:boolean;errors:string[]} {
  const errors:string[]=[]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {valid:false,errors:['semantic_evidence_not_object']}
  const v=value as Record<string,any>
  if (v.schema_version !== SEMANTIC_EVIDENCE_SCHEMA) errors.push('schema_version_invalid')
  if (v.taxonomy_version !== SEMANTIC_TAXONOMY_VERSION) errors.push('taxonomy_version_invalid')
  if (v.reason_code_taxonomy_version !== SEMANTIC_REASON_CODE_TAXONOMY_VERSION) errors.push('reason_code_taxonomy_version_invalid')
  if (v.extractor_version !== SEMANTIC_EXTRACTOR_VERSION) errors.push('extractor_version_invalid')
  const scope=v.observation_scope
  if (!scope || scope.mode !== 'candidate_blind_first_pass') errors.push('observation_scope_invalid')
  else {
    if (scope.physical_measurements_included !== false) errors.push('physical_measurements_must_not_be_included')
    if (scope.standards_candidates_included !== false) errors.push('standards_candidates_must_not_be_included')
    if (scope.legacy_nominal_included !== false) errors.push('legacy_nominal_must_not_be_included')
    if (scope.ground_truth_included !== false) errors.push('ground_truth_must_not_be_included')
    if (typeof scope.image_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(scope.image_sha256)) errors.push('image_sha256_invalid')
  }
  if (!Array.isArray(v.observations) || v.observations.length < SEMANTIC_FEATURE_IDS.length) {
    errors.push('observations_invalid')
  } else {
    const ids:string[]=[]
    for (const [index,observation] of v.observations.entries()) {
      const baseErrors=observationErrors(observation)
      errors.push(...baseErrors.map(error => `observation_${index}:${error}`))
      if (!observation || typeof observation !== 'object') continue
      const id=observation.feature_id
      if (isSemanticFeatureId(id)) {
        ids.push(id)
        if (observation.feature_family !== SEMANTIC_FEATURE_DEFINITIONS[id].family) errors.push(`observation_${index}:feature_family_mismatch`)
      }
      if (typeof observation.source !== 'string') errors.push(`observation_${index}:source_missing`)
      if (!Array.isArray(observation.evidence_refs) || !observation.evidence_refs.length ||
          !observation.evidence_refs.every((x:unknown)=>typeof x === 'string')) errors.push(`observation_${index}:evidence_refs_invalid`)
      if (typeof observation.independence_group !== 'string') errors.push(`observation_${index}:independence_group_missing`)
    }
    for (const required of SEMANTIC_FEATURE_IDS) if (!ids.includes(required)) errors.push(`feature_missing:${required}`)
  }
  if (!Array.isArray(v.evidence_sources) || !v.evidence_sources.length) errors.push('evidence_sources_missing')
  if (!Array.isArray(v.independence_groups) || !v.independence_groups.length) errors.push('independence_groups_missing')
  const sourceRefs=new Set((v.evidence_sources ?? []).map((x:any)=>x?.evidence_ref).filter((x:unknown)=>typeof x === 'string'))
  const groupIds=new Set((v.independence_groups ?? []).map((x:any)=>x?.group_id).filter((x:unknown)=>typeof x === 'string'))
  const cropRefs=new Set((v.independence_groups ?? []).map((x:any)=>x?.crop_ref).filter((x:unknown)=>typeof x === 'string'))
  for (const [index,observation] of (v.observations ?? []).entries()) {
    if (!sourceRefs.has(observation.source)) errors.push(`observation_${index}:source_not_registered`)
    if (!groupIds.has(observation.independence_group)) errors.push(`observation_${index}:independence_group_not_registered`)
    if (Array.isArray(observation.evidence_refs) && observation.evidence_refs.some((ref:string)=>!cropRefs.has(ref))) {
      errors.push(`observation_${index}:evidence_ref_not_registered`)
    }
  }
  for (const source of v.evidence_sources ?? []) {
    if (!['vlm','deterministic_classifier','ocr','geometry_semantic_bridge'].includes(source?.sensor_type)) errors.push('sensor_type_invalid')
    if (typeof source?.model !== 'string' || typeof source?.model_version !== 'string' ||
        typeof source?.prompt_version !== 'string' || typeof source?.crop_ref !== 'string') errors.push('source_provenance_incomplete')
    if (scope?.image_sha256 && source?.image_sha256 !== scope.image_sha256) errors.push('source_image_sha_mismatch')
  }
  for (const group of v.independence_groups ?? []) {
    if (typeof group?.group_id !== 'string' || typeof group?.crop_ref !== 'string' ||
        typeof group?.description !== 'string') errors.push('independence_group_invalid')
    if (scope?.image_sha256 && group?.image_sha256 !== scope.image_sha256) errors.push('group_image_sha_mismatch')
  }
  const expectedUnknown=new Set((v.observations ?? [])
    .filter((x:any)=>x?.state === 'unknown' || x?.state === 'open_set')
    .map((x:any)=>x.feature_id))
  if (!Array.isArray(v.unknown_or_open_set) ||
      v.unknown_or_open_set.some((id:unknown)=>!isSemanticFeatureId(id)) ||
      v.unknown_or_open_set.some((id:string)=>!expectedUnknown.has(id)) ||
      [...expectedUnknown].some(id=>!v.unknown_or_open_set.includes(id))) errors.push('unknown_or_open_set_inconsistent')
  const quality=v.quality
  if (!quality || !['usable','limited','insufficient'].includes(quality.status) ||
      !Array.isArray(quality.reason_codes) || !quality.reason_codes.every(isSemanticQualityReasonCode)) {
    errors.push('quality_invalid')
  }
  return {valid:errors.length===0,errors}
}
