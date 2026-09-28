import type { IdentificationResult } from './identification'
import type { PurchaseGate } from './cv-purchase-policy'
import type { DriveEvidence } from './drive-evidence'
import { assessNominalLengthConsistency, type NominalLengthAgreement } from './nominal-length-consistency'
import { assessNominalThreadConsistency, type NominalThreadAgreement } from './nominal-thread-consistency'
import type { MeasurementResult } from './measurement'

export type PurchaseCompletenessReason =
  | 'cv_purchase_gate_blocked'
  | 'head_style_unresolved'
  | 'thread_system_unresolved'
  | 'nominal_specification_missing'
  | 'nominal_specification_incomplete'
  | 'nominal_length_unverifiable'
  | 'nominal_length_inconsistent'
  | 'nominal_thread_unverifiable'
  | 'nominal_thread_inconsistent'

export interface PurchaseSpecificationCompleteness {
  // Complete *dimensional* purchase spec, independently of a visible drive
  // recess. Ruler + screw side-view images rarely show the drive face.
  complete: boolean
  reason_codes: PurchaseCompletenessReason[]
  numeric_component_count: number
  optional_unconfirmed_fields: Array<'drive_form' | 'drive_size'>
  nominal_length_agreement: NominalLengthAgreement
  nominal_thread_agreement: NominalThreadAgreement
}

export function assessPurchaseSpecificationCompleteness(
  result: IdentificationResult,
  gate: PurchaseGate,
  drive: DriveEvidence,
  measurement: MeasurementResult | null = null,
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
  const lengthAgreement = assessNominalLengthConsistency(
    nominal, gate.selected_length_mm, fastener?.thread_system ?? 'unknown',
  )
  if (gate.allowed && nominal && numericComponents >= 3) {
    if (lengthAgreement.status === 'inconsistent') reasons.push('nominal_length_inconsistent')
    else if (lengthAgreement.status !== 'consistent') reasons.push('nominal_length_unverifiable')
  }
  const threadAgreement = assessNominalThreadConsistency(
    nominal, measurement, fastener?.thread_system ?? 'unknown',
  )
  if (gate.allowed && nominal && numericComponents >= 3) {
    if (threadAgreement.status === 'inconsistent') reasons.push('nominal_thread_inconsistent')
    else if (threadAgreement.status !== 'consistent') reasons.push('nominal_thread_unverifiable')
  }
  const noRecess = /^(none|no drive|不適用|外六角)$/i.test(drive.display_form)
  const optionalUnconfirmed: PurchaseSpecificationCompleteness['optional_unconfirmed_fields'] =
    !drive.form_observed ? ['drive_form', 'drive_size'] : noRecess ? [] : ['drive_size']
  return {
    complete: reasons.length === 0,
    reason_codes: reasons,
    numeric_component_count: numericComponents,
    optional_unconfirmed_fields: optionalUnconfirmed,
    nominal_length_agreement: lengthAgreement,
    nominal_thread_agreement: threadAgreement,
  }
}

export function publicCompletenessGuidance(itemName: string, reasons: PurchaseCompletenessReason[] = []): string {
  const name = itemName || '此五金'
  if (reasons.includes('nominal_length_inconsistent')) {
    return name + '（已量得主要尺寸，但候選公稱長度與影像實測不一致；暫不提供完整購買規格，請持實物核對）'
  }
  if (reasons.includes('nominal_thread_inconsistent')) {
    return name + '（候選公稱牙徑或牙距與 CV 實測 D/P 不一致；暫不提供完整購買規格）'
  }
  if (reasons.includes('nominal_thread_unverifiable')) {
    return name + '（已量得 D/P，但候選螺紋規格無法可靠核對；暫不提供完整購買規格）'
  }
  if (reasons.includes('nominal_length_unverifiable')) {
    return name + '（主要尺寸已量得，但候選購買規格的長度無法可靠核對；請持實物確認）'
  }
  return name + '（主要尺寸或公稱規格仍不完整；請依提示補拍清楚的側面與尺，並於購買前持實物核對）'
}
