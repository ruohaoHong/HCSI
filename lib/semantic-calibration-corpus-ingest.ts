import type { SemanticFeatureId } from './semantic-taxonomy-v1'
import type { SemanticSensorType } from './semantic-evidence-v1'
import { sha256Canonical,isSha256 } from './semantic-calibration-digest'
import { SEMANTIC_CALIBRATION_LINEAGE_SCHEMA } from './semantic-calibration-lineage-v1'
import {
  SEMANTIC_CALIBRATION_DATASET_SCHEMA,
  finalizeSemanticCalibrationDataset,
  validateSemanticCalibrationDataset,
  type CalibrationDatasetSourceScope,
  type CalibrationSplit,
  type SemanticCalibrationDatasetV1,
} from './semantic-calibration-dataset-v1'

export const SEMANTIC_CALIBRATION_CORPUS_MANIFEST_SCHEMA='hcsi.semantic-calibration-corpus-manifest.v1' as const

export interface SemanticCalibrationCorpusManifest {
  schema_version:typeof SEMANTIC_CALIBRATION_CORPUS_MANIFEST_SCHEMA
  dataset_id:string
  dataset_version:string
  created_at:string
  source_scope:CalibrationDatasetSourceScope
  source_provenance:{source_class:CalibrationDatasetSourceScope;source_ref:string;independent_acquisition:boolean}
  specimens:Array<{
    specimen_id:string
    provenance:{source_class:CalibrationDatasetSourceScope;source_ref:string;physical_identity_verified:boolean}
    images:Array<{
      image_id:string
      sha256:string
      source_ref:string
      capture_type:string
      viewpoint:string
      crop_type:string
      width_px:number
      height_px:number
      visibility:string
      occlusion_condition:string
      glare_condition:string
      split:CalibrationSplit
    }>
    ground_truth:Array<{
      feature_id:SemanticFeatureId
      value:string
      verification_method:string
      gt_source:string
      annotator_or_fixture_provenance:string
      schema_version:string
      self_labeled_by_sensor:boolean
    }>
  }>
  feature_scope:SemanticFeatureId[]
  sensor_scope:SemanticSensorType[]
}

export interface CorpusIngestionResult {
  accepted:boolean
  dataset:SemanticCalibrationDatasetV1|null
  reason_codes:string[]
  manifest_sha_index:Record<string,string[]>
  immutable_manifest_digest_sha256:string
}

