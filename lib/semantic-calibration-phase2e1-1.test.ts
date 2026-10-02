import { strict as assert } from 'node:assert'
import {
  SEMANTIC_CALIBRATION_CORPUS_MANIFEST_SCHEMA,
  ingestSemanticCalibrationCorpus,
  type SemanticCalibrationCorpusManifest,
} from './semantic-calibration-corpus-ingest'
import {
  semanticCalibrationDatasetContentDigest,
  validateSemanticCalibrationDataset,
} from './semantic-calibration-dataset-v1'
import {
  SEMANTIC_SENSOR_OBSERVATION_RECORD_SCHEMA,
  validateSemanticSensorObservationRecordV1,
  type SemanticSensorObservationRecordV1,
} from './semantic-sensor-observation-record-v1'
import {
  fitSemanticCalibrationArtifact,
  type CalibrationEstimatorConfigV1,
} from './semantic-calibration-fit'
import { buildSemanticCalibrationArtifactFromFit } from './semantic-calibration-v1'
import { validateCalibrationArtifact } from './semantic-calibration-validation'
import { buildSemanticRuntimeQuality } from './semantic-runtime-quality'
import { sha256Canonical } from './semantic-calibration-digest'
import { SEMANTIC_TAXONOMY_VERSION } from './semantic-taxonomy-v1'

const hash=(n:number)=>n.toString(16).padStart(64,'0')
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T

function manifest():SemanticCalibrationCorpusManifest{
  return {
    schema_version:SEMANTIC_CALIBRATION_CORPUS_MANIFEST_SCHEMA,
    dataset_id:'phase2e1-1-in-memory-only',
    dataset_version:'1.0.0',
    created_at:'2026-10-02T00:00:00Z',
    source_scope:'synthetic_test',
    source_provenance:{
      source_class:'synthetic_test',
      source_ref:'memory://phase2e1-1',
      independent_acquisition:false,
    },
    feature_scope:['drive.form'],
    sensor_scope:['vlm'],
    specimens:[
      {
        specimen_id:'cal-a',
        provenance:{source_class:'synthetic_test',source_ref:'memory://cal-a',physical_identity_verified:true},
        images:[{
          image_id:'cal-a-image',sha256:hash(1),source_ref:'memory://cal-a-image',
          capture_type:'axial_head',viewpoint:'axial',crop_type:'full_image',
          width_px:512,height_px:512,visibility:'visible',
          occlusion_condition:'none',glare_condition:'none',split:'calibration',
        }],
        ground_truth:[{
          feature_id:'drive.form',value:'external_hex',verification_method:'fixture_assertion',
          gt_source:'in-memory-only',annotator_or_fixture_provenance:'phase2e1-1',
          schema_version:'gt.v1',self_labeled_by_sensor:false,
        }],
      },
      {
        specimen_id:'cal-b',
        provenance:{source_class:'synthetic_test',source_ref:'memory://cal-b',physical_identity_verified:true},
        images:[{
          image_id:'cal-b-image',sha256:hash(2),source_ref:'memory://cal-b-image',
          capture_type:'axial_head',viewpoint:'axial',crop_type:'full_image',
          width_px:512,height_px:512,visibility:'visible',
          occlusion_condition:'none',glare_condition:'none',split:'calibration',
        }],
        ground_truth:[{
          feature_id:'drive.form',value:'hex_socket',verification_method:'fixture_assertion',
          gt_source:'in-memory-only',annotator_or_fixture_provenance:'phase2e1-1',
          schema_version:'gt.v1',self_labeled_by_sensor:false,
        }],
      },
      {
        specimen_id:'val-a',
        provenance:{source_class:'synthetic_test',source_ref:'memory://val-a',physical_identity_verified:true},
        images:[{
          image_id:'val-a-image',sha256:hash(3),source_ref:'memory://val-a-image',
          capture_type:'axial_head',viewpoint:'axial',crop_type:'full_image',
          width_px:512,height_px:512,visibility:'visible',
          occlusion_condition:'none',glare_condition:'none',split:'validation',
        }],
        ground_truth:[{
          feature_id:'drive.form',value:'external_hex',verification_method:'fixture_assertion',
          gt_source:'in-memory-only',annotator_or_fixture_provenance:'phase2e1-1',
          schema_version:'gt.v1',self_labeled_by_sensor:false,
        }],
      },
    ],
  }
}

