import type { IdentificationResult } from './identification'
import type { MeasurementResult } from './measurement'

export interface NominalThreadAgreement {
  status: 'consistent' | 'inconsistent' | 'unparseable' | 'no_trusted_thread'
  diameter_status: 'consistent' | 'inconsistent' | 'unparseable' | 'no_measurement'
  pitch_status: 'consistent' | 'inconsistent' | 'unparseable' | 'no_measurement'
  measured_D_mm: number | null
  nominal_D_mm: number | null
  measured_P_mm: number | null
  nominal_P_mm: number | null
  diameter_difference_mm: number | null
  pitch_difference_mm: number | null
}

function measured(measurement: MeasurementResult | null, key: 'D' | 'P'): number | null {
  const dim = measurement?.dimensions?.[key]
  return dim?.status === 'measured' && typeof dim.value_mm === 'number' &&
    Number.isFinite(dim.value_mm) && dim.value_mm > 0 ? dim.value_mm : null
}

function parseMetric(spec: string) {
  const match = spec.match(/\bM\s*(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)/i)
  if (!match) return null
  return { D: Number(match[1]), P: Number(match[2]) }
}

function parseFraction(raw: string): number | null {
  const compact = raw.trim().replace(/\s*\/\s*/g, '/')
  const parts = compact.split(/\s+/)
  const last = parts[parts.length - 1]
  if (!last.includes('/')) {
    const value = Number(last)
    return Number.isFinite(value) && value > 0 ? value : null
  }
  const [num, den] = last.split('/').map(Number)
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null
  const whole = parts.length > 1 ? Number(parts[0]) : 0
  return Number.isFinite(whole) ? whole + num / den : null
}

function parseImperial(spec: string) {
  const numbered = spec.match(/#\s*(\d{1,2})\s*[-–]\s*(\d+(?:\.\d+)?)/i)
  if (numbered) {
    const gauge = Number(numbered[1]), tpi = Number(numbered[2])
    if (gauge < 0 || gauge > 14 || tpi <= 0) return null
    return { D: (0.060 + 0.013 * gauge) * 25.4, P: 25.4 / tpi }
  }
  const fractional = spec.match(/\b((?:\d+\s+)?\d+\s*\/\s*\d+|\d*\.\d+)\s*[-–]\s*(\d+(?:\.\d+)?)/)
  if (!fractional) return null
  const inch = parseFraction(fractional[1]), tpi = Number(fractional[2])
  return inch !== null && tpi > 0 ? { D: inch * 25.4, P: 25.4 / tpi } : null
}

export function assessNominalThreadConsistency(
  nominal: string,
  measurement: MeasurementResult | null,
  threadSystem: NonNullable<IdentificationResult['fastener_interpretation']>['thread_system'],
): NominalThreadAgreement {
  const D = measured(measurement, 'D')
  const P = measured(measurement, 'P')
  if (D === null || P === null) return {
    status: 'no_trusted_thread',
    diameter_status: D === null ? 'no_measurement' : 'unparseable',
    pitch_status: P === null ? 'no_measurement' : 'unparseable',
    measured_D_mm: D, nominal_D_mm: null, measured_P_mm: P, nominal_P_mm: null,
    diameter_difference_mm: null, pitch_difference_mm: null,
  }
  const parsed = threadSystem === 'metric' ? parseMetric(nominal)
    : threadSystem === 'imperial' ? parseImperial(nominal)
      : parseMetric(nominal) ?? parseImperial(nominal)
  if (!parsed || !Number.isFinite(parsed.D) || !Number.isFinite(parsed.P) || parsed.D <= 0 || parsed.P <= 0) {
    return {
      status: 'unparseable', diameter_status: 'unparseable', pitch_status: 'unparseable',
      measured_D_mm: D, nominal_D_mm: null, measured_P_mm: P, nominal_P_mm: null,
      diameter_difference_mm: null, pitch_difference_mm: null,
    }
  }
  const dDiff = Math.abs(D - parsed.D)
  const pDiff = Math.abs(P - parsed.P)
  const dOK = dDiff <= Math.max(0.18, parsed.D * 0.04)
  const pOK = pDiff <= Math.max(0.04, parsed.P * 0.05)
  return {
    status: dOK && pOK ? 'consistent' : 'inconsistent',
    diameter_status: dOK ? 'consistent' : 'inconsistent',
    pitch_status: pOK ? 'consistent' : 'inconsistent',
    measured_D_mm: D, nominal_D_mm: Number(parsed.D.toFixed(5)),
    measured_P_mm: P, nominal_P_mm: Number(parsed.P.toFixed(5)),
    diameter_difference_mm: Number(dDiff.toFixed(5)),
    pitch_difference_mm: Number(pDiff.toFixed(5)),
  }
}
