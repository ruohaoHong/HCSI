import { sha256Canonical,isSha256 } from './semantic-calibration-digest'
import type { CalibrationSplit } from './semantic-calibration-dataset-v1'

export const SEMANTIC_CALIBRATION_ACQUISITION_LEDGER_SCHEMA=
  'hcsi.semantic-calibration-acquisition-ledger.v1' as const
export const SEMANTIC_CALIBRATION_CAPTURE_PROTOCOL_VERSION=
  'hcsi.semantic-calibration-capture.v1' as const

export type SemanticCalibrationMaterialOrigin=
  |'physical_specimen'
  |'synthetic_image'
  |'generated_image'
  |'regression_fixture'
  |'development_fixture'
  |'sealed_blind_fixture'
  |'internet_image'
  |'supplier_listing'

export interface SemanticCalibrationAcquisitionLedgerEntryV1 {
  specimen_id:string
  acquisition_event_id:string
  acquired_at:string
  source_class:'independent_real_image'
  material_origin:SemanticCalibrationMaterialOrigin
  source_ref:string
  physical_identity_verified:boolean
  physical_specimen_ref:string
  ground_truth_provenance_ref:string
  capture_protocol_version:typeof SEMANTIC_CALIBRATION_CAPTURE_PROTOCOL_VERSION
  locked_split:CalibrationSplit
  semantic_sensor_observation_started_at:null
}

export interface SemanticCalibrationAcquisitionLedgerV1 {
  schema_version:typeof SEMANTIC_CALIBRATION_ACQUISITION_LEDGER_SCHEMA
  ledger_id:string
  ledger_version:string
  created_at:string
  capture_protocol_version:typeof SEMANTIC_CALIBRATION_CAPTURE_PROTOCOL_VERSION
  split_plan_id:string
  split_plan_version:string
  entries:SemanticCalibrationAcquisitionLedgerEntryV1[]
  ledger_content_digest_sha256:string
}

export type SemanticCalibrationAcquisitionLedgerDraft=
  Omit<SemanticCalibrationAcquisitionLedgerV1,'ledger_content_digest_sha256'>

export function semanticCalibrationAcquisitionLedgerDigest(
  ledger:SemanticCalibrationAcquisitionLedgerDraft|SemanticCalibrationAcquisitionLedgerV1,
):string{
  const {ledger_content_digest_sha256:_digest,...content}=
    ledger as SemanticCalibrationAcquisitionLedgerV1
  return sha256Canonical(content)
}

export function finalizeSemanticCalibrationAcquisitionLedger(
  draft:SemanticCalibrationAcquisitionLedgerDraft,
):SemanticCalibrationAcquisitionLedgerV1{
  return {
    ...draft,
    ledger_content_digest_sha256:semanticCalibrationAcquisitionLedgerDigest(draft),
  }
}

export interface SemanticCalibrationAcquisitionLedgerValidation {
  valid:boolean
  reason_codes:string[]
  specimen_count:number
}

function nonEmpty(value:unknown):value is string{
  return typeof value==='string'&&value.trim().length>0
}

function validTimestamp(value:string):boolean{
  return Number.isFinite(Date.parse(value))
}

export function validateSemanticCalibrationAcquisitionLedger(
  ledger:SemanticCalibrationAcquisitionLedgerV1,
):SemanticCalibrationAcquisitionLedgerValidation{
  const reasons:string[]=[]
  if(ledger.schema_version!==SEMANTIC_CALIBRATION_ACQUISITION_LEDGER_SCHEMA){
    reasons.push('acquisition_ledger_schema_mismatch')
  }
  if(ledger.capture_protocol_version!==SEMANTIC_CALIBRATION_CAPTURE_PROTOCOL_VERSION){
    reasons.push('capture_protocol_version_mismatch')
  }
  if(!nonEmpty(ledger.ledger_id)||!nonEmpty(ledger.ledger_version)||
     !nonEmpty(ledger.split_plan_id)||!nonEmpty(ledger.split_plan_version)){
    reasons.push('acquisition_ledger_identity_missing')
  }
  if(!validTimestamp(ledger.created_at)) reasons.push('acquisition_ledger_created_at_invalid')
  if(!isSha256(ledger.ledger_content_digest_sha256)){
    reasons.push('acquisition_ledger_digest_invalid')
  }else if(ledger.ledger_content_digest_sha256!==semanticCalibrationAcquisitionLedgerDigest(ledger)){
    reasons.push('acquisition_ledger_digest_mismatch')
  }
  if(ledger.entries.length===0) reasons.push('acquisition_ledger_empty')

  const specimenIds=new Set<string>()
  const acquisitionEventIds=new Set<string>()
  for(const entry of ledger.entries){
    if(!nonEmpty(entry.specimen_id)) reasons.push('acquisition_specimen_id_missing')
    if(specimenIds.has(entry.specimen_id)) reasons.push('duplicate_acquisition_specimen_id')
    specimenIds.add(entry.specimen_id)

    if(!nonEmpty(entry.acquisition_event_id)) reasons.push('acquisition_event_id_missing')
    if(acquisitionEventIds.has(entry.acquisition_event_id)) reasons.push('duplicate_acquisition_event_id')
    acquisitionEventIds.add(entry.acquisition_event_id)

    if(!validTimestamp(entry.acquired_at)) reasons.push('acquired_at_invalid')
    if(entry.source_class!=='independent_real_image') reasons.push('acquisition_source_class_not_independent_real_image')
    if(entry.material_origin!=='physical_specimen'){
      reasons.push(
        entry.material_origin==='synthetic_image'||entry.material_origin==='generated_image'
          ?'synthetic_source_laundering_forbidden'
          : entry.material_origin==='regression_fixture'||entry.material_origin==='development_fixture'
            ?'fixture_source_laundering_forbidden'
            : entry.material_origin==='sealed_blind_fixture'
              ?'sealed_blind_source_laundering_forbidden'
              :'non_physical_source_laundering_forbidden'
      )
    }
    if(!nonEmpty(entry.source_ref)||
       !nonEmpty(entry.physical_specimen_ref)||
       !nonEmpty(entry.ground_truth_provenance_ref)){
      reasons.push('acquisition_provenance_missing')
    }
    if(entry.physical_identity_verified!==true) reasons.push('physical_specimen_identity_unverified')
    if(entry.capture_protocol_version!==SEMANTIC_CALIBRATION_CAPTURE_PROTOCOL_VERSION){
      reasons.push('capture_protocol_version_mismatch')
    }
    if(!['fit','calibration','validation'].includes(entry.locked_split)){
      reasons.push('acquisition_locked_split_invalid')
    }
    if(entry.semantic_sensor_observation_started_at!==null){
      reasons.push('acquisition_must_precede_semantic_sensor_observation')
    }
  }

  const unique=[...new Set(reasons)]
  return {valid:unique.length===0,reason_codes:unique,specimen_count:ledger.entries.length}
}