const estimator:CalibrationEstimatorConfigV1={
  config_id:'phase2e1-1-confusion',
  config_version:'v1',
  feature_id:'drive.form',
  sensor_identity:{
    sensor_type:'vlm',model:'mock-vlm',model_version:'v1',
    prompt_version:'prompt-v1',extractor_version:'extractor-v1',
    taxonomy_version:SEMANTIC_TAXONOMY_VERSION,
  },
  estimator:{method:'categorical_confusion_counts',smoothing:'none'},
  eligibility_policy_version:null,
  locked:true,
}

function record(
  specimen_id:string,
  image_id:string,
  image_sha256:string,
  run_id:string,
  overrides:Partial<SemanticSensorObservationRecordV1>={},
):SemanticSensorObservationRecordV1{
  return {
    schema_version:SEMANTIC_SENSOR_OBSERVATION_RECORD_SCHEMA,
    specimen_id,image_id,feature_id:'drive.form',
    observation_stage:'candidate_blind_first_pass',
    sensor_type:'vlm',model:'mock-vlm',model_version:'v1',
    prompt_version:'prompt-v1',extractor_version:'extractor-v1',
    taxonomy_version:SEMANTIC_TAXONOMY_VERSION,
    value:'external_hex',state:'observed',visibility:'visible',raw_score:null,
    observed_at:'2026-10-02T00:00:00Z',run_id,image_sha256,
    crop_ref:'full_image_1',independence_group:'full_image_1',
    ground_truth_in_prompt:false,
    ...overrides,
  }
}

function pngBase64(width:number,height:number):string{
  const buffer=Buffer.alloc(24)
  Buffer.from([137,80,78,71,13,10,26,10]).copy(buffer,0)
  buffer.writeUInt32BE(width,16)
  buffer.writeUInt32BE(height,20)
  return buffer.toString('base64')
}

function expectGeometryConflict(fn:()=>unknown,reason:RegExp){
  assert.throws(fn,reason)
}

const ingest=ingestSemanticCalibrationCorpus(manifest())
assert.equal(ingest.accepted,true)
assert.ok(ingest.dataset)
const dataset=ingest.dataset

// A1 — valid normalized dataset content verifies its own cryptographic identity.
{
  const result=validateSemanticCalibrationDataset(dataset)
  assert.equal(result.valid,true)
  assert.match(dataset.dataset_content_digest_sha256,/^[a-f0-9]{64}$/)
  assert.equal(dataset.dataset_content_digest_sha256,semanticCalibrationDatasetContentDigest(dataset))
}

// A2 — GT mutation with stale dataset content digest fails closed.
{
  const mutated=clone(dataset)
  mutated.specimens[0].ground_truth[0].value='hex_socket'
  const result=validateSemanticCalibrationDataset(mutated)
  assert.equal(result.valid,false)
  assert.ok(result.reason_codes.includes('dataset_content_digest_mismatch'))
}

// A3a — split mutation with stale digest fails closed.
{
  const mutated=clone(dataset)
  mutated.specimens[0].images[0].split='fit'
  const result=validateSemanticCalibrationDataset(mutated)
  assert.equal(result.valid,false)
  assert.ok(result.reason_codes.includes('dataset_content_digest_mismatch'))
}

// A3b — provenance mutation with stale digest fails closed.
{
  const mutated=clone(dataset)
  mutated.specimens[0].provenance.source_ref='memory://tampered-provenance'
  const result=validateSemanticCalibrationDataset(mutated)
  assert.equal(result.valid,false)
  assert.ok(result.reason_codes.includes('dataset_content_digest_mismatch'))
}

// A3c — capture-condition mutation with stale digest fails closed.
{
  const mutated=clone(dataset)
  mutated.capture_conditions.viewpoints=['side']
  const result=validateSemanticCalibrationDataset(mutated)
  assert.equal(result.valid,false)
  assert.ok(result.reason_codes.includes('dataset_content_digest_mismatch'))
}

