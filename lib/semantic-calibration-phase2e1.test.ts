import { strict as assert } from 'node:assert'
import {
  SEMANTIC_CALIBRATION_CORPUS_MANIFEST_SCHEMA,
  ingestSemanticCalibrationCorpus,
  type SemanticCalibrationCorpusManifest,
} from './semantic-calibration-corpus-ingest'
import {
  finalizeSemanticCalibrationDataset,
  validateSemanticCalibrationDataset,
  type SemanticCalibrationDatasetV1,
} from './semantic-calibration-dataset-v1'
import {
  calibrationEstimatorConfigDigest,
  fitSemanticCalibrationArtifact,
  type CalibrationEstimatorConfigV1,
} from './semantic-calibration-fit'
import {
  buildSemanticCalibrationArtifactFromFit,
  finalizeSemanticCalibrationArtifact,
  type SemanticCalibrationArtifactV1,
} from './semantic-calibration-v1'
import {
  finalizeCalibrationHeldOutValidation,
  validateCalibrationArtifact,
  type CalibrationHeldOutValidation,
} from './semantic-calibration-validation'
import { assessCalibrationArtifactAdmission } from './semantic-calibration-admission'
import {
  SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_SCHEMA,
  ACTIVE_SEMANTIC_CALIBRATION_POLICY,
  SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY,
  type SemanticCalibrationEligibilityPolicyV1,
} from './semantic-calibration-policy-v1'
import {
  ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS,
  PRODUCTION_SEMANTIC_CALIBRATION_DATASETS,
  SEMANTIC_CALIBRATION_REGISTRY,
} from './semantic-calibration-registry'
import {
  SEMANTIC_SENSOR_OBSERVATION_RECORD_SCHEMA,
  type SemanticSensorObservationRecordV1,
} from './semantic-sensor-observation-record-v1'
import { SEMANTIC_TAXONOMY_VERSION } from './semantic-taxonomy-v1'
import { buildCandidateBlindSemanticRequest } from './candidate-blind-semantic-request'
import { buildTargetedSemanticRequest } from './targeted-semantic-request'
import { buildTargetedSemanticEvidence } from './targeted-semantic-extractor'
import type { RawSemanticSensorObservation } from './semantic-evidence-v1'
import { SEMANTIC_CALIBRATION_LINEAGE_SCHEMA } from './semantic-calibration-lineage-v1'
import { buildSemanticRuntimeQuality } from './semantic-runtime-quality'
import { assessSemanticLikelihoodEligibility, type SemanticRuntimeCalibrationContext } from './semantic-likelihood-eligibility'
import { sha256Canonical } from './semantic-calibration-digest'
import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { buildStandardsAuthorityResult } from './standards-shadow-solver'
import { compileCandidateFeatureMatrix } from './candidate-feature-compiler'
import { CANDIDATE_FEATURE_METADATA_V1 } from './candidate-feature-metadata-v1'
import { buildCandidateSemanticDiscrimination } from './candidate-semantic-discrimination'
import { MEASUREMENT_V2_SCHEMA, type MeasurementV2 } from './measurement-v2'

const hash=(n:number)=>n.toString(16).padStart(64,'0')
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T

