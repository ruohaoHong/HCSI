import type { IdentificationResult } from './identification'
import type { PurchaseGate } from './cv-purchase-policy'
import type { DriveEvidence } from './drive-evidence'
import type { MeasurementResult } from './measurement'
import {
  assessNominalCandidateConsistency,
  type InternalNominalMapping,
  type NominalCandidateAgreement,
} from './nominal-candidate-consistency'

export type PurchaseCompletenessReason =
  | 'cv_purchase_gate_blocked'
  | 'head_style_unresolved'
  | 'thread_system_unresolved'
  | 'nominal_specification_missing'
  | 'nominal_candidate_incomplete'
  | 'nominal_candidate_inconsistent'

export interface PurchaseSpecificationCompleteness {
  complete: boolean
  reason_codes: PurchaseCompletenessReason[]
  optional_unconfirmed_fields: Array<'drive_form' | 'drive_size'>
  nominal_candidate_agreement: NominalCandidateAgreement
}

export function assessPurchaseSpecificationCompleteness(
  result: IdentificationResult,
  gate: PurchaseGate,
  drive: DriveEvidence,
  measurement: MeasurementResult | null,
  mapping: InternalNominalMapping | null,
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
  if (!nominal) reasons.push('nominal_specification_missing')

  const agreement = assessNominalCandidateConsistency(mapping, measurement, gate)
  if (gate.allowed && nominal) {
    if (agreement.status === 'inconsistent') reasons.push('nominal_candidate_inconsistent')
    else if (agreement.status !== 'consistent') reasons.push('nominal_candidate_incomplete')
  }

  const noRecess = /^(none|no drive|不適用|外六角)$/i.test(drive.display_form)
  const optionalUnconfirmed: PurchaseSpecificationCompleteness['optional_unconfirmed_fields'] =
    !drive.form_observed ? ['drive_form', 'drive_size'] : noRecess ? [] : ['drive_size']
  return {
    complete: reasons.length === 0,
    reason_codes: reasons,
    optional_unconfirmed_fields: optionalUnconfirmed,
    nominal_candidate_agreement: agreement,
  }
}

export function publicCompletenessGuidance(itemName: string, reasons: PurchaseCompletenessReason[] = []): string {
  const name = itemName || '此五金'
  if (reasons.includes('nominal_candidate_inconsistent')) {
    return name + '（候選公稱規格與 CV 實測尺寸不一致；暫不提供完整購買規格，請持實物核對）'
  }
  if (reasons.includes('nominal_candidate_incomplete')) {
    return name + '（已量得主要尺寸，但候選公稱規格尚無法完整核對；暫不提供完整購買規格）'
  }
  return name + '（主要尺寸或公稱規格仍不完整；請依提示補拍清楚的側面與尺，並於購買前持實物核對）'
}