// A4 — canonical object property insertion order does not change digest.
assert.equal(
  sha256Canonical({z:1,a:{q:2,b:3}}),
  sha256Canonical({a:{b:3,q:2},z:1}),
)

const calA=record('cal-a','cal-a-image',hash(1),'cal-a-run')
const valA=record('val-a','val-a-image',hash(3),'val-a-run')

// B1 — exact specimen/image/hash/calibration split is accepted for fit.
const fit=fitSemanticCalibrationArtifact(dataset,[calA],estimator)
assert.equal(fit.status,'candidate_artifact')
assert.deepEqual(fit.calibration_record_ids,['cal-a-run'])

// B2 — specimen A + image hash B cannot be cross-bound.
{
  const bad=record('cal-a','cal-a-image',hash(2),'cross-hash-run')
  const result=fitSemanticCalibrationArtifact(dataset,[bad],estimator)
  assert.equal(result.status,'insufficient_data')
  assert.ok(result.reason_codes.includes('observation_dataset_image_binding_mismatch'))
}

// B3 — correct specimen/hash with wrong image_id cannot bind.
{
  const bad=record('cal-a','wrong-image-id',hash(1),'wrong-image-run')
  const result=fitSemanticCalibrationArtifact(dataset,[bad],estimator)
  assert.equal(result.status,'insufficient_data')
  assert.ok(result.reason_codes.includes('observation_dataset_image_binding_mismatch'))
}

// B4 — validation split image cannot be consumed by calibration fit.
{
  const result=fitSemanticCalibrationArtifact(dataset,[valA],estimator)
  assert.equal(result.status,'insufficient_data')
  assert.ok(result.reason_codes.includes('calibration_record_split_mismatch'))
}

const artifact=buildSemanticCalibrationArtifactFromFit(fit,{
  calibration_id:'phase2e1-1-artifact',
  version:'1.0.0',
  status:'validated',
  calibration_method:{method_id:'categorical_confusion_counts',method_version:'v1'},
  applicability_scope:{
    visibility:['visible'],capture_types:['axial_head'],viewpoints:['axial'],crop_types:['full_image'],
    resolution:{min_width_px:256,min_height_px:256,max_width_px:null,max_height_px:null},
    occlusion_conditions:['none'],glare_conditions:['none'],
  },
  metrics:{brier_score:null,log_loss:null,ece:null,ece_policy_version:null,sample_count:1,per_class_support:{external_hex:1}},
  eligibility_policy_version:null,
})

// B5 — calibration split image cannot be consumed by held-out validation.
{
  const result=validateCalibrationArtifact(artifact,fit,dataset,[calA])
  assert.equal(result.status,'insufficient_validation')
  assert.ok(result.reason_codes.includes('validation_record_split_mismatch'))
}

// Exact held-out validation remains valid.
{
  const result=validateCalibrationArtifact(artifact,fit,dataset,[valA])
  assert.equal(result.status,'validated')
  assert.deepEqual(result.validation_record_ids,['val-a-run'])
}

// B6 — duplicate run_id is rejected instead of double-counted.
{
  const second=record('cal-b','cal-b-image',hash(2),'duplicate-run')
  const first=record('cal-a','cal-a-image',hash(1),'duplicate-run')
  const result=fitSemanticCalibrationArtifact(dataset,[first,second],estimator)
  assert.equal(result.status,'insufficient_data')
  assert.ok(result.reason_codes.includes('duplicate_observation_run_id'))
}