function manifest():SemanticCalibrationCorpusManifest{
  return {
    schema_version:SEMANTIC_CALIBRATION_CORPUS_MANIFEST_SCHEMA,
    dataset_id:'phase2e1-in-memory-only',
    dataset_version:'1.0.0',
    created_at:'2026-10-02T00:00:00Z',
    source_scope:'synthetic_test',
    source_provenance:{
      source_class:'synthetic_test',
      source_ref:'in-memory-unit-test-only',
      independent_acquisition:false,
    },
    feature_scope:['drive.form'],
    sensor_scope:['vlm'],
    specimens:[
      {
        specimen_id:'cal-specimen',
        provenance:{source_class:'synthetic_test',source_ref:'memory://cal',physical_identity_verified:true},
        images:[{
          image_id:'cal-image',sha256:hash(1),source_ref:'memory://cal-image',
          capture_type:'axial_head',viewpoint:'axial',crop_type:'full_image',
          width_px:512,height_px:512,visibility:'visible',
          occlusion_condition:'none',glare_condition:'none',split:'calibration',
        }],
        ground_truth:[{
          feature_id:'drive.form',value:'external_hex',
          verification_method:'test_fixture_assertion',gt_source:'in-memory-unit-test',
          annotator_or_fixture_provenance:'phase2e1-test',schema_version:'gt.v1',
          self_labeled_by_sensor:false,
        }],
      },
      {
        specimen_id:'val-specimen',
        provenance:{source_class:'synthetic_test',source_ref:'memory://val',physical_identity_verified:true},
        images:[{
          image_id:'val-image',sha256:hash(2),source_ref:'memory://val-image',
          capture_type:'axial_head',viewpoint:'axial',crop_type:'full_image',
          width_px:512,height_px:512,visibility:'visible',
          occlusion_condition:'none',glare_condition:'none',split:'validation',
        }],
        ground_truth:[{
          feature_id:'drive.form',value:'external_hex',
          verification_method:'test_fixture_assertion',gt_source:'in-memory-unit-test',
          annotator_or_fixture_provenance:'phase2e1-test',schema_version:'gt.v1',
          self_labeled_by_sensor:false,
        }],
      },
    ],
  }
}

