import type { PurchaseGate } from './cv-purchase-policy'
import type { IdentificationResult } from './identification'

export interface NominalLengthAgreement {
  status: 'consistent' | 'inconsistent' | 'unparseable' | 'no_trusted_length'
  selected_cv_mm: number | null
  nominal_mm: number | null
  difference_mm: number | null
  tolerance_mm: number | null
}

// Interpret a purchase specification's final multiplication segment as its
// length. This supports common metric and US screw designations without any
// catalogue/standards table. Unclear formats fail closed rather than guessing.
function parseLengthSegment(spec: string, threadSystem: 'metric' | 'imperial' | 'unknown'): number | null {
  const pattern = /[×xX*]\s*((?:\d+\s+)?\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*(mm|毫米|inches|inch|in|吋|["″])?/gim
  const matches = [...spec.matchAll(pattern)]
  if (!matches.length) return null
  const last = matches[matches.length - 1]
  const raw = last[1].replace(/\s*\/\s*/g, '/').trim()
  let value: number
  if (raw.includes('/')) {
    const tokens = raw.split(/\s+/)
    const fraction = tokens[tokens.length - 1].split('/')
    if (fraction.length !== 2 || !fraction.every(x => /^\d+$/.test(x))) return null
    const numerator = Number(fraction[0]), denominator = Number(fraction[1])
    if (denominator === 0) return null
    value = numerator / denominator + (tokens.length > 1 ? Number(tokens[0]) : 0)
  } else {
    value = Number(raw)
  }
  if (!Number.isFinite(value) || value <= 0) return null
  const explicitUnit = (last[2] ?? '').toLowerCase()
  const metric = explicitUnit === 'mm' || explicitUnit === '毫米'
  const imperial = ['in', 'inch', 'inches', '吋', '"', '″'].includes(explicitUnit)
  if (!metric && !imperial && threadSystem === 'unknown') return null
  return (imperial || (!metric && threadSystem === 'imperial')) ? value * 25.4 : value
}

export function assessNominalLengthConsistency(
  nominal: string,
  selectedCvMm: PurchaseGate['selected_length_mm'],
  threadSystem: NonNullable<IdentificationResult['fastener_interpretation']>['thread_system'],
): NominalLengthAgreement {
  const cvMm = typeof selectedCvMm === 'number' && Number.isFinite(selectedCvMm) && selectedCvMm > 0
    ? selectedCvMm : null
  if (cvMm === null) return { status: 'no_trusted_length', selected_cv_mm: null,
    nominal_mm: null, difference_mm: null, tolerance_mm: null }
  const nominalMm = parseLengthSegment(nominal, threadSystem)
  if (nominalMm === null) return { status: 'unparseable', selected_cv_mm: cvMm,
    nominal_mm: null, difference_mm: null, tolerance_mm: null }
  const difference = Math.abs(cvMm - nominalMm)
  // A gross disagreement cannot be a nominal-spec inference. This tolerance
  // is an initial conservative screen, NOT a calibrated instrument accuracy.
  const tolerance = Math.max(0.2, cvMm * 0.015)
  return {
    status: difference <= tolerance ? 'consistent' : 'inconsistent',
    selected_cv_mm: cvMm,
    nominal_mm: Number(nominalMm.toFixed(5)),
    difference_mm: Number(difference.toFixed(5)),
    tolerance_mm: Number(tolerance.toFixed(5)),
  }
}
