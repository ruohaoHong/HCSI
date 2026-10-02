import { createHash } from 'node:crypto'
import { readFileSync,existsSync } from 'node:fs'
import { resolve,relative,isAbsolute } from 'node:path'
import {
  ingestSemanticCalibrationCorpus,
  type SemanticCalibrationCorpusManifest,
} from './semantic-calibration-corpus-ingest'
import {
  validateSemanticCalibrationDataset,
  type SemanticCalibrationDatasetV1,
} from './semantic-calibration-dataset-v1'
import {
  validateSemanticCalibrationAcquisitionLedger,
  SEMANTIC_CALIBRATION_CAPTURE_PROTOCOL_VERSION,
  type SemanticCalibrationAcquisitionLedgerV1,
} from './semantic-calibration-acquisition-v1'

export const SEMANTIC_CALIBRATION_REAL_CORPUS_INTAKE_SCHEMA=
  'hcsi.semantic-calibration-real-corpus-intake.v1' as const

export interface SemanticCalibrationCorpusFileBindingV1 {
  image_id:string
  materialized_path:string
}

export interface SemanticCalibrationRealCorpusIntakeBundleV1 {
  schema_version:typeof SEMANTIC_CALIBRATION_REAL_CORPUS_INTAKE_SCHEMA
  acquisition_ledger:SemanticCalibrationAcquisitionLedgerV1
  corpus_manifest:SemanticCalibrationCorpusManifest
  image_files:SemanticCalibrationCorpusFileBindingV1[]
}

export interface SemanticCalibrationFileVerification {
  image_id:string
  materialized_path:string
  exists:boolean
  sha256:string|null
  width_px:number|null
  height_px:number|null
  verified:boolean
  reason_codes:string[]
}

export interface SemanticCalibrationRealCorpusIntakeResult {
  accepted:boolean
  dataset:SemanticCalibrationDatasetV1|null
  reason_codes:string[]
  file_verification:SemanticCalibrationFileVerification[]
}

function sha256Bytes(bytes:Buffer):string{
  return createHash('sha256').update(bytes).digest('hex')
}

function dimensionsFromBytes(bytes:Buffer){
  // Reuse the frozen image-byte decoder without creating a second geometry parser.
  const { readImageDimensionsFromBase64 } = require('./semantic-image-dimensions') as
    typeof import('./semantic-image-dimensions')
  return readImageDimensionsFromBase64(bytes.toString('base64'))
}

function nonEmpty(value:unknown):value is string{
  return typeof value==='string'&&value.trim().length>0
}

function pathWithinBase(baseDir:string,candidate:string):boolean{
  const base=resolve(baseDir)
  const target=resolve(baseDir,candidate)
  const rel=relative(base,target)
  return rel===''||(!rel.startsWith('..')&&!isAbsolute(rel))
}

function verifyImageFile(
  baseDir:string,
  binding:SemanticCalibrationCorpusFileBindingV1,
  manifestImage:{
    image_id:string
    sha256:string
    width_px:number
    height_px:number
  },
):SemanticCalibrationFileVerification{
  const reasons:string[]=[]
  if(!nonEmpty(binding.materialized_path)){
    reasons.push('materialized_image_path_missing')
    return {
      image_id:binding.image_id,materialized_path:binding.materialized_path,
      exists:false,sha256:null,width_px:null,height_px:null,verified:false,reason_codes:reasons,
    }
  }
  if(!pathWithinBase(baseDir,binding.materialized_path)){
    reasons.push('materialized_path_outside_base_dir')
    return {
      image_id:binding.image_id,materialized_path:binding.materialized_path,
      exists:false,sha256:null,width_px:null,height_px:null,verified:false,reason_codes:reasons,
    }
  }
  const absolute=resolve(baseDir,binding.materialized_path)
  if(!existsSync(absolute)){
    reasons.push('actual_image_file_missing')
    return {
      image_id:binding.image_id,materialized_path:binding.materialized_path,
      exists:false,sha256:null,width_px:null,height_px:null,verified:false,reason_codes:reasons,
    }
  }

  const bytes=readFileSync(absolute)
  const sha=sha256Bytes(bytes)
  if(sha!==manifestImage.sha256) reasons.push('actual_image_sha256_mismatch')
  const dimensions=dimensionsFromBytes(bytes)
  if(!dimensions){
    reasons.push('actual_image_dimensions_unreadable')
  }else if(
    dimensions.width_px!==manifestImage.width_px||
    dimensions.height_px!==manifestImage.height_px
  ){
    reasons.push('actual_image_dimensions_mismatch')
  }

  return {
    image_id:binding.image_id,
    materialized_path:binding.materialized_path,
    exists:true,
    sha256:sha,
    width_px:dimensions?.width_px??null,
    height_px:dimensions?.height_px??null,
    verified:reasons.length===0,
    reason_codes:reasons,
  }
}