const estimator:CalibrationEstimatorConfigV1={
  config_id:'phase2e1-confusion',
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
  eligibility_policy_version:'phase2e1-test-policy-v1',
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

function policy(metrics:Partial<SemanticCalibrationEligibilityPolicyV1['metric_requirements']>={}):SemanticCalibrationEligibilityPolicyV1{
  return {
    schema_version:SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_SCHEMA,
    policy_id:'phase2e1-test-policy',
    policy_version:'phase2e1-test-policy-v1',
    status:'preregistered',
    created_at:'2026-10-02T00:00:00Z',
    locked_at:'2026-10-02T00:00:00Z',
    applicable_dataset_schema:'hcsi.semantic-calibration-dataset.v1',
    applicable_calibration_schema:'hcsi.semantic-calibration.v1',
    allowed_source_scopes:['synthetic_test'],
    required_split_policy:{unit:'physical_specimen',calibration_required:true,validation_required:true},
    required_gt_policy:{independently_verified:true,same_sensor_self_label_forbidden:true,provenance_required:true},
    minimum_support:{sample_count:null,per_class:null},
    metric_requirements:{max_brier_score:null,max_log_loss:null,max_ece:null,...metrics},
    quality_coverage_requirements:{required:false,description:'unit-test-only'},
    artifact_identity_requirements:{exact_sensor_identity:true,exact_feature:true,exact_taxonomy:true},
    admission_rules:['explicit_registry_update_required'],
    change_control:{requires_new_version:true,validation_set_must_not_tune_estimator:true},
  }
}

function reviseArtifact(
  artifact:SemanticCalibrationArtifactV1,
  overrides:Partial<Omit<SemanticCalibrationArtifactV1,'artifact_digest_sha256'>>,
):SemanticCalibrationArtifactV1{
  const {artifact_digest_sha256:_digest,...draft}=artifact
  return finalizeSemanticCalibrationArtifact({...draft,...overrides})
}

function reviseValidation(
  validation:CalibrationHeldOutValidation,
  overrides:Partial<Omit<CalibrationHeldOutValidation,'validation_id'|'validation_digest_sha256'>>,
):CalibrationHeldOutValidation{
  const {validation_id:_id,validation_digest_sha256:_digest,...draft}=validation
  return finalizeCalibrationHeldOutValidation({...draft,...overrides})
}

function pngBase64(width:number,height:number):string{
  const buffer=Buffer.alloc(24)
  Buffer.from([137,80,78,71,13,10,26,10]).copy(buffer,0)
  buffer.writeUInt32BE(width,16)
  buffer.writeUInt32BE(height,20)
  return buffer.toString('base64')
}

const ingest=ingestSemanticCalibrationCorpus(manifest())
assert.equal(ingest.accepted,true)
assert.ok(ingest.dataset)
const dataset=ingest.dataset
const datasetValidation=validateSemanticCalibrationDataset(dataset)
assert.equal(datasetValidation.valid,true)
assert.equal(datasetValidation.production_eligible_source,false)
assert.equal(dataset.lineage_schema_version,SEMANTIC_CALIBRATION_LINEAGE_SCHEMA)
assert.equal(dataset.manifest_digest_sha256,ingest.immutable_manifest_digest_sha256)

const calRecord=record('cal-specimen','cal-image',hash(1),'cal-run')
const valRecord=record('val-specimen','val-image',hash(2),'val-run')
const fit=fitSemanticCalibrationArtifact(dataset,[calRecord],estimator)
assert.equal(fit.status,'candidate_artifact')
assert.equal(fit.dataset_manifest_digest_sha256,dataset.manifest_digest_sha256)
assert.equal(fit.dataset_content_digest_sha256,dataset.dataset_content_digest_sha256)
assert.equal(fit.estimator_config_digest_sha256,calibrationEstimatorConfigDigest(estimator))
assert.match(fit.fit_digest_sha256,/^[a-f0-9]{64}$/)

const artifact=buildSemanticCalibrationArtifactFromFit(fit,{
  calibration_id:'phase2e1-artifact',
  version:'1.0.0',
  status:'validated',
  calibration_method:{method_id:'categorical_confusion_counts',method_version:'v1'},
  applicability_scope:{
    visibility:['visible'],
    capture_types:['single_image','axial_head'],
    viewpoints:['unknown','axial'],
    crop_types:['full_image','full_image_with_roi_reference','physical_crop_input'],
    resolution:{min_width_px:256,min_height_px:256,max_width_px:null,max_height_px:null},
    occlusion_conditions:['unknown','none'],
    glare_conditions:['unknown','none'],
  },
  metrics:{
    brier_score:null,log_loss:null,ece:null,ece_policy_version:null,
    sample_count:1,per_class_support:{external_hex:1},
  },
  eligibility_policy_version:'phase2e1-test-policy-v1',
})
const validation=validateCalibrationArtifact(artifact,fit,dataset,[valRecord])
assert.equal(validation.status,'validated')
assert.equal(validation.validation_record_ids.length,1)
assert.equal(validation.validation_record_ids[0],'val-run')
assert.equal(validation.source_fit_digest_sha256,fit.fit_digest_sha256)
assert.equal(validation.artifact_digest_sha256,artifact.artifact_digest_sha256)
assert.equal(validation.dataset_manifest_digest_sha256,dataset.manifest_digest_sha256)
assert.equal(validation.dataset_content_digest_sha256,dataset.dataset_content_digest_sha256)
assert.equal(validation.brier_score,0)
assert.equal(validation.log_loss,0)
assert.equal(validation.ece,null)
assert.ok(validation.metric_reason_codes.includes('ece_metric_not_defined_for_current_artifact_output'))

// A — Fit lineage propagates immutable dataset + estimator identities into artifact.
assert.equal(artifact.source_fit_id,fit.fit_id)
assert.equal(artifact.source_fit_digest_sha256,fit.fit_digest_sha256)
assert.equal(artifact.dataset_manifest_digest_sha256,fit.dataset_manifest_digest_sha256)
assert.equal(artifact.dataset_content_digest_sha256,fit.dataset_content_digest_sha256)
assert.equal(artifact.estimator_config_digest_sha256,fit.estimator_config_digest_sha256)

// B — Artifact A + Validation B cannot pass lineage admission.
{
  const wrong=reviseValidation(validation,{artifact_id:'different-artifact'})
  const result=assessCalibrationArtifactAdmission(artifact,dataset,datasetValidation,wrong,policy())
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('artifact_validation_artifact_mismatch'))
}

// Extra fit mismatch localization.
{
  const wrong=reviseValidation(validation,{source_fit_digest_sha256:hash(100)})
  const result=assessCalibrationArtifactAdmission(artifact,dataset,datasetValidation,wrong,policy())
  assert.ok(result.reason_codes.includes('artifact_validation_fit_mismatch'))
}

