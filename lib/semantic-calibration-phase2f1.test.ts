import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SEMANTIC_CALIBRATION_ACQUISITION_LEDGER_SCHEMA,
  SEMANTIC_CALIBRATION_CAPTURE_PROTOCOL_VERSION,
  finalizeSemanticCalibrationAcquisitionLedger,
  validateSemanticCalibrationAcquisitionLedger,
  type SemanticCalibrationAcquisitionLedgerV1,
} from './semantic-calibration-acquisition-v1'
import {
  SEMANTIC_CALIBRATION_CORPUS_MANIFEST_SCHEMA,
  type SemanticCalibrationCorpusManifest,
} from './semantic-calibration-corpus-ingest'
import {
  SEMANTIC_CALIBRATION_REAL_CORPUS_INTAKE_SCHEMA,
  intakeRealSemanticCalibrationCorpus,
  type SemanticCalibrationRealCorpusIntakeBundleV1,
} from './semantic-calibration-corpus-files'
import { sha256Canonical } from './semantic-calibration-digest'
import {
  ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS,
  PRODUCTION_SEMANTIC_CALIBRATION_DATASETS,
  SEMANTIC_CALIBRATION_REGISTRY,
} from './semantic-calibration-registry'
import {
  ACTIVE_SEMANTIC_CALIBRATION_POLICY,
  SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY,
} from './semantic-calibration-policy-v1'

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T

function pngBytes(width:number,height:number):Buffer{
  const buffer=Buffer.alloc(24)
  Buffer.from([137,80,78,71,13,10,26,10]).copy(buffer,0)
  buffer.writeUInt32BE(width,16)
  buffer.writeUInt32BE(height,20)
  return buffer
}

function sha256(bytes:Buffer):string{
  return createHash('sha256').update(bytes).digest('hex')
}

function writeImage(baseDir:string,fileName:string,width:number,height:number){
  const bytes=pngBytes(width,height)
  writeFileSync(join(baseDir,fileName),bytes)
  return {fileName,width,height,sha256:sha256(bytes)}
}

function validLedger(entries:SemanticCalibrationAcquisitionLedgerV1['entries']){
  return finalizeSemanticCalibrationAcquisitionLedger({
    schema_version:SEMANTIC_CALIBRATION_ACQUISITION_LEDGER_SCHEMA,
    ledger_id:'phase2f1-ledger',
    ledger_version:'1.0.0',
    created_at:'2026-10-03T00:00:00Z',
    capture_protocol_version:SEMANTIC_CALIBRATION_CAPTURE_PROTOCOL_VERSION,
    split_plan_id:'phase2f1-split-plan',
    split_plan_version:'1.0.0',
    entries,
  })
}

function acquisitionEntry(
  specimen_id:string,
  locked_split:'calibration'|'validation'='calibration',
):SemanticCalibrationAcquisitionLedgerV1['entries'][number]{
  return {
    specimen_id,
    acquisition_event_id:`acq-${specimen_id}`,
    acquired_at:'2026-10-02T00:00:00Z',
    source_class:'independent_real_image',
    material_origin:'physical_specimen',
    source_ref:`physical://${specimen_id}`,
    physical_identity_verified:true,
    physical_specimen_ref:`physical-specimen://${specimen_id}`,
    ground_truth_provenance_ref:`gt://${specimen_id}`,
    capture_protocol_version:SEMANTIC_CALIBRATION_CAPTURE_PROTOCOL_VERSION,
    locked_split,
    semantic_sensor_observation_started_at:null,
  }
}

function manifestBase():SemanticCalibrationCorpusManifest{
  return {
    schema_version:SEMANTIC_CALIBRATION_CORPUS_MANIFEST_SCHEMA,
    dataset_id:'phase2f1-candidate',
    dataset_version:'1.0.0',
    created_at:'2026-10-03T00:00:00Z',
    source_scope:'independent_real_image',
    source_provenance:{
      source_class:'independent_real_image',
      source_ref:'acquisition://phase2f1-ledger',
      independent_acquisition:true,
    },
    specimens:[],
    feature_scope:['drive.form'],
    sensor_scope:['vlm'],
  }
}

