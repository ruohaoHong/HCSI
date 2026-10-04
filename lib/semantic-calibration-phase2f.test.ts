import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SEMANTIC_CALIBRATION_ACQUISITION_LEDGER_SCHEMA,
  SEMANTIC_CALIBRATION_CAPTURE_PROTOCOL_VERSION,
  finalizeSemanticCalibrationAcquisitionLedger,
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
import { buildSemanticCalibrationCorpusCoverageReport } from './semantic-calibration-corpus-coverage'
import { validateSemanticCalibrationDataset } from './semantic-calibration-dataset-v1'
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

function refinalizeLedger(ledger:SemanticCalibrationAcquisitionLedgerV1){
  const {ledger_content_digest_sha256:_digest,...draft}=ledger
  return finalizeSemanticCalibrationAcquisitionLedger(draft)
}

function oneSpecimenBundle(baseDir:string):SemanticCalibrationRealCorpusIntakeBundleV1{
  const image=writeImage(baseDir,'spec-a.png',512,384)
  const manifest:SemanticCalibrationCorpusManifest={
    schema_version:SEMANTIC_CALIBRATION_CORPUS_MANIFEST_SCHEMA,
    dataset_id:'phase2f-independent-candidate',
    dataset_version:'1.0.0',
    created_at:'2026-10-02T00:00:00Z',
    source_scope:'independent_real_image',
    source_provenance:{
      source_class:'independent_real_image',
      source_ref:'acquisition://phase2f-ledger',
      independent_acquisition:true,
    },
    feature_scope:['drive.form'],
    sensor_scope:['vlm'],
    specimens:[{
      specimen_id:'spec-a',
      provenance:{
        source_class:'independent_real_image',
        source_ref:'physical://spec-a',
        physical_identity_verified:true,
      },
      images:[{
        image_id:'spec-a-image-1',
        sha256:image.sha256,
        source_ref:'capture://spec-a/image-1',
        capture_type:'axial_head',
        viewpoint:'axial',
        crop_type:'full_image',
        width_px:image.width,
        height_px:image.height,
        visibility:'visible',
        occlusion_condition:'none',
        glare_condition:'none',
        split:'calibration',
      }],
      ground_truth:[{
        feature_id:'drive.form',
        value:'external_hex',
        verification_method:'independent_physical_inspection',
        gt_source:'gt://spec-a',
        annotator_or_fixture_provenance:'independent-manual-verification',
        schema_version:'gt.v1',
        self_labeled_by_sensor:false,
      }],
    }],
  }
  const acquisition_ledger=finalizeSemanticCalibrationAcquisitionLedger({
    schema_version:SEMANTIC_CALIBRATION_ACQUISITION_LEDGER_SCHEMA,
    ledger_id:'phase2f-ledger',
    ledger_version:'1.0.0',
    created_at:'2026-10-02T00:00:00Z',
    capture_protocol_version:SEMANTIC_CALIBRATION_CAPTURE_PROTOCOL_VERSION,
    split_plan_id:'phase2f-split-plan',
    split_plan_version:'1.0.0',
    entries:[{
      specimen_id:'spec-a',
      acquisition_event_id:'acq-spec-a',
      acquired_at:'2026-10-01T00:00:00Z',
      source_class:'independent_real_image',
      material_origin:'physical_specimen',
      source_ref:'physical://spec-a',
      physical_identity_verified:true,
      physical_specimen_ref:'physical-specimen://spec-a',
      ground_truth_provenance_ref:'gt://spec-a',
      capture_protocol_version:SEMANTIC_CALIBRATION_CAPTURE_PROTOCOL_VERSION,
      locked_split:'calibration',
      semantic_sensor_observation_started_at:null,
    }],
  })
  return {
    schema_version:SEMANTIC_CALIBRATION_REAL_CORPUS_INTAKE_SCHEMA,
    acquisition_ledger,
    corpus_manifest:manifest,
    image_files:[{image_id:'spec-a-image-1',materialized_path:image.fileName}],
  }
}

