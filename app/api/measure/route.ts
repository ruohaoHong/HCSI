import { NextResponse } from 'next/server'
import { runMeasurementPreflight, MeasurementServiceError } from '@/lib/measurement-client'
import { createMeasurementProof } from '@/lib/measurement-proof'
import { localizeForMeasurement } from '@/lib/semantic-localizer'

export const runtime = 'nodejs'

const MAX_IMAGE_LENGTH = 7_000_000

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const image = typeof body.image === 'string' ? body.image : ''
    if (!image || image.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(image)) {
      return NextResponse.json({ error: '影像格式不正確或檔案過大。' }, { status: 400 })
    }

    // Restore the semantic ROI stage before deterministic CV. This stage only
    // localizes target/reference/head-style and never supplies physical sizes.
    const localization = await localizeForMeasurement(image, 'openai')
    const measurement = await runMeasurementPreflight(
      image,
      [],
      localization.semantic_vision,
    )
    return NextResponse.json({
      measurement,
      measurement_proof: createMeasurementProof(measurement),
      semantic_localization: localization,
    })
  } catch (error) {
    if (error instanceof MeasurementServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 503 })
    }
    console.error('[HCSI] measurement preflight failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : '量測預檢發生未預期錯誤。', code: 'measurement_unexpected_error' }, { status: 502 })
  }
}
