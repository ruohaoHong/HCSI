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
  type SemanticSensorObservationRecordV1,
} from './semantic-sensor-observation-record-v1'
import {
  fitSemanticCalibrationArtifact,
  type CalibrationEstimatorConfigV1,
} from './semantic-calibration-fit'
import { buildSemanticCalibrationArtifactFromFit } from './semantic-calibration-v1'
import { validateCalibrationArtifact } from './semantic-calibration-validation'
import { assessCalibrationArtifactAdmission } from './semantic-calibration-admission'
import {
  SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_SCHEMA,
  type SemanticCalibrationEligibilityPolicyV1,
  ACTIVE_SEMANTIC_CALIBRATION_POLICY,
  SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY,
} from './semantic-calibration-policy-v1'
import {
  ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS,
  PRODUCTION_SEMANTIC_CALIBRATION_DATASETS,
  SEMANTIC_CALIBRATION_REGISTRY,
} from './semantic-calibration-registry'
import { SEMANTIC_TAXONOMY_VERSION } from './semantic-taxonomy-v1'

const hash=(n:number)=>n.toString(16).padStart(64,'0')
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T

function productionLikeManifest():SemanticCalibrationCorpusManifest{
  const commonGt={
    feature_id:'drive.form' as const,
    value:'external_hex',
    verification_method:'deterministic_test_fixture_assertion',
    gt_source:'independent-test-ledger',
    annotator_or_fixture_provenance:'phase2e1-2-in-memory',
    schema_version:'gt.v1',
    self_labeled_by_sensor:false,
  }
  return {
    schema_version:SEMANTIC_CALIBRATION_CORPUS_MANIFEST_SCHEMA,
    dataset_id:'phase2e1-2-production-like',
    dataset_version:'1.0.0',
    created_at:'2026-10-02T00:00:00Z',
    source_scope:'independent_real_image',
    source_provenance:{
      source_class:'independent_real_image',
      source_ref:'memory://phase2e1-2-independent-ledger',
      independent_acquisition:true,
    },
    feature_scope:['drive.form'],
    sensor_scope:['vlm'],
    specimens:[
      {
        specimen_id:'cal-a',
        provenance:{source_class:'independent_real_image',source_ref:'memory://cal-a',physical_identity_verified:true},
        images:[{
          image_id:'cal-a-image',sha256:hash(1),source_ref:'memory://cal-a-image',
          capture_type:'axial_head',viewpoint:'axial',crop_type:'full_image',
          width_px:512,height_px:512,visibility:'visible',
          occlusion_condition:'none',glare_condition:'none',split:'calibration',
        }],
        ground_truth:[{...commonGt}],
      },
      {
        specimen_id:'cal-b',
        provenance:{source_class:'independent_real_image',source_ref:'memory://cal-b',physical_identity_verified:true},
        images:[{
          image_id:'cal-b-image',sha256:hash(2),source_ref:'memory://cal-b-image',
          capture_type:'axial_head',viewpoint:'axial',crop_type:'full_image',
          width_px:512,height_px:512,visibility:'visible',
          occlusion_condition:'none',glare_condition:'none',split:'calibration',
        }],
        ground_truth:[{...commonGt,value:'hex_socket'}],
      },
      {
        specimen_id:'val-a',
        provenance:{source_class:'independent_real_image',source_ref:'memory://val-a',physical_identity_verified:true},
        images:[{
          image_id:'val-a-image',sha256:hash(3),source_ref:'memory://val-a-image',
          capture_type:'axial_head',viewpoint:'axial',crop_type:'full_image',
          width_px:512,height_px:512,visibility:'visible',
          occlusion_condition:'none',glare_condition:'none',split:'validation',
        }],
        ground_truth:[{...commonGt}],
      },
    ],
  }
}