function addSecondImageSameSpecimen(
  baseDir:string,
  bundle:SemanticCalibrationRealCorpusIntakeBundleV1,
){
  const image=writeImage(baseDir,'spec-a-2.png',640,480)
  bundle.corpus_manifest.specimens[0].images.push({
    image_id:'spec-a-image-2',
    sha256:image.sha256,
    source_ref:'capture://spec-a/image-2',
    capture_type:'oblique_head',
    viewpoint:'oblique',
    crop_type:'full_image',
    width_px:image.width,
    height_px:image.height,
    visibility:'visible',
    occlusion_condition:'none',
    glare_condition:'low',
    split:'calibration',
  })
  bundle.image_files.push({image_id:'spec-a-image-2',materialized_path:image.fileName})
}

function addValidationSpecimen(
  baseDir:string,
  bundle:SemanticCalibrationRealCorpusIntakeBundleV1,
){
  const image=writeImage(baseDir,'spec-b.png',800,600)
  bundle.corpus_manifest.specimens.push({
    specimen_id:'spec-b',
    provenance:{
      source_class:'independent_real_image',
      source_ref:'physical://spec-b',
      physical_identity_verified:true,
    },
    images:[{
      image_id:'spec-b-image-1',
      sha256:image.sha256,
      source_ref:'capture://spec-b/image-1',
      capture_type:'axial_head',
      viewpoint:'axial',
      crop_type:'full_image',
      width_px:image.width,
      height_px:image.height,
      visibility:'visible',
      occlusion_condition:'none',
      glare_condition:'none',
      split:'validation',
    }],
    ground_truth:[{
      feature_id:'drive.form',
      value:'hex_socket',
      verification_method:'independent_physical_inspection',
      gt_source:'gt://spec-b',
      annotator_or_fixture_provenance:'independent-manual-verification',
      schema_version:'gt.v1',
      self_labeled_by_sensor:false,
    }],
  })
  const ledger=bundle.acquisition_ledger
  const {ledger_content_digest_sha256:_digest,...draft}=ledger
  bundle.acquisition_ledger=finalizeSemanticCalibrationAcquisitionLedger({
    ...draft,
    entries:[
      ...draft.entries,
      {
        specimen_id:'spec-b',
        acquisition_event_id:'acq-spec-b',
        acquired_at:'2026-10-01T01:00:00Z',
        source_class:'independent_real_image',
        material_origin:'physical_specimen',
        source_ref:'physical://spec-b',
        physical_identity_verified:true,
        physical_specimen_ref:'physical-specimen://spec-b',
        ground_truth_provenance_ref:'gt://spec-b',
        capture_protocol_version:SEMANTIC_CALIBRATION_CAPTURE_PROTOCOL_VERSION,
        locked_split:'validation',
        semantic_sensor_observation_started_at:null,
      },
    ],
  })
  bundle.image_files.push({image_id:'spec-b-image-1',materialized_path:image.fileName})
}