export function intakeRealSemanticCalibrationCorpus(
  bundle:SemanticCalibrationRealCorpusIntakeBundleV1,
  baseDir:string,
):SemanticCalibrationRealCorpusIntakeResult{
  const reasons:string[]=[]
  const manifest=bundle.corpus_manifest
  const ledger=bundle.acquisition_ledger

  if(bundle.schema_version!==SEMANTIC_CALIBRATION_REAL_CORPUS_INTAKE_SCHEMA){
    reasons.push('real_corpus_intake_schema_mismatch')
  }

  const ledgerValidation=validateSemanticCalibrationAcquisitionLedger(ledger)
  reasons.push(...ledgerValidation.reason_codes)

  if(manifest.source_scope!=='independent_real_image'){
    reasons.push('real_corpus_source_scope_required')
  }
  if(manifest.source_provenance.source_class!=='independent_real_image'||
     manifest.source_provenance.independent_acquisition!==true){
    reasons.push('real_corpus_source_provenance_invalid')
  }
  if(ledger.capture_protocol_version!==SEMANTIC_CALIBRATION_CAPTURE_PROTOCOL_VERSION){
    reasons.push('capture_protocol_version_mismatch')
  }

  const ledgerBySpecimen=new Map(ledger.entries.map(entry=>[entry.specimen_id,entry]))
  const manifestSpecimenIds=new Set<string>()
  const manifestImages=new Map<string,{
    image_id:string
    sha256:string
    width_px:number
    height_px:number
  }>()

  for(const specimen of manifest.specimens){
    if(manifestSpecimenIds.has(specimen.specimen_id)) reasons.push('duplicate_specimen_id')
    if(new Set(specimen.images.map(image=>image.split)).size>1) reasons.push('specimen_split_leakage')
    manifestSpecimenIds.add(specimen.specimen_id)
    const acquisition=ledgerBySpecimen.get(specimen.specimen_id)
    if(!acquisition){
      reasons.push('specimen_acquisition_ledger_entry_missing')
    }else{
      if(specimen.provenance.source_class!=='independent_real_image'){
        reasons.push('specimen_source_provenance_not_independent_real_image')
      }
      if(specimen.provenance.source_ref!==acquisition.source_ref){
        reasons.push('specimen_acquisition_source_ref_mismatch')
      }
      if(specimen.provenance.physical_identity_verified!==true){
        reasons.push('physical_specimen_identity_unverified')
      }
      if(specimen.images.some(image=>image.split!==acquisition.locked_split)){
        reasons.push('specimen_split_differs_from_acquisition_lock')
      }
      if(specimen.ground_truth.some(gt=>gt.gt_source!==acquisition.ground_truth_provenance_ref)){
        reasons.push('ground_truth_acquisition_provenance_mismatch')
      }
    }

    for(const image of specimen.images){
      if(manifestImages.has(image.image_id)) reasons.push('duplicate_image_id')
      manifestImages.set(image.image_id,{
        image_id:image.image_id,
        sha256:image.sha256,
        width_px:image.width_px,
        height_px:image.height_px,
      })
      if(!nonEmpty(image.capture_type)||!nonEmpty(image.viewpoint)||!nonEmpty(image.crop_type)||
         !nonEmpty(image.visibility)||!nonEmpty(image.occlusion_condition)||!nonEmpty(image.glare_condition)||
         !Number.isFinite(image.width_px)||image.width_px<=0||
         !Number.isFinite(image.height_px)||image.height_px<=0){
        reasons.push('capture_metadata_missing_or_invalid')
      }
    }
  }

  for(const entry of ledger.entries){
    if(!manifestSpecimenIds.has(entry.specimen_id)){
      reasons.push('acquisition_specimen_missing_from_manifest')
    }
    if(/^https?:\/\//i.test(entry.source_ref)){
      reasons.push('internet_source_reference_forbidden')
    }
  }

  const bindingsByImage=new Map<string,SemanticCalibrationCorpusFileBindingV1>()
  for(const binding of bundle.image_files){
    if(bindingsByImage.has(binding.image_id)) reasons.push('duplicate_image_file_binding')
    bindingsByImage.set(binding.image_id,binding)
    if(!manifestImages.has(binding.image_id)) reasons.push('unreferenced_image_file_binding')
  }

  const fileVerification:SemanticCalibrationFileVerification[]=[]
  for(const image of manifestImages.values()){
    const binding=bindingsByImage.get(image.image_id)
    if(!binding){
      reasons.push('image_file_binding_missing')
      fileVerification.push({
        image_id:image.image_id,materialized_path:'',
        exists:false,sha256:null,width_px:null,height_px:null,
        verified:false,reason_codes:['image_file_binding_missing'],
      })
      continue
    }
    const verification=verifyImageFile(baseDir,binding,image)
    fileVerification.push(verification)
    reasons.push(...verification.reason_codes)
  }

  if(reasons.length){
    return {accepted:false,dataset:null,reason_codes:[...new Set(reasons)],file_verification:fileVerification}
  }

  const ingestion=ingestSemanticCalibrationCorpus(manifest)
  reasons.push(...ingestion.reason_codes)
  if(!ingestion.accepted||!ingestion.dataset){
    return {accepted:false,dataset:null,reason_codes:[...new Set(reasons)],file_verification:fileVerification}
  }

  const datasetValidation=validateSemanticCalibrationDataset(ingestion.dataset)
  reasons.push(...datasetValidation.reason_codes)
  if(!datasetValidation.valid||!datasetValidation.production_eligible_source){
    return {accepted:false,dataset:null,reason_codes:[...new Set(reasons)],file_verification:fileVerification}
  }

  return {
    accepted:true,
    dataset:ingestion.dataset,
    reason_codes:[...new Set(reasons)],
    file_verification:fileVerification,
  }
}
