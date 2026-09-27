import type { IdentificationResult } from './identification'
import type { PurchaseGate } from './cv-purchase-policy'
import type { DriveEvidence } from './drive-evidence'

export type PurchaseCompletenessReason =
  | 'cv_purchase_gate_blocked'
  | 'head_style_unresolved'
  | 'thread_system_unresolved'
  | 'nominal_specification_missing'
  | 'nominal_specification_incomplete'

export interface PurchaseSpecificationCompleteness {
  // Complete *dimensional* purchase spec, independently of a visible drive
  // recess. Ruler + screw side-view images rarely show the drive face.
  complete: boolean
  reason_codes: PurchaseCompletenessReason[]
  numeric_component_count: number
  optional_unconfirmed_fields: Array<'drive_form' | 'drive_size'>
}

export function assessPurchaseSpecificationCompleteness(
  result: IdentificationResult,
  gate: PurchaseGate,
  drive: DriveEvidence,
): PurchaseSpecificationCompleteness {
  const reasons: PurchaseCompletenessReason[] = []
  const fastener = result.fastener_interpretation
  if (!gate.allowed) reasons.push('cv_purchase_gate_blocked')
  if (!fastener || ['unknown', 'other'].includes(fastener.head_style)) {
    reasons.push('head_style_unresolved')
  }
  if (!fastener || fastener.thread_system === 'unknown') {
    reasons.push('thread_system_unresolved')
  }
  const nominal = fastener?.nominal_specification.trim() ?? ''
  // Sanity check only; it never replaces the independent CV D/P/L gate.
  const numericComponents = nominal.match(/\d+(?:\.\d+)?/g)?.length ?? 0
  if (!nominal) reasons.push('nominal_specification_missing')
  else if (numericComponents < 3) reasons.push('nominal_specification_incomplete')
  const noRecess = /^(none|no drive|不適用|外六角)$/i.test(drive.display_form)
  const optionalUnconfirmed: PurchaseSpecificationCompleteness['optional_unconfirmed_fields'] =
    !drive.form_observed ? ['drive_form', 'drive_size'] : noRecess ? [] : ['drive_size']
  return {
    complete: reasons.length === 0,
    reason_codes: reasons,
    numeric_component_count: numericComponents,
    optional_unconfirmed_fields: optionalUnconfirmed,
  }
}

export function publicCompletenessGuidance(itemName: string): string {
  const name = itemName || '此五金'
  return name + '（主要尺寸或公稱規格仍不完整；請依提示補拍清楚的側面與尺，並於購買前持實物核對）'
}
