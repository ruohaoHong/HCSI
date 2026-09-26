import type { HeadStyle } from './identification'
import type { MeasurementResult } from './measurement'

/**
 * Only semantic length-convention selection happens here.
 * This pure function NEVER modifies or fills CV raw values. "other"/"unknown"
 * must expose both candidates without silently picking one.
 */
export function selectLengthFromCv(head: HeadStyle, cv: MeasurementResult | null) {
  const convention: 'under_head' | 'overall' | 'unresolved' =
    head === 'flat_countersunk' ? 'overall'
      : ['pan', 'truss', 'hex', 'button', 'socket_cap', 'round'].includes(head)
        ? 'under_head' : 'unresolved'
  const dimension = convention === 'under_head' ? 'L_underhead'
    : convention === 'overall' ? 'L_overall' : null
  const candidate = dimension ? cv?.dimensions?.[dimension] : null
  return {
    convention,
    dimension,
    value_px: candidate?.status === 'measured' ? candidate.value_px : null,
    value_mm: candidate?.status === 'measured' ? candidate.value_mm : null,
    source: candidate?.status === 'measured' ? 'cv_raw_measurement' : 'not_obtained',
    candidates: {
      under_head: cv?.dimensions?.L_underhead ?? null,
      overall: cv?.dimensions?.L_overall ?? null,
    },
  }
}