const estimator:CalibrationEstimatorConfigV1={
  config_id:'phase2e1-2-confusion',
  config_version:'v1',
  feature_id:'drive.form',
  sensor_identity:{
    sensor_type:'vlm',
    model:'mock-vlm',
    model_version:'v1',
    prompt_version:'prompt-v1',
    extractor_version:'extractor-v1',
    taxonomy_version:SEMANTIC_TAXONOMY_VERSION,
  },
  estimator:{method:'categorical_confusion_counts',smoothing:'none'},
  eligibility_policy_version:'phase2e1-2-policy-v1',
  locked:true,
}

function policy():SemanticCalibrationEligibilityPolicyV1{
  return {
    schema_version:SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_SCHEMA,
    policy_id:'phase2e1-2-policy',
    policy_version:'phase2e1-2-policy-v1',
    status:'preregistered',
    created_at:'2026-10-02T00:00:00Z',
    locked_at:'2026-10-02T00:00:00Z',
    applicable_dataset_schema:'hcsi.semantic-calibration-dataset.v1',
    applicable_calibration_schema:'hcsi.semantic-calibration.v1',
    allowed_source_scopes:['independent_real_image'],
    required_split_policy:{unit:'physical_specimen',calibration_required:true,validation_required:true},
    required_gt_policy:{independently_verified:true,same_sensor_self_label_forbidden:true,provenance_required:true},
    minimum_support:{sample_count:null,per_class:null},
    metric_requirements:{max_brier_score:null,max_log_loss:null,max_ece:null},
    quality_coverage_requirements:{required:false,description:'deterministic in-memory admission boundary test'},
    artifact_identity_requirements:{exact_sensor_identity:true,exact_feature:true,exact_taxonomy:true},
    admission_rules:['explicit_registry_update_required'],
    change_control:{requires_new_version:true,validation_set_must_not_tune_estimator:true},
  }
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

const ingest=ingestSemanticCalibrationCorpus(productionLikeManifest())
assert.equal(ingest.accepted,true)
assert.ok(ingest.dataset)
const dataset=ingest.dataset
const oldDatasetValidation=validateSemanticCalibrationDataset(dataset)
assert.equal(oldDatasetValidation.valid,true)
assert.equal(oldDatasetValidation.production_eligible_source,true)

const calA=record('cal-a','cal-a-image',hash(1),'cal-a-run')
const calBIrrelevant=record('cal-b','cal-b-image',hash(2),'cal-b-other-model',{model:'other-model',value:'hex_socket'})
const valA=record('val-a','val-a-image',hash(3),'val-a-run')

const fit=fitSemanticCalibrationArtifact(dataset,[calA],estimator)
assert.equal(fit.status,'candidate_artifact')
const artifact=buildSemanticCalibrationArtifactFromFit(fit,{
  calibration_id:'phase2e1-2-artifact',
  version:'1.0.0',
  status:'validated',
  calibration_method:{method_id:'categorical_confusion_counts',method_version:'v1'},
  applicability_scope:{
    visibility:['visible'],capture_types:['axial_head'],viewpoints:['axial'],crop_types:['full_image'],
    resolution:{min_width_px:256,min_height_px:256,max_width_px:null,max_height_px:null},
    occlusion_conditions:['none'],glare_conditions:['none'],
  },
  metrics:{
    brier_score:null,log_loss:null,ece:null,ece_policy_version:null,
    sample_count:1,per_class_support:{external_hex:1},
  },
  eligibility_policy_version:'phase2e1-2-policy-v1',
})
const heldOut=validateCalibrationArtifact(artifact,fit,dataset,[valA])
assert.equal(heldOut.status,'validated')

// A1 — unchanged exact dataset keeps the pre-existing eligible admission behavior.
{
  const result=assessCalibrationArtifactAdmission(
    artifact,dataset,oldDatasetValidation,heldOut,policy(),
  )
  assert.equal(result.eligible_for_admission,true)
  assert.equal(result.reason_codes.length,0)
}

// A2/A3 — stale caller validation cannot hide actual dataset content mutation.
{
  const mutated=clone(dataset)
  mutated.specimens[0].ground_truth[0].value='hex_socket'

  assert.equal(oldDatasetValidation.valid,true)
  assert.equal(artifact.dataset_content_digest_sha256,mutated.dataset_content_digest_sha256)
  assert.equal(heldOut.dataset_content_digest_sha256,mutated.dataset_content_digest_sha256)
  assert.notEqual(
    semanticCalibrationDatasetContentDigest(mutated),
    mutated.dataset_content_digest_sha256,
  )

  const result=assessCalibrationArtifactAdmission(
    artifact,mutated,oldDatasetValidation,heldOut,policy(),
  )
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('dataset_content_digest_mismatch'))
  assert.ok(result.reason_codes.includes('dataset_not_production_eligible'))
  assert.equal(result.reason_codes.includes('synthetic_dataset_not_production_eligible'),false)
}