// C — Same human-readable dataset id/version with different immutable content digest is rejected.
{
  const {dataset_content_digest_sha256:_oldDigest,...otherDraft}=dataset
  const otherDataset=finalizeSemanticCalibrationDataset({...otherDraft,manifest_digest_sha256:hash(101)})
  const otherValidation=validateSemanticCalibrationDataset(otherDataset)
  assert.equal(otherValidation.valid,true)
  const result=assessCalibrationArtifactAdmission(artifact,otherDataset,otherValidation,validation,policy())
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('dataset_manifest_digest_mismatch'))
}

// D — Wrong estimator digest is rejected.
{
  const wrong=reviseValidation(validation,{estimator_config_digest_sha256:hash(102)})
  const result=assessCalibrationArtifactAdmission(artifact,dataset,datasetValidation,wrong,policy())
  assert.ok(result.reason_codes.includes('artifact_validation_estimator_mismatch'))
}

// E — Wrong feature is rejected.
{
  const wrong=reviseValidation(validation,{feature_id:'head.profile'})
  const result=assessCalibrationArtifactAdmission(artifact,dataset,datasetValidation,wrong,policy())
  assert.ok(result.reason_codes.includes('artifact_validation_feature_mismatch'))
}

// F — Wrong sensor identity is rejected.
{
  const wrong=reviseValidation(validation,{
    sensor_identity:{...validation.sensor_identity,model:'different-vlm'},
  })
  const result=assessCalibrationArtifactAdmission(artifact,dataset,datasetValidation,wrong,policy())
  assert.ok(result.reason_codes.includes('artifact_validation_sensor_identity_mismatch'))
}

// Extra taxonomy mismatch localization.
{
  const wrong=reviseValidation(validation,{
    taxonomy_version:'taxonomy-other',
    sensor_identity:{...validation.sensor_identity,taxonomy_version:'taxonomy-other'},
  })
  const result=assessCalibrationArtifactAdmission(artifact,dataset,datasetValidation,wrong,policy())
  assert.ok(result.reason_codes.includes('artifact_validation_taxonomy_mismatch'))
}

// G — Calibration/validation record or specimen overlap is fail-closed at admission.
{
  const wrong=reviseValidation(validation,{
    source_fit_calibration_record_ids:['cal-run'],
    validation_record_ids:['cal-run'],
  })
  const result=assessCalibrationArtifactAdmission(artifact,dataset,datasetValidation,wrong,policy())
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('validation_calibration_data_overlap'))
}

// H — Forged good artifact metrics cannot override bad held-out metrics.
{
  const forged=reviseArtifact(artifact,{
    metrics:{...artifact.metrics,brier_score:.001,log_loss:.001,ece:.001,ece_policy_version:'test'},
  })
  const heldOutBad=reviseValidation(validation,{
    artifact_digest_sha256:forged.artifact_digest_sha256,
    brier_score:.30,log_loss:.30,ece:.30,ece_policy_version:'test',
  })
  const result=assessCalibrationArtifactAdmission(
    forged,dataset,datasetValidation,heldOutBad,
    policy({max_brier_score:.05,max_log_loss:.05,max_ece:.05}),
  )
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('brier_requirement_not_met'))
  assert.ok(result.reason_codes.includes('log_loss_requirement_not_met'))
  assert.ok(result.reason_codes.includes('ece_requirement_not_met'))
}