export function ingestSemanticCalibrationCorpus(m:SemanticCalibrationCorpusManifest):CorpusIngestionResult{
  const reasons:string[]=[]
  const hashes=new Map<string,Array<{specimen:string;split:CalibrationSplit;image:string}>>()
  const digest=sha256Canonical(m)

  if(m.schema_version!==SEMANTIC_CALIBRATION_CORPUS_MANIFEST_SCHEMA) reasons.push('manifest_schema_mismatch')
  if(m.source_provenance.source_class!==m.source_scope) reasons.push('manifest_source_provenance_mismatch')
  if(m.source_scope==='independent_real_image'&&!m.source_provenance.independent_acquisition) reasons.push('independent_acquisition_not_verified')
  if(m.source_scope==='regression_fixture'||m.source_scope==='development_fixture') reasons.push('fixture_provenance_forbidden')
  if(m.source_scope==='sealed_blind_fixture') reasons.push('sealed_fixture_forbidden')
  if(m.source_scope==='synthetic_test') reasons.push('synthetic_dataset_not_production_eligible')

  for(const specimen of m.specimens){
    if(!specimen.provenance.physical_identity_verified) reasons.push('physical_specimen_identity_unverified')
    if(specimen.provenance.source_class!==m.source_scope) reasons.push('specimen_source_provenance_mismatch')
    if(specimen.provenance.source_class==='regression_fixture'||specimen.provenance.source_class==='development_fixture') reasons.push('fixture_provenance_forbidden')
    if(specimen.provenance.source_class==='sealed_blind_fixture') reasons.push('sealed_fixture_forbidden')
    const splits=new Set(specimen.images.map(i=>i.split))
    if(splits.size>1) reasons.push('specimen_split_leakage')
    for(const image of specimen.images){
      if(!isSha256(image.sha256)) reasons.push('image_sha256_invalid')
      if(!image.source_ref) reasons.push('image_source_ref_missing')
      const occurrences=hashes.get(image.sha256)??[]
      occurrences.push({specimen:specimen.specimen_id,split:image.split,image:image.image_id})
      hashes.set(image.sha256,occurrences)
    }
    for(const gt of specimen.ground_truth){
      if(gt.self_labeled_by_sensor) reasons.push('ground_truth_self_label_forbidden')
      if(!gt.verification_method||!gt.gt_source||!gt.annotator_or_fixture_provenance||!gt.schema_version){
        reasons.push('ground_truth_provenance_missing')
      }
    }
  }

  for(const occurrences of hashes.values()){
    if(occurrences.length>1){
      reasons.push('duplicate_image_sha256')
      if(new Set(occurrences.map(x=>x.split)).size>1) reasons.push('cross_split_image_sha256')
    }
  }

  const dataset=finalizeSemanticCalibrationDataset({
    schema_version:SEMANTIC_CALIBRATION_DATASET_SCHEMA,
    lineage_schema_version:SEMANTIC_CALIBRATION_LINEAGE_SCHEMA,
    dataset_id:m.dataset_id,dataset_version:m.dataset_version,manifest_digest_sha256:digest,created_at:m.created_at,
    source_scope:m.source_scope,
    source_provenance:{...m.source_provenance},
    specimens:m.specimens.map(specimen=>({
      specimen_id:specimen.specimen_id,
      provenance:{...specimen.provenance},
      images:specimen.images.map(image=>({
        image_id:image.image_id,sha256:image.sha256,source_ref:image.source_ref,split:image.split,
        capture_type:image.capture_type,viewpoint:image.viewpoint,crop_type:image.crop_type,
        width_px:image.width_px,height_px:image.height_px,visibility:image.visibility,
        occlusion_condition:image.occlusion_condition,glare_condition:image.glare_condition,
      })),
      ground_truth:specimen.ground_truth.map(gt=>({
        feature_id:gt.feature_id,value:gt.value,gt_source:gt.gt_source,
        verification_method:gt.verification_method,
        annotator_or_fixture_provenance:gt.annotator_or_fixture_provenance,
        schema_version:gt.schema_version,
      })),
    })),
    split_policy:{unit:'physical_specimen',allowed_splits:['fit','calibration','validation'],specimen_may_cross_splits:false},
    feature_scope:[...m.feature_scope],sensor_scope:[...m.sensor_scope],
    capture_conditions:{
      capture_types:[...new Set(m.specimens.flatMap(s=>s.images.map(i=>i.capture_type)))],
      viewpoints:[...new Set(m.specimens.flatMap(s=>s.images.map(i=>i.viewpoint)))],
      crop_types:[...new Set(m.specimens.flatMap(s=>s.images.map(i=>i.crop_type)))],
      visibility:[...new Set(m.specimens.flatMap(s=>s.images.map(i=>i.visibility)))],
      occlusion_conditions:[...new Set(m.specimens.flatMap(s=>s.images.map(i=>i.occlusion_condition)))],
      glare_conditions:[...new Set(m.specimens.flatMap(s=>s.images.map(i=>i.glare_condition)))],
    },
    ground_truth_policy:{independently_verified:true,same_sensor_self_label_forbidden:true,provenance_required:true},
  })

  const datasetValidation=validateSemanticCalibrationDataset(dataset)
  reasons.push(...datasetValidation.reason_codes)
  const nonProductionOnly=new Set([
    'synthetic_dataset_not_production_eligible',
    'synthetic_specimen_not_production_eligible',
  ])
  const fatal=reasons.some(r=>!nonProductionOnly.has(r))
  const manifest_sha_index=Object.fromEntries([...hashes].map(([h,a])=>[h,a.map(x=>x.image)]))
  if(fatal){
    return {accepted:false,dataset:null,reason_codes:[...new Set(reasons)],manifest_sha_index,immutable_manifest_digest_sha256:digest}
  }

  return {
    accepted:true,dataset,reason_codes:[...new Set(reasons)],
    manifest_sha_index,immutable_manifest_digest_sha256:digest,
  }
}
