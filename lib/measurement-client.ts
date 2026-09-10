import { createHash } from 'node:crypto'
import { isMeasurementResult, type MeasurementResult } from '@/lib/measurement'

const MEASUREMENT_TIMEOUT_MS = 25_000

export class MeasurementServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = 'MeasurementServiceError'
  }
}

export async function runMeasurementPreflight(imageBase64: string): Promise<MeasurementResult> {
  const serviceUrl = process.env.HCSI_MEASUREMENT_SERVICE_URL?.trim()
  if (!serviceUrl) {
    throw new MeasurementServiceError('量測服務尚未設定。', 'measurement_service_not_configured')
  }

  const bytes = Uint8Array.from(Buffer.from(imageBase64, 'base64'))
  const expectedSha256 = createHash('sha256').update(bytes).digest('hex')
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'capture.jpg')

  const headers = new Headers()
  const token = process.env.HCSI_MEASUREMENT_TOKEN?.trim()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), MEASUREMENT_TIMEOUT_MS)
  try {
    const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/measure`, {
      method: 'POST',
      headers,
      body: form,
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!response.ok) {
      const detail = await response.text()
      console.error('[HCSI] measurement upstream error:', response.status, detail.slice(0, 1000))
      throw new MeasurementServiceError('量測服務目前無法完成分析。', `measurement_upstream_${response.status}`)
    }

    const result: unknown = await response.json()
    if (!isMeasurementResult(result)) {
      throw new MeasurementServiceError('量測服務回傳格式不完整。', 'measurement_invalid_response')
    }
    if (result.image_sha256 !== expectedSha256) {
      throw new MeasurementServiceError('量測結果與目前影像不一致。', 'measurement_image_hash_mismatch')
    }
    return result
  } catch (error) {
    if (error instanceof MeasurementServiceError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MeasurementServiceError('量測服務逾時。', 'measurement_timeout')
    }
    throw new MeasurementServiceError('量測服務目前無法連線。', 'measurement_unavailable')
  } finally {
    clearTimeout(timeout)
  }
}