function specimen(
  specimen_id:string,
  image:{
    image_id:string
    sha256:string
    width:number
    height:number
    split:'calibration'|'validation'
  }|null,
){
  return {
    specimen_id,
    provenance:{
      source_class:'independent_real_image' as const,
      source_ref:`physical://${specimen_id}`,
      physical_identity_verified:true,
    },
    images:image?[{
      image_id:image.image_id,
      sha256:image.sha256,
      source_ref:`capture://${specimen_id}/image-1`,
      capture_type:'axial_head',
      viewpoint:'axial',
      crop_type:'full_image',
      width_px:image.width,
      height_px:image.height,
      visibility:'visible',
      occlusion_condition:'none',
      glare_condition:'none',
      split:image.split,
    }]:[],
    ground_truth:[{
      feature_id:'drive.form' as const,
      value:specimen_id==='spec-b'?'hex_socket':'external_hex',
      verification_method:'independent_physical_inspection',
      gt_source:`gt://${specimen_id}`,
      annotator_or_fixture_provenance:'independent-manual-verification',
      schema_version:'gt.v1',
      self_labeled_by_sensor:false,
    }],
  }
}

function validBundle(baseDir:string):SemanticCalibrationRealCorpusIntakeBundleV1{
  const image=writeImage(baseDir,'spec-a.png',512,384)
  const manifest=manifestBase()
  manifest.specimens=[specimen('spec-a',{
    image_id:'spec-a-image-1',
    sha256:image.sha256,
    width:image.width,
    height:image.height,
    split:'calibration',
  })]
  return {
    schema_version:SEMANTIC_CALIBRATION_REAL_CORPUS_INTAKE_SCHEMA,
    acquisition_ledger:validLedger([acquisitionEntry('spec-a')]),
    corpus_manifest:manifest,
    image_files:[{image_id:'spec-a-image-1',materialized_path:image.fileName}],
  }
}

