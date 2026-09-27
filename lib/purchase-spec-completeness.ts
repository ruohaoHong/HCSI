import type { IdentificationResult } from './identification'
import type { PurchaseGate } from './cv-purchase-policy'
import type { DriveEvidence } from './drive-evidence'

export type PurchaseCompletenessReason =
  | 'cv_purchase_gate_blocked'
  | 'head_style_unresolved'
  | 'thread_system_unresolved'
  | 'nominal_specification_missing'
  | 'nominal_specification_incomplete'
  | 'drive_form_unresolved'

export interface PurchaseSpecificationCompleteness {
  complete: boolean
  reason_codes: PurchaseCompletenessReason[]
  numeric_component_count: number
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
  const numericComponents = nominal.match(/\d+(?:\.\d+)?/g)?.length ?? 0
  if (!nominal) reasons.push('nominal_specification_missing')
  else if (numericComponents < 3) reasons.push('nominal_specification_incomplete')
  if (!drive.form_observed) reasons.push('drive_form_unresolved')
  return {
    complete: reasons.length === 0,
    reason_codes: reasons,
    numeric_component_count: numericComponents,
  }
}

export function publicCompletenessGuidance(itemName: string): string {
  const name = itemName || '此五金'
  return name + '（已取得部分物理尺寸，但公稱規格或驅動型式仍不完整；請補拍頭部正面，並於購買前持實物核對）'
}