const baseDir=mkdtempSync(join(tmpdir(),'hcsi-phase2f-'))
try{
  // P1 — valid independently acquired specimen + independent GT + exact bytes.
  const base=oneSpecimenBundle(baseDir)
  const accepted=intakeRealSemanticCalibrationCorpus(base,baseDir)
  assert.equal(accepted.accepted,true)
  assert.ok(accepted.dataset)
  assert.equal(accepted.file_verification.length,1)
  assert.equal(accepted.file_verification[0].verified,true)

  const coverage=buildSemanticCalibrationCorpusCoverageReport(accepted.dataset)
  assert.equal(coverage.specimen_count,1)
  assert.equal(coverage.image_count,1)
  assert.equal(coverage.ground_truth_count,1)
  assert.equal(coverage.per_feature_gt_class_counts['drive.form'].external_hex,1)
  assert.equal(coverage.per_split.calibration.specimen_count,1)
  assert.equal(coverage.semantics,'descriptive_inventory_only_not_production_sufficiency')
  assert.equal('accuracy' in (coverage as any),false)
  assert.equal('confusion_matrix' in (coverage as any),false)
  assert.equal('brier_score' in (coverage as any),false)

  // A1 — synthetic material cannot be laundered by relabeling source_class real.
  {
    const bad=clone(base)
    bad.acquisition_ledger.entries[0].material_origin='synthetic_image'
    bad.acquisition_ledger=refinalizeLedger(bad.acquisition_ledger)
    const result=intakeRealSemanticCalibrationCorpus(bad,baseDir)
    assert.equal(result.accepted,false)
    assert.ok(result.reason_codes.includes('synthetic_source_laundering_forbidden'))
  }

  // A2 — regression fixture cannot be laundered as independent real acquisition.
  {
    const bad=clone(base)
    bad.acquisition_ledger.entries[0].material_origin='regression_fixture'
    bad.acquisition_ledger=refinalizeLedger(bad.acquisition_ledger)
    const result=intakeRealSemanticCalibrationCorpus(bad,baseDir)
    assert.equal(result.accepted,false)
    assert.ok(result.reason_codes.includes('fixture_source_laundering_forbidden'))
  }

  // A3 — physical identity must have been independently verified.
  {
    const bad=clone(base)
    bad.acquisition_ledger.entries[0].physical_identity_verified=false
    bad.acquisition_ledger=refinalizeLedger(bad.acquisition_ledger)
    bad.corpus_manifest.specimens[0].provenance.physical_identity_verified=false
    const result=intakeRealSemanticCalibrationCorpus(bad,baseDir)
    assert.equal(result.accepted,false)
    assert.ok(result.reason_codes.includes('physical_specimen_identity_unverified'))
  }

  // A4 — same semantic sensor cannot self-label calibration GT.
  {
    const bad=clone(base)
    bad.corpus_manifest.specimens[0].ground_truth[0].self_labeled_by_sensor=true
    const result=intakeRealSemanticCalibrationCorpus(bad,baseDir)
    assert.equal(result.accepted,false)
    assert.ok(result.reason_codes.includes('ground_truth_self_label_forbidden'))
  }

  // A5 — semantic GT must use the canonical feature taxonomy.
  {
    const bad=clone(base)
    bad.corpus_manifest.specimens[0].ground_truth[0].value='M14'
    const result=intakeRealSemanticCalibrationCorpus(bad,baseDir)
    assert.equal(result.accepted,false)
    assert.ok(result.reason_codes.includes('invalid_ground_truth_value'))
  }

  // A6 — specimen identity is unique in the immutable manifest.
  {
    const bad=clone(base)
    const duplicate=clone(bad.corpus_manifest.specimens[0])
    duplicate.images=[]
    duplicate.ground_truth=clone(bad.corpus_manifest.specimens[0].ground_truth)
    bad.corpus_manifest.specimens.push(duplicate)
    const result=intakeRealSemanticCalibrationCorpus(bad,baseDir)
    assert.equal(result.accepted,false)
    assert.ok(result.reason_codes.includes('duplicate_specimen_id'))
  }

  // A7 — exact bytes cannot appear twice under different image identity.
  {
    const bad=clone(base)
    const same=bad.corpus_manifest.specimens[0].images[0]
    bad.corpus_manifest.specimens[0].images.push({...same,image_id:'duplicate-sha-image'})
    bad.image_files.push({image_id:'duplicate-sha-image',materialized_path:'spec-a.png'})
    const result=intakeRealSemanticCalibrationCorpus(bad,baseDir)
    assert.equal(result.accepted,false)
    assert.ok(result.reason_codes.includes('duplicate_image_sha256'))
  }

  // A8 — physical specimen is the split unit and cannot cross calibration/validation.
  {
    const bad=clone(base)
    addSecondImageSameSpecimen(baseDir,bad)
    bad.corpus_manifest.specimens[0].images[1].split='validation'
    const result=intakeRealSemanticCalibrationCorpus(bad,baseDir)
    assert.equal(result.accepted,false)
    assert.ok(result.reason_codes.includes('specimen_split_leakage'))
    assert.ok(result.reason_codes.includes('specimen_split_differs_from_acquisition_lock'))
  }

  // A9 — manifest SHA never overrides actual file bytes.
  {
    const bad=clone(base)
    bad.corpus_manifest.specimens[0].images[0].sha256='0'.repeat(64)
    const result=intakeRealSemanticCalibrationCorpus(bad,baseDir)
    assert.equal(result.accepted,false)
    assert.ok(result.reason_codes.includes('actual_image_sha256_mismatch'))
  }

  // A10 — manifest dimensions never override decoded actual bytes.
  {
    const bad=clone(base)
    bad.corpus_manifest.specimens[0].images[0].width_px=4000
    bad.corpus_manifest.specimens[0].images[0].height_px=3000
    const result=intakeRealSemanticCalibrationCorpus(bad,baseDir)
    assert.equal(result.accepted,false)
    assert.ok(result.reason_codes.includes('actual_image_dimensions_mismatch'))
  }

  // A11 — immutable acquisition evidence must contain physical + GT provenance.
  {
    const bad=clone(base)
    bad.acquisition_ledger.entries[0].physical_specimen_ref=''
    bad.acquisition_ledger.entries[0].ground_truth_provenance_ref=''
    bad.acquisition_ledger=refinalizeLedger(bad.acquisition_ledger)
    const result=intakeRealSemanticCalibrationCorpus(bad,baseDir)
    assert.equal(result.accepted,false)
    assert.ok(result.reason_codes.includes('acquisition_provenance_missing'))
  }

  // A12 — persisted dataset content cannot mutate under a stale content digest.
  {
    const stale=clone(accepted.dataset)
    stale.specimens[0].ground_truth[0].value='hex_socket'
    const validation=validateSemanticCalibrationDataset(stale)
    assert.equal(validation.valid,false)
    assert.ok(validation.reason_codes.includes('dataset_content_digest_mismatch'))
  }

  // P2 — multiple exact-byte images of one physical specimen remain in one locked split.
  {
    const bundle=oneSpecimenBundle(baseDir)
    addSecondImageSameSpecimen(baseDir,bundle)
    const result=intakeRealSemanticCalibrationCorpus(bundle,baseDir)
    assert.equal(result.accepted,true)
    assert.ok(result.dataset)
    assert.equal(result.dataset.specimens[0].images.length,2)
    assert.ok(result.dataset.specimens[0].images.every(image=>image.split==='calibration'))
  }

  // P3 — different physical specimens may be pre-locked into different splits.
  {
    const bundle=oneSpecimenBundle(baseDir)
    addValidationSpecimen(baseDir,bundle)
    const result=intakeRealSemanticCalibrationCorpus(bundle,baseDir)
    assert.equal(result.accepted,true)
    assert.ok(result.dataset)
    const report=buildSemanticCalibrationCorpusCoverageReport(result.dataset)
    assert.equal(report.per_split.calibration.specimen_count,1)
    assert.equal(report.per_split.validation.specimen_count,1)
  }

  // P4 — object property insertion order does not change immutable manifest digest.
  {
    const m1=clone(base.corpus_manifest)
    const m2={
      sensor_scope:m1.sensor_scope,
      feature_scope:m1.feature_scope,
      specimens:m1.specimens,
      source_provenance:m1.source_provenance,
      source_scope:m1.source_scope,
      created_at:m1.created_at,
      dataset_version:m1.dataset_version,
      dataset_id:m1.dataset_id,
      schema_version:m1.schema_version,
    } as SemanticCalibrationCorpusManifest
    assert.equal(sha256Canonical(m1),sha256Canonical(m2))
  }

  // Phase 2F does not fit, admit, or activate any production calibration authority.
  assert.equal(PRODUCTION_SEMANTIC_CALIBRATION_DATASETS.length,0)
  assert.equal(ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS.length,0)
  assert.equal(SEMANTIC_CALIBRATION_REGISTRY.length,0)
  assert.equal(SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY.length,1)
  assert.equal(ACTIVE_SEMANTIC_CALIBRATION_POLICY?.status,'preregistered')

  console.log('Phase 2F real specimen acquisition/intake regressions A1-A12 + P1-P4 passed')
}finally{
  rmSync(baseDir,{recursive:true,force:true})
}