// I — Bad artifact diagnostics do not poison good held-out acceptance metrics.
{
  const ugly=reviseArtifact(artifact,{
    metrics:{...artifact.metrics,brier_score:.30,log_loss:.30,ece:.30,ece_policy_version:'test'},
  })
  const heldOutGood=reviseValidation(validation,{
    artifact_digest_sha256:ugly.artifact_digest_sha256,
    brier_score:.01,log_loss:.01,ece:.01,ece_policy_version:'test',
  })
  const result=assessCalibrationArtifactAdmission(
    ugly,dataset,datasetValidation,heldOutGood,
    policy({max_brier_score:.05,max_log_loss:.05,max_ece:.05}),
  )
  assert.equal(result.reason_codes.includes('brier_requirement_not_met'),false)
  assert.equal(result.reason_codes.includes('log_loss_requirement_not_met'),false)
  assert.equal(result.reason_codes.includes('ece_requirement_not_met'),false)
  // Synthetic test corpus remains non-production, independently of metric authority.
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('dataset_not_production_eligible'))
}

// J — Required but undefined held-out metric fails closed.
{
  const missing=reviseValidation(validation,{ece:null,ece_policy_version:null})
  const result=assessCalibrationArtifactAdmission(
    artifact,dataset,datasetValidation,missing,policy({max_ece:.05}),
  )
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('ece_requirement_not_met'))
  assert.ok(result.reason_codes.includes('required_held_out_metric_unavailable'))
}

// K — Full image dimensions represent the actual full-image sensor input.
const fullQuality=buildSemanticRuntimeQuality('visible',{
  source_image_base64:pngBase64(4000,3000),
  observation_image_base64:pngBase64(4000,3000),
  observation_region_type:'full_image',
  capture_type:'single_image',viewpoint:'unknown',crop_type:'full_image',
  occlusion_condition:'unknown',glare_condition:'unknown',
})
assert.equal(fullQuality.width_px,4000)
assert.equal(fullQuality.height_px,3000)
assert.equal(fullQuality.pixel_geometry!.observation_region_type,'full_image')

// L — Physical crop uses crop bytes, never source dimensions.
const cropQuality=buildSemanticRuntimeQuality('visible',{
  source_image_base64:pngBase64(4000,3000),
  observation_image_base64:pngBase64(100,80),
  observation_region_type:'physical_crop_input',
  capture_type:'single_image',viewpoint:'unknown',crop_type:'physical_crop_input',
  occlusion_condition:'unknown',glare_condition:'unknown',
})
assert.equal(cropQuality.pixel_geometry!.source_image_width_px,4000)
assert.equal(cropQuality.pixel_geometry!.source_image_height_px,3000)
assert.equal(cropQuality.width_px,100)
assert.equal(cropQuality.height_px,80)

// M — 100x80 crop is out of a 256x256 calibrated scope even with a 4000x3000 source.
{
  const runtime:SemanticRuntimeCalibrationContext={
    feature_id:'drive.form',sensor_type:'vlm',model:'mock-vlm',model_version:'v1',
    prompt_version:'prompt-v1',extractor_version:'extractor-v1',taxonomy_version:SEMANTIC_TAXONOMY_VERSION,
    quality:cropQuality,
  }
  const result=assessSemanticLikelihoodEligibility(runtime,artifact,dataset,datasetValidation,policy())
  assert.ok(result.reason_codes.includes('runtime_quality_out_of_scope'))
}

// N — Full image + ROI reference stays a full-image sensor condition, not a physical crop.
const roiQuality=buildSemanticRuntimeQuality('visible',{
  source_image_base64:pngBase64(4000,3000),
  observation_image_base64:pngBase64(4000,3000),
  crop_ref:'target_region_1',
  observation_region_type:'full_image_with_roi_reference',
  capture_type:'single_image',viewpoint:'unknown',
  crop_type:'full_image_with_roi_reference',
  occlusion_condition:'unknown',glare_condition:'unknown',
  geometry_provenance:'provider_received_full_image_with_roi_reference',
})
assert.equal(roiQuality.width_px,4000)
assert.equal(roiQuality.height_px,3000)
assert.equal(roiQuality.crop_type,'full_image_with_roi_reference')
assert.notEqual(roiQuality.pixel_geometry!.observation_region_type,'physical_crop_input')

