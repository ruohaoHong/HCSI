import { createHash } from 'node:crypto'

export const CANDIDATE_BLIND_SEMANTIC_REQUEST_SCHEMA = 'hcsi.candidate-blind-semantic-request.v1' as const

export interface CandidateBlindSemanticRegion {
  present: boolean
  x_min: number
  y_min: number
  x_max: number
  y_max: number
}

export interface CandidateBlindSemanticRequest {
  schema_version: typeof CANDIDATE_BLIND_SEMANTIC_REQUEST_SCHEMA
  image: {
    base64: string
    mime_type: 'image/jpeg'
    image_sha256: string
  }
  semantic_roi: {
    crop_ref: 'target_region_1'
    target_region: CandidateBlindSemanticRegion | null
  }
  visibility_context: {
    source: 'original_image'
    target_region_supplied: boolean
    note: 'spatial_context_only_no_physical_measurements'
  }
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000
}

function allowlistedRegion(value: unknown): CandidateBlindSemanticRegion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v=value as Record<string,unknown>
  if (typeof v.present !== 'boolean') return null
  for (const key of ['x_min','y_min','x_max','y_max']) {
    if (!finiteCoordinate(v[key])) return null
  }
  const region={
    present:v.present,
    x_min:v.x_min as number,
    y_min:v.y_min as number,
    x_max:v.x_max as number,
    y_max:v.y_max as number,
  }
  if (region.present && (region.x_max <= region.x_min || region.y_max <= region.y_min)) return null
  return region
}

/**
 * Runtime allowlist construction. Even if an upstream object contains
 * measurements, standards candidates, legacy nominal or GT-like diagnostics,
 * none of those keys are copied into this request.
 */
export function buildCandidateBlindSemanticRequest(input: unknown): CandidateBlindSemanticRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('semantic_request_input_invalid')
  }
  const v=input as Record<string,unknown>
  const image=typeof v.image === 'string' ? v.image : ''
  if (!image || !/^[A-Za-z0-9+/=]+$/.test(image)) throw new Error('semantic_request_image_invalid')
  const bytes=Buffer.from(image,'base64')
  if (!bytes.length) throw new Error('semantic_request_image_empty')
  const targetRegion=allowlistedRegion(v.target_region)
  return {
    schema_version:CANDIDATE_BLIND_SEMANTIC_REQUEST_SCHEMA,
    image:{
      base64:image,
      mime_type:'image/jpeg',
      image_sha256:createHash('sha256').update(bytes).digest('hex'),
    },
    semantic_roi:{
      crop_ref:'target_region_1',
      target_region:targetRegion,
    },
    visibility_context:{
      source:'original_image',
      target_region_supplied:targetRegion?.present === true,
      note:'spatial_context_only_no_physical_measurements',
    },
  }
}

/** Metadata only; image bytes are sent to the provider as an image part. */
export function candidateBlindSemanticPromptContext(request: CandidateBlindSemanticRequest) {
  return {
    request_schema:request.schema_version,
    image_sha256:request.image.image_sha256,
    semantic_roi:request.semantic_roi,
    visibility_context:request.visibility_context,
  }
}
