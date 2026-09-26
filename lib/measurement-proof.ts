import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { isMeasurementResult, type MeasurementResult } from '@/lib/measurement'

// Every serverless instance derives the same secret. Never trust a browser-
// supplied CV JSON just because its SHA matches an uploaded image.
const PROOF_VERSION = 'hcsi.cv-first.v1'
const FIXED_KEYS = ['D', 'P', 'L_underhead', 'L_overall', 'B', 'K', 'DK'] as const

function secret() {
  return process.env.HCSI_MEASUREMENT_TOKEN || process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY || process.env.XAI_API_KEY || ''
}

function hasFixedDimensions(measurement: MeasurementResult): boolean {
  return !!measurement.dimensions && FIXED_KEYS.every(key => measurement.dimensions?.[key])
}

export function imageDigest(base64: string) {
  return createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex')
}

export function createMeasurementProof(measurement: MeasurementResult): string | null {
  const key = secret()
  if (!key || !hasFixedDimensions(measurement)) return null
  return createHmac('sha256', key).update(PROOF_VERSION)
    .update(measurement.image_sha256)
    .update(JSON.stringify(measurement)).digest('hex')
}

export function verifyMeasurementProof(value: unknown, proof: unknown, imageBase64: string): value is MeasurementResult {
  if (!isMeasurementResult(value) || !hasFixedDimensions(value)) return false
  if (value.image_sha256 !== imageDigest(imageBase64)) return false
  const expected = createMeasurementProof(value)
  if (!expected || typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)) return false
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(proof, 'hex'))
}