// Targeted pass reality regression: current provider path receives the full
// original image and the targeted prompt does not serialize the ROI.
{
  const base=buildCandidateBlindSemanticRequest({
    image:Buffer.from('phase2e1-targeted-full-image').toString('base64'),
    target_region:{present:true,x_min:100,y_min:100,x_max:300,y_max:300},
  })
  const request=buildTargetedSemanticRequest(base,'drive.form')
  const raw:RawSemanticSensorObservation={
    feature_id:'drive.form',value:'external_hex',state:'observed',visibility:'visible',
    raw_score:null,calibrated_probability:null,calibration_status:'uncalibrated',
    reason_codes:[],freeform_description:null,raw_text:null,normalized_text:null,character_confidence:null,
  }
  const evidence=buildTargetedSemanticEvidence(
    raw,request,null,{model:'mock-vlm',model_version:'v1'},
  )
  assert.equal(evidence.provenance.sensor_input_mode,'full_image')
  assert.equal(evidence.provenance.roi_instruction_sent,false)
  assert.equal(evidence.provenance.crop_ref,'full_image_1')
  assert.deepEqual(evidence.observation.evidence_refs,['full_image_1'])
}

// O — Unknown effective geometry stays unknown and fails closed.
{
  const unknown=buildSemanticRuntimeQuality('visible',{
    observation_region_type:'unknown',
    capture_type:'single_image',viewpoint:'unknown',crop_type:'unknown',
    occlusion_condition:'unknown',glare_condition:'unknown',
  })
  assert.equal(unknown.width_px,null)
  assert.equal(unknown.height_px,null)
  const runtime:SemanticRuntimeCalibrationContext={
    feature_id:'drive.form',sensor_type:'vlm',model:'mock-vlm',model_version:'v1',
    prompt_version:'prompt-v1',extractor_version:'extractor-v1',taxonomy_version:SEMANTIC_TAXONOMY_VERSION,
    quality:unknown,
  }
  const result=assessSemanticLikelihoodEligibility(runtime,artifact,dataset,datasetValidation,policy())
  assert.ok(result.reason_codes.includes('runtime_quality_unknown'))
  assert.equal(result.calibration_applicability,'out_of_scope')
}

// P — Invalid runtime feature id is rejected at ingest.
{
  const bad=clone(manifest()) as any
  bad.specimens[0].ground_truth[0].feature_id='random.feature'
  const result=ingestSemanticCalibrationCorpus(bad as unknown as SemanticCalibrationCorpusManifest)
  assert.equal(result.accepted,false)
  assert.ok(result.reason_codes.includes('invalid_feature_id'))
}

// Q — Taxonomically invalid GT value is rejected.
{
  const bad=clone(manifest()) as any
  bad.specimens[0].ground_truth[0].value='M14'
  const result=ingestSemanticCalibrationCorpus(bad)
  assert.equal(result.accepted,false)
  assert.ok(result.reason_codes.includes('invalid_ground_truth_value'))
}

// R — GT outside declared feature_scope is rejected.
{
  const bad=clone(manifest()) as any
  bad.feature_scope=['head.profile']
  const result=ingestSemanticCalibrationCorpus(bad)
  assert.equal(result.accepted,false)
  assert.ok(result.reason_codes.includes('ground_truth_feature_outside_feature_scope'))
}

// S — Observation sensor outside dataset.sensor_scope is rejected by fit.
{
  const badRecord=record('cal-specimen','cal-image',hash(1),'bad-sensor',{sensor_type:'ocr'})
  const badFit=fitSemanticCalibrationArtifact(dataset,[badRecord],estimator)
  assert.equal(badFit.status,'insufficient_data')
  assert.ok(badFit.reason_codes.includes('sensor_outside_dataset_scope'))
}

// T — Conflicting duplicate GT cannot be silently last-write-wins.
{
  const bad=clone(manifest()) as any
  bad.specimens[0].ground_truth.push({
    ...bad.specimens[0].ground_truth[0],
    value:'hex_socket',
  })
  const result=ingestSemanticCalibrationCorpus(bad)
  assert.equal(result.accepted,false)
  assert.ok(result.reason_codes.includes('conflicting_duplicate_ground_truth'))
}