// B1 — irrelevant + unbound input record cannot be hidden by estimator filtering.
{
  const unboundIrrelevant=record(
    'ghost-specimen','ghost-image',hash(90),'fit-unbound-irrelevant',
    {model:'other-model'},
  )
  const result=fitSemanticCalibrationArtifact(dataset,[calA,unboundIrrelevant],estimator)
  assert.notEqual(result.status,'candidate_artifact')
  assert.ok(result.reason_codes.includes('observation_dataset_image_binding_mismatch'))
}

// B2 — irrelevant record bound to validation split still invalidates calibration input collection.
{
  const wrongSplitIrrelevant=record(
    'val-a','val-a-image',hash(3),'fit-wrong-split-irrelevant',
    {model:'other-model'},
  )
  const result=fitSemanticCalibrationArtifact(dataset,[calA,wrongSplitIrrelevant],estimator)
  assert.notEqual(result.status,'candidate_artifact')
  assert.ok(result.reason_codes.includes('calibration_record_split_mismatch'))
}

// B3 — held-out irrelevant + unbound record cannot be hidden by fit-identity filtering.
{
  const unboundIrrelevant=record(
    'ghost-specimen','ghost-image',hash(91),'validation-unbound-irrelevant',
    {model:'other-model'},
  )
  const result=validateCalibrationArtifact(artifact,fit,dataset,[valA,unboundIrrelevant])
  assert.equal(result.status,'insufficient_validation')
  assert.ok(result.reason_codes.includes('observation_dataset_image_binding_mismatch'))
}

// B4 — held-out irrelevant calibration-split record rejects the whole validation collection.
{
  const wrongSplitIrrelevant=record(
    'cal-b','cal-b-image',hash(2),'validation-wrong-split-irrelevant',
    {model:'other-model',value:'hex_socket'},
  )
  const result=validateCalibrationArtifact(artifact,fit,dataset,[valA,wrongSplitIrrelevant])
  assert.equal(result.status,'insufficient_validation')
  assert.ok(result.reason_codes.includes('validation_record_split_mismatch'))
}

// B5 — heterogeneous but runtime-valid, exact-bound calibration collection remains allowed;
// identity filtering happens only after the complete collection crosses the trust boundary.
{
  const result=fitSemanticCalibrationArtifact(dataset,[calA,calBIrrelevant],estimator)
  assert.equal(result.status,'candidate_artifact')
  assert.deepEqual(result.calibration_record_ids,['cal-a-run'])
  assert.deepEqual(result.calibration_specimen_ids,['cal-a'])
}

// Production authority remains inactive: this deterministic fixture is never registered.
assert.equal(PRODUCTION_SEMANTIC_CALIBRATION_DATASETS.length,0)
assert.equal(ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS.length,0)
assert.equal(SEMANTIC_CALIBRATION_REGISTRY.length,0)
assert.equal(SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY.length,0)
assert.equal(ACTIVE_SEMANTIC_CALIBRATION_POLICY,null)

console.log('Phase 2E.1.2 admission self-verification & complete observation binding regressions passed')
