import type { IdentificationResult } from './identification'
import type { PurchaseGate } from './cv-purchase-policy'
import type { DriveEvidence } from './drive-evidence'

export type PurchaseCompletenessReason =
  | 'cv_purchase_gate_blocked'
  | 'head_style_unresolved'
  | 'thread_system_unresolved'
  | 'nominal_specification_missing'
  | 'standards_candidate_not_selected'

export interface PurchaseSpecificationCompleteness {
  complete: boolean
  reason_codes: PurchaseCompletenessReason[]
  optional_unconfirmed_fields: Array<'drive_form' | 'drive_size'>
}

export function assessPurchaseSpecificationCompleteness(
  result: IdentificationResult,
  gate: PurchaseGate,
  drive: DriveEvidence,
  standardsDecision?: { selected_candidate_id: string | null; purchase_ready: boolean },
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
  if (!(fastener?.nominal_specification.trim())) {
    reasons.push('nominal_specification_missing')
  }
  if (!standardsDecision?.selected_candidate_id || standardsDecision.purchase_ready !== true) {
    reasons.push('standards_candidate_not_selected')
  }

  const noRecess = /^(none|no drive|不適用|外六角)$/i.test(drive.display_form)
  const optionalUnconfirmed: PurchaseSpecificationCompleteness['optional_unconfirmed_fields'] =
    !drive.form_observed ? ['drive_form', 'drive_size'] : noRecess ? [] : ['drive_size']

  return {
    complete: reasons.length === 0,
    reason_codes: reasons,
    optional_unconfirmed_fields: optionalUnconfirmed,
  }
}

export function publicCompletenessGuidance(itemName: string): string {
  const name = itemName || '此五金'
  return name + '（CV 物理量測已完成，但目前仍缺少足夠語義資訊形成完整購買名稱；請依提示補拍或持實物核對）'
}