// C1-C6 — external runtime records must pass canonical schema/taxonomy validation.
const invalidCases:Array<[string,SemanticSensorObservationRecordV1,string]> = [
  ['invalid feature',record('cal-a','cal-a-image',hash(1),'invalid-feature',{feature_id:'made.up' as any}),'observation_feature_id_invalid'],
  ['invalid taxonomy value',record('cal-a','cal-a-image',hash(1),'invalid-value',{value:'M14'}),'observation_taxonomy_value_invalid'],
  ['invalid state',record('cal-a','cal-a-image',hash(1),'invalid-state',{state:'maybe' as any}),'observation_state_invalid'],
  ['invalid visibility',record('cal-a','cal-a-image',hash(1),'invalid-visibility',{visibility:'crystal_clear' as any}),'observation_visibility_invalid'],
  ['invalid sensor',record('cal-a','cal-a-image',hash(1),'invalid-sensor',{sensor_type:'magic_sensor' as any}),'observation_sensor_type_invalid'],
  ['invalid schema',record('cal-a','cal-a-image',hash(1),'invalid-schema',{schema_version:'hcsi.semantic-sensor-observation-record.v9' as any}),'observation_schema_mismatch'],
]
for(const [label,bad,reason] of invalidCases){
  const validation=validateSemanticSensorObservationRecordV1(bad)
  assert.equal(validation.valid,false,label)
  assert.ok(validation.reason_codes.includes(reason),label)
  const fitResult=fitSemanticCalibrationArtifact(dataset,[bad],estimator)
  assert.equal(fitResult.status,'insufficient_data',label)
  assert.ok(fitResult.reason_codes.includes('invalid_observation_record'),label)
  assert.ok(fitResult.reason_codes.includes(reason),label)
}

// Invalid held-out taxonomy cannot enter scoring either.
{
  const bad=record('val-a','val-a-image',hash(3),'bad-heldout',{value:'M14'})
  const result=validateCalibrationArtifact(artifact,fit,dataset,[bad])
  assert.equal(result.status,'insufficient_validation')
  assert.ok(result.reason_codes.includes('invalid_observation_record'))
  assert.ok(result.reason_codes.includes('observation_taxonomy_value_invalid'))
}

// D1 — full-image bytes are the effective geometry.
{
  const q=buildSemanticRuntimeQuality('visible',{
    source_image_base64:pngBase64(4000,3000),
    observation_image_base64:pngBase64(4000,3000),
    observation_region_type:'full_image',
  })
  assert.equal(q.width_px,4000)
  assert.equal(q.height_px,3000)
}

// D2 — physical crop uses actual crop bytes, never source-image dimensions.
{
  const q=buildSemanticRuntimeQuality('visible',{
    source_image_base64:pngBase64(4000,3000),
    observation_image_base64:pngBase64(100,80),
    observation_region_type:'physical_crop_input',
  })
  assert.equal(q.width_px,100)
  assert.equal(q.height_px,80)
}

// D3 — conflicting explicit effective dimensions cannot override actual crop bytes.
expectGeometryConflict(()=>buildSemanticRuntimeQuality('visible',{
  source_image_base64:pngBase64(4000,3000),
  observation_image_base64:pngBase64(100,80),
  observation_region_type:'physical_crop_input',
  width_px:4000,height_px:3000,
}),/semantic_observation_geometry_conflict:effective_width_mismatch/)

// D4 — ROI reference remains full-image geometry when provider received full bytes.
{
  const q=buildSemanticRuntimeQuality('visible',{
    source_image_base64:pngBase64(4000,3000),
    observation_image_base64:pngBase64(4000,3000),
    observation_region_type:'full_image_with_roi_reference',
    observation_bbox_px:{x_px:100,y_px:100,width_px:100,height_px:80},
  })
  assert.equal(q.width_px,4000)
  assert.equal(q.height_px,3000)
  assert.equal(q.pixel_geometry!.observation_region_type,'full_image_with_roi_reference')
}

// D5 — unknown geometry remains unavailable/fail-closed.
{
  const q=buildSemanticRuntimeQuality('visible',{observation_region_type:'unknown'})
  assert.equal(q.width_px,null)
  assert.equal(q.height_px,null)
}

// D6 — resize metadata cannot claim a resize that the actual bytes contradict.
expectGeometryConflict(()=>buildSemanticRuntimeQuality('visible',{
  source_image_base64:pngBase64(4000,3000),
  observation_image_base64:pngBase64(100,80),
  observation_region_type:'physical_crop_input',
  resize_target:{width_px:256,height_px:256},
}),/semantic_observation_geometry_conflict:resize_target_mismatch/)

console.log('Phase 2E.1.1 calibration data binding & effective geometry closure regressions passed')