// Identical duplicate GT is also deterministic and rejected rather than last-write-wins.
{
  const bad=clone(manifest()) as any
  bad.specimens[0].ground_truth.push({...bad.specimens[0].ground_truth[0]})
  const result=ingestSemanticCalibrationCorpus(bad)
  assert.equal(result.accepted,false)
  assert.ok(result.reason_codes.includes('duplicate_ground_truth_feature'))
}

// U — Missing any declared scoped GT fails closed.
{
  const bad=clone(manifest()) as any
  bad.feature_scope=['drive.form','head.profile']
  const result=ingestSemanticCalibrationCorpus(bad)
  assert.equal(result.accepted,false)
  assert.ok(result.reason_codes.includes('missing_scoped_ground_truth'))
}

// Also reject sensor observation states as physical GT.
{
  const bad=clone(manifest()) as any
  bad.specimens[0].ground_truth[0].value='unknown'
  const result=ingestSemanticCalibrationCorpus(bad)
  assert.equal(result.accepted,false)
  assert.ok(result.reason_codes.includes('ground_truth_sensor_state_forbidden'))
}

// V — No production corpus, artifact, active registry entry, or policy is created.
assert.equal(PRODUCTION_SEMANTIC_CALIBRATION_DATASETS.length,0)
assert.equal(ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS.length,0)
assert.equal(SEMANTIC_CALIBRATION_REGISTRY.length,0)
assert.equal(SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY.length,0)
assert.equal(ACTIVE_SEMANTIC_CALIBRATION_POLICY,null)

// Canonical digest is independent of object property insertion order.
assert.equal(
  sha256Canonical({b:2,a:{d:4,c:3}}),
  sha256Canonical({a:{c:3,d:4},b:2}),
)

// W/X/Y/Z — Candidate universe, Case C measurements, #37 absence, decision stay unchanged.
const measurement={
  schema_version:MEASUREMENT_V2_SCHEMA,
  observations:[
    {quantity:'D',value_mm:13.700},
    {quantity:'P',value_mm:2.051},
    {quantity:'L_underhead',value_mm:47.540},
  ],
  uncertainty:{
    schema_version:'hcsi.measurement-uncertainty.v1',
    quantities:[],primitives:[],
    covariance:{quantities:[],matrix_mm2:[],status:'not_estimated',null_semantics:'not_estimated',note:'phase2e1'},
    systematic_bias_ledger:[],systematic_bias_status:'not_estimated',
  },
} as unknown as MeasurementV2
const authority=buildStandardsAuthorityResult(measurement,STANDARDS_CATALOGUE_V1)
const before=authority.formal_candidates.map(c=>c.candidate_id)
const m14=authority.formal_candidates.find(c=>c.designation==='M14 × 2.0')
const u916=authority.formal_candidates.find(c=>c.designation==='9/16-12 UNC')
assert.ok(m14&&u916)
const matrix=compileCandidateFeatureMatrix([m14,u916],CANDIDATE_FEATURE_METADATA_V1)
const discrimination=buildCandidateSemanticDiscrimination(matrix,null,[])

// W
assert.deepEqual(authority.formal_candidates.map(c=>c.candidate_id),before)
// X
assert.equal((measurement.observations.find(x=>x.quantity==='D') as any).value_mm,13.700)
assert.equal((measurement.observations.find(x=>x.quantity==='P') as any).value_mm,2.051)
assert.equal((measurement.observations.find(x=>x.quantity==='L_underhead') as any).value_mm,47.540)
// Y
assert.equal(authority.formal_candidates.some(c=>/#37-12/i.test(c.designation)),false)
// Z
assert.equal(matrix.discriminative_features.length,0)
assert.equal(discrimination.numeric_score,null)
assert.equal(discrimination.posterior_probability,null)
assert.equal(discrimination.decision.selected_candidate_id,null)
assert.equal(discrimination.decision.purchase_ready,false)
assert.equal(authority.decision.selected_candidate_id,null)
assert.equal(authority.decision.purchase_ready,false)

console.log('Phase 2E.1 calibration lineage hardening regressions A-Z passed')
