import { deflateSync } from 'node:zlib'
import type { CvGroundingBasis } from './cv-grounding-basis'

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function interpolate(
  points: Array<{ axial_fraction: number; width_ratio: number }>,
  target: number,
): number | null {
  if (points.length < 2) return null
  const sorted = [...points].sort((a, b) => a.axial_fraction - b.axial_fraction)
  if (target <= sorted[0].axial_fraction) return sorted[0].width_ratio
  if (target >= sorted[sorted.length - 1].axial_fraction) return sorted[sorted.length - 1].width_ratio
  for (let index = 1; index < sorted.length; index += 1) {
    const left = sorted[index - 1]
    const right = sorted[index]
    if (target > right.axial_fraction) continue
    const span = right.axial_fraction - left.axial_fraction
    if (span <= 1e-9) return left.width_ratio
    const alpha = (target - left.axial_fraction) / span
    return left.width_ratio + alpha * (right.width_ratio - left.width_ratio)
  }
  return null
}

export interface CanonicalHeadGlyph {
  png_base64: string
  width_px: number
  height_px: number
  head_max_width_px: number
  head_height_px: number
  shank_width_px: number
  shank_height_px: number
}

/**
 * Render a semantic-free physical head glyph.
 *
 * - square pixels preserve K/DK visually;
 * - normalized_profile controls local silhouette width;
 * - DK/D controls shank width;
 * - no head-style name, drive hint, catalogue rule, or GT enters the image.
 */
export function buildCanonicalHeadGlyphPng(
  basis: CvGroundingBasis,
): CanonicalHeadGlyph | null {
  const profile = basis.head_shape_math.normalized_profile
  const kOverDk = basis.head_shape_signature.axial_aspect_K_over_DK
  const dkOverD = basis.head_shape_signature.radial_envelope_DK_over_D
  if (
    basis.evidence_partition.silhouette_integrity.status !== 'reliable' ||
    profile.length < 3 ||
    kOverDk === null || !Number.isFinite(kOverDk) || kOverDk <= 0 ||
    dkOverD === null || !Number.isFinite(dkOverD) || dkOverD <= 0
  ) return null

  const width = 160
  const height = 192
  const headMaxWidth = 112
  const shankHeight = 42
  const topMargin = 12
  const headHeight = Math.max(12, Math.min(126, Math.round(headMaxWidth * kOverDk)))
  if (topMargin + headHeight + shankHeight + 8 > height) return null
  const shankWidth = Math.max(5, Math.min(headMaxWidth, Math.round(headMaxWidth / dkOverD)))
  const centerX = Math.floor(width / 2)

  // 8-bit grayscale, white background (255), black body (0).
  const pixels = new Uint8Array(width * height)
  pixels.fill(255)

  const paintSpan = (y: number, spanWidth: number) => {
    const half = Math.max(1, Math.floor(spanWidth / 2))
    const x0 = Math.max(0, centerX - half)
    const x1 = Math.min(width - 1, centerX + half)
    for (let x = x0; x <= x1; x += 1) pixels[y * width + x] = 0
  }

  for (let row = 0; row < headHeight; row += 1) {
    // profile axial fraction runs underside -> top; image rows run top -> underside.
    const progress = headHeight <= 1 ? 0.5 : row / (headHeight - 1)
    const axial = 0.92 - progress * (0.92 - 0.08)
    const widthRatio = interpolate(profile, axial)
    if (widthRatio === null) return null
    const span = Math.max(3, Math.round(headMaxWidth * Math.max(0.05, Math.min(1.05, widthRatio))))
    paintSpan(topMargin + row, span)
  }

  const shankTop = topMargin + headHeight
  for (let row = 0; row < shankHeight; row += 1) {
    paintSpan(shankTop + row, shankWidth)
  }

  const rawRows: Buffer[] = []
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(width + 1)
    row[0] = 0 // PNG filter type 0
    Buffer.from(pixels.subarray(y * width, (y + 1) * width)).copy(row, 1)
    rawRows.push(row)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // grayscale
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(rawRows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])

  return {
    png_base64: png.toString('base64'),
    width_px: width,
    height_px: height,
    head_max_width_px: headMaxWidth,
    head_height_px: headHeight,
    shank_width_px: shankWidth,
    shank_height_px: shankHeight,
  }
}