const baseDir=mkdtempSync(join(tmpdir(),'hcsi-phase2f1-'))
try{
  // N1 — otherwise-valid acquisition ledger must never be empty.
  {
    const ledger=validLedger([])
    const result=validateSemanticCalibrationAcquisitionLedger(ledger)
    assert.equal(result.valid,false)
    assert.equal(result.specimen_count,0)
    assert.ok(result.reason_codes.includes('acquisition_ledger_empty'))
  }

  // N2 — valid real-corpus envelope with zero manifest specimens is rejected.
  {
    const manifest=manifestBase()
    const bundle:SemanticCalibrationRealCorpusIntakeBundleV1={
      schema_version:SEMANTIC_CALIBRATION_REAL_CORPUS_INTAKE_SCHEMA,
      acquisition_ledger:validLedger([acquisitionEntry('spec-a')]),
      corpus_manifest:manifest,
      image_files:[],
    }
    const result=intakeRealSemanticCalibrationCorpus(bundle,baseDir)
    assert.equal(result.accepted,false)
    assert.equal(result.dataset,null)
    assert.ok(result.reason_codes.includes('real_corpus_specimens_empty'))
  }

  // N3/N4 — a specimen with zero images fails both specimen and aggregate material invariants.
  {
    const manifest=manifestBase()
    manifest.specimens=[specimen('spec-a',null)]
    const bundle:SemanticCalibrationRealCorpusIntakeBundleV1={
      schema_version:SEMANTIC_CALIBRATION_REAL_CORPUS_INTAKE_SCHEMA,
      acquisition_ledger:validLedger([acquisitionEntry('spec-a')]),
      corpus_manifest:manifest,
      image_files:[],
    }
    const result=intakeRealSemanticCalibrationCorpus(bundle,baseDir)
    assert.equal(result.accepted,false)
    assert.equal(result.dataset,null)
    assert.ok(result.reason_codes.includes('specimen_images_empty'))
    assert.ok(result.reason_codes.includes('real_corpus_images_empty'))
  }

  // N5 — actual image material cannot have an empty manifest identity.
  {
    const bad=validBundle(baseDir)
    bad.corpus_manifest.specimens[0].images[0].image_id=''
    bad.image_files[0].image_id=''
    const result=intakeRealSemanticCalibrationCorpus(bad,baseDir)
    assert.equal(result.accepted,false)
    assert.equal(result.dataset,null)
    assert.ok(result.reason_codes.includes('image_id_missing'))
  }

  // N6 — file binding identity must also be non-empty.
  {
    const bad=validBundle(baseDir)
    bad.image_files[0].image_id=''
    const result=intakeRealSemanticCalibrationCorpus(bad,baseDir)
    assert.equal(result.accepted,false)
    assert.equal(result.dataset,null)
    assert.ok(result.reason_codes.includes('image_file_binding_id_missing'))
  }

  // Exploit regression — the exact Phase 2F zero-material bypass is closed end to end.
  {
    const bundle:SemanticCalibrationRealCorpusIntakeBundleV1={
      schema_version:SEMANTIC_CALIBRATION_REAL_CORPUS_INTAKE_SCHEMA,
      acquisition_ledger:validLedger([]),
      corpus_manifest:manifestBase(),
      image_files:[],
    }
    const result=intakeRealSemanticCalibrationCorpus(bundle,baseDir)
    assert.equal(result.accepted,false)
    assert.equal(result.dataset,null)
    assert.ok(result.reason_codes.includes('acquisition_ledger_empty'))
    assert.ok(result.reason_codes.includes('real_corpus_specimens_empty'))
    assert.ok(result.reason_codes.includes('real_corpus_images_empty'))
  }

  // P1/P5 — one non-empty stable image identity with exact file binding is accepted.
  {
    const bundle=validBundle(baseDir)
    assert.ok(bundle.corpus_manifest.specimens[0].images[0].image_id.trim().length>0)
    assert.equal(bundle.image_files[0].image_id,bundle.corpus_manifest.specimens[0].images[0].image_id)
    const result=intakeRealSemanticCalibrationCorpus(bundle,baseDir)
    assert.equal(result.accepted,true)
    assert.ok(result.dataset)
    assert.equal(result.dataset.specimens.length,1)
    assert.equal(result.dataset.specimens[0].images.length,1)
  }

  // P2 — multiple exact-byte images of one physical specimen remain valid in one locked split.
  {
    const bundle=validBundle(baseDir)
    const second=writeImage(baseDir,'spec-a-2.png',640,480)
    bundle.corpus_manifest.specimens[0].images.push({
      image_id:'spec-a-image-2',
      sha256:second.sha256,
      source_ref:'capture://spec-a/image-2',
      capture_type:'oblique_head',
      viewpoint:'oblique',
      crop_type:'full_image',
      width_px:second.width,
      height_px:second.height,
      visibility:'visible',
      occlusion_condition:'none',
      glare_condition:'low',
      split:'calibration',
    })
    bundle.image_files.push({image_id:'spec-a-image-2',materialized_path:second.fileName})
    const result=intakeRealSemanticCalibrationCorpus(bundle,baseDir)
    assert.equal(result.accepted,true)
    assert.ok(result.dataset)
    assert.equal(result.dataset.specimens[0].images.length,2)
  }

  // P3 — multiple physical specimens may be independently pre-locked to different splits.
  {
    const bundle=validBundle(baseDir)
    const second=writeImage(baseDir,'spec-b.png',800,600)
    bundle.corpus_manifest.specimens.push(specimen('spec-b',{
      image_id:'spec-b-image-1',
      sha256:second.sha256,
      width:second.width,
      height:second.height,
      split:'validation',
    }))
    bundle.acquisition_ledger=validLedger([
      acquisitionEntry('spec-a','calibration'),
      acquisitionEntry('spec-b','validation'),
    ])
    bundle.image_files.push({image_id:'spec-b-image-1',materialized_path:second.fileName})
    const result=intakeRealSemanticCalibrationCorpus(bundle,baseDir)
    assert.equal(result.accepted,true)
    assert.ok(result.dataset)
    assert.equal(result.dataset.specimens.length,2)
  }

  // P4 — canonical digest remains independent of object property insertion order.
  assert.equal(
    sha256Canonical({z:1,a:{q:2,b:3}}),
    sha256Canonical({a:{b:3,q:2},z:1}),
  )

  // Phase 2F.1 still does not fit, admit, or activate production calibration.
  assert.equal(PRODUCTION_SEMANTIC_CALIBRATION_DATASETS.length,0)
  assert.equal(ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS.length,0)
  assert.equal(SEMANTIC_CALIBRATION_REGISTRY.length,0)
  assert.equal(SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY.length,0)
  assert.equal(ACTIVE_SEMANTIC_CALIBRATION_POLICY,null)

  console.log('Phase 2F.1 non-empty real corpus material/identity regressions N1-N6 + exploit + P1-P5 passed')
}finally{
  rmSync(baseDir,{recursive:true,force:true})
}
// CI trigger: Build + Cases B-E validate this exact Phase 2F.1 final SHA.
