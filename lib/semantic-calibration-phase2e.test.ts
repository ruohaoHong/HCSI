import {
  SEMANTIC_CALIBRATION_CORPUS_MANIFEST_SCHEMA,
  ingestSemanticCalibrationCorpus,
  type SemanticCalibrationCorpusManifest,
} from './semantic-calibration-corpus-ingest'
import {
  SEMANTIC_CALIBRATION_DATASET_SCHEMA,
  validateSemanticCalibrationDataset,
  type CalibrationDatasetSourceScope,
  type CalibrationSplit,
  type SemanticCalibrationDatasetV1,
} from './semantic-calibration-dataset-v1'
import {
  SEMANTIC_CALIBRATION_SCHEMA,
  buildSemanticCalibrationArtifactFromFit,
  finalizeSemanticCalibrationArtifact,
  type SemanticCalibrationArtifactV1,
} from './semantic-calibration-v1'
import { SEMANTIC_CALIBRATION_LINEAGE_SCHEMA } from './semantic-calibration-lineage-v1'
import {
  ACTIVE_SEMANTIC_CALIBRATION_POLICY,
  SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY,
  SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_SCHEMA,
  type SemanticCalibrationEligibilityPolicyV1,
} from './semantic-calibration-policy-v1'
import {
  ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS,
  PRODUCTION_SEMANTIC_CALIBRATION_DATASETS,
  SEMANTIC_CALIBRATION_REGISTRY,
  type SemanticCalibrationRegistryEntry,
} from './semantic-calibration-registry'
import {
  exactIdentityArtifacts,
  resolveSemanticCalibrationArtifact,
  selectExplicitActiveArtifact,
} from './semantic-calibration-resolver'
import type { SemanticRuntimeCalibrationContext } from './semantic-likelihood-eligibility'
import {
  SEMANTIC_SENSOR_OBSERVATION_RECORD_SCHEMA,
  assertObservationCandidateBlind,
  type SemanticSensorObservationRecordV1,
} from './semantic-sensor-observation-record-v1'
import {
  fitCategoricalConfusionModel,
  requireRawScoreForScoreCalibrator,
} from './semantic-confusion-model-v1'
import {
  SEMANTIC_CALIBRATION_FIT_SCHEMA,
  fitSemanticCalibrationArtifact,
  type CalibrationEstimatorConfigV1,
} from './semantic-calibration-fit'
import {
  SEMANTIC_CALIBRATION_VALIDATION_SCHEMA,
  finalizeCalibrationHeldOutValidation,
  validateCalibrationArtifact,
  type CalibrationHeldOutValidation,
} from './semantic-calibration-validation'
import {
  SEMANTIC_CALIBRATION_ADMISSION_SCHEMA,
  assessCalibrationArtifactAdmission,
} from './semantic-calibration-admission'
import {
  buildSemanticRuntimeQuality,
  readImageDimensionsFromBase64,
} from './semantic-runtime-quality'
import { SEMANTIC_TAXONOMY_VERSION } from './semantic-taxonomy-v1'
import { MEASUREMENT_V2_SCHEMA,type MeasurementV2 } from './measurement-v2'
import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { buildStandardsAuthorityResult } from './standards-shadow-solver'
import { compileCandidateFeatureMatrix } from './candidate-feature-compiler'
import { CANDIDATE_FEATURE_METADATA_V1 } from './candidate-feature-metadata-v1'
import { buildCandidateSemanticDiscrimination } from './candidate-semantic-discrimination'

function ok(value:unknown,message='assertion failed'):asserts value{if(!value)throw new Error(message)}
function eq(a:unknown,b:unknown,message='values differ'){if(a!==b)throw new Error(`${message}: ${String(a)} !== ${String(b)}`)}
function throws(fn:()=>unknown,pattern:RegExp){let error:unknown=null;try{fn()}catch(e){error=e}ok(error instanceof Error);ok(pattern.test(error.message),error.message)}

const hash=(n:number)=>n.toString(16).padStart(64,'0')
const sensorIdentity={
  sensor_type:'vlm' as const,model:'mock-vlm',model_version:'v2',prompt_version:'prompt-v1',extractor_version:'extractor-v1',
}

function manifest(
  sourceScope:CalibrationDatasetSourceScope='synthetic_test',
  options:{
    specimenSource?:CalibrationDatasetSourceScope
    specimenSplits?:CalibrationSplit[]
    imageHashes?:string[]
    secondSpecimen?:{source:CalibrationDatasetSourceScope;split:CalibrationSplit;hash:string}
    selfLabel?:boolean
  }={},
):SemanticCalibrationCorpusManifest{
  const splits=options.specimenSplits??['calibration']
  const hashes=options.imageHashes??splits.map((_,i)=>hash(i+1))
  const specimenSource=options.specimenSource??sourceScope
  const specimens:SemanticCalibrationCorpusManifest['specimens']=[{
    specimen_id:'specimen-alpha',
    provenance:{source_class:specimenSource,source_ref:'unit-test-source',physical_identity_verified:true},
    images:splits.map((split,i)=>({
      image_id:`alpha-${i}`,sha256:hashes[i],source_ref:`memory://alpha-${i}`,
      capture_type:'axial_head',viewpoint:'axial',crop_type:'head_crop',width_px:512,height_px:512,
      visibility:'clear',occlusion_condition:'none',glare_condition:'none',split,
    })),
    ground_truth:[{
      feature_id:'drive.form',value:'external_hex',verification_method:'physical_inspection',
      gt_source:'independent-human-physical-check',annotator_or_fixture_provenance:'unit-test-ledger',
      schema_version:'gt.v1',self_labeled_by_sensor:options.selfLabel??false,
    }],
  }]
  if(options.secondSpecimen){
    specimens.push({
      specimen_id:'specimen-beta',
      provenance:{source_class:options.secondSpecimen.source,source_ref:'unit-test-source-beta',physical_identity_verified:true},
      images:[{
        image_id:'beta-0',sha256:options.secondSpecimen.hash,source_ref:'memory://beta-0',
        capture_type:'axial_head',viewpoint:'axial',crop_type:'head_crop',width_px:512,height_px:512,
        visibility:'clear',occlusion_condition:'none',glare_condition:'none',split:options.secondSpecimen.split,
      }],
      ground_truth:[{
        feature_id:'drive.form',value:'hex_socket',verification_method:'physical_inspection',
        gt_source:'independent-human-physical-check',annotator_or_fixture_provenance:'unit-test-ledger',
        schema_version:'gt.v1',self_labeled_by_sensor:false,
      }],
    })
  }
  return {
    schema_version:SEMANTIC_CALIBRATION_CORPUS_MANIFEST_SCHEMA,
    dataset_id:'phase2e-unit-corpus',dataset_version:'1.0.0',created_at:'2026-10-02T00:00:00Z',
    source_scope:sourceScope,
    source_provenance:{source_class:sourceScope,source_ref:'unit-test-manifest',independent_acquisition:sourceScope==='independent_real_image'},
    specimens,feature_scope:['drive.form'],sensor_scope:['vlm'],
  }
}

function testPolicy():SemanticCalibrationEligibilityPolicyV1{
  return {
    schema_version:SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_SCHEMA,
    policy_id:'phase2e-test-policy',policy_version:'test-policy-v1',status:'preregistered',
    created_at:'2026-10-02T00:00:00Z',locked_at:'2026-10-02T00:00:00Z',
    applicable_dataset_schema:SEMANTIC_CALIBRATION_DATASET_SCHEMA,
    applicable_calibration_schema:SEMANTIC_CALIBRATION_SCHEMA,
    allowed_source_scopes:['independent_real_image'],
    required_split_policy:{unit:'physical_specimen',calibration_required:true,validation_required:true},
    required_gt_policy:{independently_verified:true,same_sensor_self_label_forbidden:true,provenance_required:true},
    minimum_support:{sample_count:null,per_class:null},
    metric_requirements:{max_brier_score:null,max_log_loss:null,max_ece:null},
    quality_coverage_requirements:{required:false,description:'test policy only; no production threshold'},
    artifact_identity_requirements:{exact_sensor_identity:true,exact_feature:true,exact_taxonomy:true},
    admission_rules:['explicit_registry_update_required'],
    change_control:{requires_new_version:true,validation_set_must_not_tune_estimator:true},
  }
}

function emptyConfusionModel(){
  return {
    schema_version:'hcsi.semantic-confusion-model.v1' as const,
    feature_id:'drive.form' as const,
    estimator:{method:'empirical_counts' as const,smoothing:'none' as const},
    counts:{},row_totals:{},empirical_frequencies:{},outcomes:[],
  }
}

function artifact(id:string,modelVersion:string='v2',overrides:Partial<SemanticCalibrationArtifactV1>={}):SemanticCalibrationArtifactV1{
  const {artifact_digest_sha256:_ignored,...overrideDraft}=overrides
  return finalizeSemanticCalibrationArtifact({
    schema_version:SEMANTIC_CALIBRATION_SCHEMA,lineage_schema_version:SEMANTIC_CALIBRATION_LINEAGE_SCHEMA,
    calibration_id:id,version:'1.0.0',source_fit_id:'fit-placeholder',source_fit_digest_sha256:hash(90),status:'validated',
    sensor_identity:{...sensorIdentity,model_version:modelVersion},
    feature_id:'drive.form',taxonomy_version:SEMANTIC_TAXONOMY_VERSION,
    dataset_id:'phase2e-unit-corpus',dataset_version:'1.0.0',
    dataset_manifest_digest_sha256:hash(91),dataset_content_digest_sha256:hash(93),estimator_config_digest_sha256:hash(92),
    calibration_method:{method_id:'categorical_confusion_counts',method_version:'v1'},
    calibration_payload:{type:'categorical_confusion_model',model:emptyConfusionModel()},
    applicability_scope:{
      visibility:['visible'],capture_types:['axial_head'],viewpoints:['axial'],crop_types:['head_crop'],
      resolution:{min_width_px:256,min_height_px:256,max_width_px:1024,max_height_px:1024},
      occlusion_conditions:['none'],glare_conditions:['none'],
    },
    metrics:{brier_score:null,log_loss:null,ece:null,ece_policy_version:null,sample_count:8,per_class_support:{external_hex:4,hex_socket:4}},
    eligibility_policy_version:'test-policy-v1',
    ...overrideDraft,
  })
}

const runtime:SemanticRuntimeCalibrationContext={
  feature_id:'drive.form',sensor_type:'vlm',model:'mock-vlm',model_version:'v2',
  prompt_version:'prompt-v1',extractor_version:'extractor-v1',taxonomy_version:SEMANTIC_TAXONOMY_VERSION,
  quality:{visibility:'visible',capture_type:'axial_head',viewpoint:'axial',crop_type:'head_crop',width_px:512,height_px:512,occlusion_condition:'none',glare_condition:'none'},
}
const v1=artifact('cal-v1','v1')
const v2=artifact('cal-v2','v2')
const policy=testPolicy()

// A — no real corpus means every production source-of-truth remains empty.
eq(PRODUCTION_SEMANTIC_CALIBRATION_DATASETS.length,0)
eq(ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS.length,0)
eq(SEMANTIC_CALIBRATION_REGISTRY.length,0)
eq(SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY.length,0)
eq(ACTIVE_SEMANTIC_CALIBRATION_POLICY,null)

// B — exact model/model-version resolver stage chooses v2, not first feature/sensor match.
const exact=exactIdentityArtifacts(runtime,[v1,v2])
eq(exact.length,1);eq(exact[0].calibration_id,'cal-v2')

// C — prompt mismatch cannot identity-resolve.
eq(exactIdentityArtifacts({...runtime,prompt_version:'prompt-v9'},[v1,v2]).length,0)

// D — extractor mismatch cannot identity-resolve.
eq(exactIdentityArtifacts({...runtime,extractor_version:'extractor-v9'},[v1,v2]).length,0)

// E — taxonomy mismatch cannot identity-resolve.
eq(exactIdentityArtifacts({...runtime,taxonomy_version:'taxonomy-v9'},[v1,v2]).length,0)

// F — multiple applicable artifacts without active registry version fail closed as ambiguous.
const v2b=artifact('cal-v2b','v2')
let resolution=resolveSemanticCalibrationArtifact(runtime,[v2,v2b],[],policy,[])
eq(resolution.status,'ambiguous_multiple_artifacts')
ok(resolution.reason_codes.includes('ambiguous_multiple_artifacts'))

// G — explicit active registry entry selects deterministically.
const activeEntry:SemanticCalibrationRegistryEntry={
  feature_id:'drive.form',sensor_type:'vlm',model:'mock-vlm',model_version:'v2',
  prompt_version:'prompt-v1',extractor_version:'extractor-v1',taxonomy_version:SEMANTIC_TAXONOMY_VERSION,
  active_calibration_id:'cal-v2b',active_version:'1.0.0',policy_version:'test-policy-v1',
}
const selected=selectExplicitActiveArtifact(runtime,[v2,v2b],[activeEntry],'test-policy-v1')
eq(selected.status,'selected');eq(selected.artifact?.calibration_id,'cal-v2b')

// H — an artifact cannot self-declare preregistered authority.
const injected={...v2,policy_status:'preregistered'} as SemanticCalibrationArtifactV1 & {policy_status:string}
resolution=resolveSemanticCalibrationArtifact(runtime,[injected],[],null,[activeEntry])
eq(resolution.status,'policy_ineligible')
ok(resolution.reason_codes.includes('active_preregistered_policy_missing'))

// I — missing active policy rejects admission.
const syntheticIngest=ingestSemanticCalibrationCorpus(manifest('synthetic_test'))
ok(syntheticIngest.dataset)
const syntheticValidation=validateSemanticCalibrationDataset(syntheticIngest.dataset)
const heldOut:CalibrationHeldOutValidation=finalizeCalibrationHeldOutValidation({
  schema_version:SEMANTIC_CALIBRATION_VALIDATION_SCHEMA,lineage_schema_version:SEMANTIC_CALIBRATION_LINEAGE_SCHEMA,
  status:'validated',split:'validation',estimator_locked_before_validation:true,validation_used_for_tuning:false,
  artifact_id:v2.calibration_id,artifact_version:v2.version,artifact_digest_sha256:v2.artifact_digest_sha256,
  source_fit_id:v2.source_fit_id,source_fit_digest_sha256:v2.source_fit_digest_sha256,
  dataset_id:syntheticIngest.dataset.dataset_id,dataset_version:syntheticIngest.dataset.dataset_version,
  dataset_manifest_digest_sha256:syntheticIngest.dataset.manifest_digest_sha256,
  dataset_content_digest_sha256:syntheticIngest.dataset.dataset_content_digest_sha256,
  feature_id:'drive.form',sensor_identity:{...sensorIdentity,taxonomy_version:SEMANTIC_TAXONOMY_VERSION},
  taxonomy_version:SEMANTIC_TAXONOMY_VERSION,estimator_config_digest_sha256:v2.estimator_config_digest_sha256,
  sample_count:8,per_class_support:{external_hex:4,hex_socket:4},quality_strata_support:{axial:8},
  accuracy:.5,brier_score:null,log_loss:null,ece:null,ece_policy_version:null,reliability_bins:null,metric_reason_codes:[],
  source_fit_calibration_specimen_ids:[],source_fit_calibration_record_ids:[],
  validation_specimen_ids:['validation-specimen'],validation_record_ids:['validation-run'],reason_codes:[],
})
let admission=assessCalibrationArtifactAdmission(v2,syntheticIngest.dataset,syntheticValidation,heldOut,null)
eq(admission.schema_version,SEMANTIC_CALIBRATION_ADMISSION_SCHEMA)
eq(admission.eligible_for_admission,false)
ok(admission.reason_codes.includes('active_preregistered_policy_missing'))
eq(admission.admitted_to_production_registry,false)

// J — regression/development provenance is rejected regardless of innocent specimen naming.
for(const source of ['regression_fixture','development_fixture'] as const){
  const result=ingestSemanticCalibrationCorpus(manifest('independent_real_image',{specimenSource:source}))
  eq(result.accepted,false)
  ok(result.reason_codes.includes('fixture_provenance_forbidden'))
}

// K — sealed blind provenance is rejected without reading or materializing F/G fixtures.
{
  const result=ingestSemanticCalibrationCorpus(manifest('independent_real_image',{specimenSource:'sealed_blind_fixture'}))
  eq(result.accepted,false);ok(result.reason_codes.includes('sealed_fixture_forbidden'))
}

// L — synthetic corpus can exercise math but never becomes production source.
eq(syntheticIngest.accepted,true)
eq(syntheticValidation.valid,true)
eq(syntheticValidation.production_eligible_source,false)
ok(syntheticValidation.reason_codes.includes('synthetic_dataset_not_production_eligible'))

// M — duplicate image SHA cannot masquerade as independent images.
{
  const result=ingestSemanticCalibrationCorpus(manifest('synthetic_test',{specimenSplits:['calibration','calibration'],imageHashes:[hash(31),hash(31)]}))
  eq(result.accepted,false);ok(result.reason_codes.includes('duplicate_image_sha256'))
}

// N — same image SHA across splits is explicitly rejected.
{
  const result=ingestSemanticCalibrationCorpus(manifest('synthetic_test',{
    specimenSplits:['calibration'],imageHashes:[hash(32)],
    secondSpecimen:{source:'synthetic_test',split:'validation',hash:hash(32)},
  }))
  eq(result.accepted,false);ok(result.reason_codes.includes('cross_split_image_sha256'))
}

// O — same physical specimen across calibration + validation is invalid.
{
  const result=ingestSemanticCalibrationCorpus(manifest('synthetic_test',{specimenSplits:['calibration','validation'],imageHashes:[hash(33),hash(34)]}))
  eq(result.accepted,false);ok(result.reason_codes.includes('specimen_split_leakage'))
}

// P — same specimen may have multiple distinct images inside one split.
{
  const result=ingestSemanticCalibrationCorpus(manifest('synthetic_test',{specimenSplits:['calibration','calibration'],imageHashes:[hash(35),hash(36)]}))
  eq(result.accepted,true);ok(result.dataset);eq(validateSemanticCalibrationDataset(result.dataset).valid,true)
}

// Q — GT self-labeling by the sensor is rejected.
{
  const result=ingestSemanticCalibrationCorpus(manifest('synthetic_test',{selfLabel:true}))
  eq(result.accepted,false);ok(result.reason_codes.includes('ground_truth_self_label_forbidden'))
}

// Observation helper for R/S/T/U and fit-validation isolation.
function record(
  specimen_id:string,
  image_id:string,
  image_sha256:string,
  value:string,
  state:SemanticSensorObservationRecordV1['state']='observed',
  run_id=`run-${specimen_id}-${image_id}`,
):SemanticSensorObservationRecordV1{
  return {
    schema_version:SEMANTIC_SENSOR_OBSERVATION_RECORD_SCHEMA,
    specimen_id,image_id,feature_id:'drive.form',observation_stage:'candidate_blind_first_pass',
    sensor_type:'vlm',model:'mock-vlm',model_version:'v2',prompt_version:'prompt-v1',
    extractor_version:'extractor-v1',taxonomy_version:SEMANTIC_TAXONOMY_VERSION,
    value,state,visibility:state==='not_visible'?'not_visible':'visible',raw_score:null,
    observed_at:'2026-10-02T00:00:00Z',run_id,image_sha256,crop_ref:'full_image_1',
    independence_group:'full_image_1',ground_truth_in_prompt:false,
  }
}

// R — calibration observations explicitly prove GT was not in the sensor prompt.
const blindRecord=record('s1','i1',hash(40),'external_hex')
eq(assertObservationCandidateBlind(blindRecord).ground_truth_in_prompt,false)
throws(()=>assertObservationCandidateBlind({...blindRecord,ground_truth_in_prompt:true} as any),/ground_truth_in_prompt_forbidden/)

// S/T — categorical confusion counts are deterministic and abstentions remain denominator outcomes.
const truth:Record<string,string>={
  e1:'external_hex',e2:'external_hex',e3:'external_hex',e4:'external_hex',
  h1:'hex_socket',h2:'hex_socket',h3:'hex_socket',h4:'hex_socket',
}
const confusionRecords=[
  record('e1','e1',hash(41),'external_hex','observed'),
  record('e2','e2',hash(42),'unknown','unknown'),
  record('e3','e3',hash(43),'open_set','open_set'),
  record('e4','e4',hash(44),'integral_flange_absent','not_observed'),
  record('h1','h1',hash(45),'hex_socket','observed'),
  record('h2','h2',hash(46),'hex_socket','observed'),
  record('h3','h3',hash(47),'ambiguous','ambiguous'),
  record('h4','h4',hash(48),'not_visible','not_visible'),
]
const model=fitCategoricalConfusionModel('drive.form',confusionRecords,truth)
eq(model.row_totals.external_hex,4);eq(model.row_totals.hex_socket,4)
eq(model.counts.external_hex.external_hex,1)
eq(model.counts.external_hex.unknown,1)
eq(model.counts.external_hex.open_set,1)
eq(model.counts.external_hex.not_observed,1)
eq(model.counts.hex_socket.hex_socket,2)
eq(model.counts.hex_socket.ambiguous,1)
eq(model.counts.hex_socket.not_visible,1)
eq(model.empirical_frequencies.external_hex.unknown,.25)
for(const abstention of ['unknown','ambiguous','not_visible','open_set','not_observed']) ok(model.outcomes.includes(abstention))

// U — score calibrator refuses to invent a score when raw_score is null.
throws(()=>requireRawScoreForScoreCalibrator(null),/raw_score_required_for_score_calibrator/)

// V — missing runtime quality stays missing/unknown; no 0x0 or axial fabrication.
const missingQuality=buildSemanticRuntimeQuality('visible',{})
eq(missingQuality.width_px,null);eq(missingQuality.height_px,null)
eq(missingQuality.viewpoint,'unknown');eq(missingQuality.capture_type,'unknown');eq(missingQuality.crop_type,'unknown')
eq(readImageDimensionsFromBase64('not-an-image'),null)

// W — quality out of artifact scope fails closed before any production use.
resolution=resolveSemanticCalibrationArtifact({...runtime,quality:{...runtime.quality,viewpoint:'side'}},[v2],[],policy,[activeEntry])
eq(resolution.status,'out_of_scope')

// X — candidate/development artifact not explicitly activated is invisible to production resolver.
resolution=resolveSemanticCalibrationArtifact(runtime,[v2],[],policy,[])
eq(resolution.status,'policy_ineligible')
ok(resolution.reason_codes.includes('artifact_not_active_in_registry'))

// Extra: fitting uses calibration split only; held-out validation uses validation split only.
const fitManifest:SemanticCalibrationCorpusManifest={
  schema_version:SEMANTIC_CALIBRATION_CORPUS_MANIFEST_SCHEMA,
  dataset_id:'split-isolation-test',dataset_version:'1.0.0',created_at:'2026-10-02T00:00:00Z',
  source_scope:'synthetic_test',source_provenance:{source_class:'synthetic_test',source_ref:'unit-test',independent_acquisition:false},
  feature_scope:['drive.form'],sensor_scope:['vlm'],
  specimens:[
    {specimen_id:'cal-spec',provenance:{source_class:'synthetic_test',source_ref:'unit-test',physical_identity_verified:true},
     images:[{image_id:'cal-img',sha256:hash(50),source_ref:'memory://cal',capture_type:'axial_head',viewpoint:'axial',crop_type:'head_crop',width_px:512,height_px:512,visibility:'clear',occlusion_condition:'none',glare_condition:'none',split:'calibration'}],
     ground_truth:[{feature_id:'drive.form',value:'external_hex',verification_method:'physical_inspection',gt_source:'unit-test',annotator_or_fixture_provenance:'unit-test',schema_version:'gt.v1',self_labeled_by_sensor:false}]},
    {specimen_id:'val-spec',provenance:{source_class:'synthetic_test',source_ref:'unit-test',physical_identity_verified:true},
     images:[{image_id:'val-img',sha256:hash(51),source_ref:'memory://val',capture_type:'axial_head',viewpoint:'axial',crop_type:'head_crop',width_px:512,height_px:512,visibility:'clear',occlusion_condition:'none',glare_condition:'none',split:'validation'}],
     ground_truth:[{feature_id:'drive.form',value:'external_hex',verification_method:'physical_inspection',gt_source:'unit-test',annotator_or_fixture_provenance:'unit-test',schema_version:'gt.v1',self_labeled_by_sensor:false}]},
  ],
}
const fitIngest=ingestSemanticCalibrationCorpus(fitManifest);ok(fitIngest.dataset)
const estimator:CalibrationEstimatorConfigV1={
  config_id:'confusion-test',config_version:'v1',feature_id:'drive.form',
  sensor_identity:{...sensorIdentity,taxonomy_version:SEMANTIC_TAXONOMY_VERSION},
  estimator:{method:'categorical_confusion_counts',smoothing:'none'},eligibility_policy_version:null,locked:true,
}
const calRecord=record('cal-spec','cal-img',hash(50),'external_hex','observed','cal-run')
const valRecord=record('val-spec','val-img',hash(51),'external_hex','observed','val-run')
const fit=fitSemanticCalibrationArtifact(fitIngest.dataset,[calRecord],estimator)
eq(fit.schema_version,SEMANTIC_CALIBRATION_FIT_SCHEMA);eq(fit.status,'candidate_artifact')
eq(fit.calibration_record_ids.length,1);eq(fit.calibration_record_ids[0],'cal-run')
const fitArtifact=buildSemanticCalibrationArtifactFromFit(fit,{
  calibration_id:'split-isolation-artifact',version:'1.0.0',status:'synthetic_test_only',
  calibration_method:{method_id:'categorical_confusion_counts',method_version:'v1'},
  applicability_scope:{visibility:['visible'],capture_types:['axial_head'],viewpoints:['axial'],crop_types:['head_crop'],resolution:{min_width_px:256,min_height_px:256,max_width_px:1024,max_height_px:1024},occlusion_conditions:['none'],glare_conditions:['none']},
  metrics:{brier_score:null,log_loss:null,ece:null,ece_policy_version:null,sample_count:1,per_class_support:{external_hex:1}},
  eligibility_policy_version:null,
})
const validation=validateCalibrationArtifact(fitArtifact,fit,fitIngest.dataset,[valRecord])
eq(validation.status,'validated');eq(validation.validation_record_ids.length,1);eq(validation.validation_record_ids[0],'val-run')
eq(validation.validation_used_for_tuning,false)

// Y/Z — Phase 2E cannot mutate formal candidate universe or decision.
const measurement={
  schema_version:MEASUREMENT_V2_SCHEMA,
  observations:[{quantity:'D',value_mm:13.700},{quantity:'P',value_mm:2.051},{quantity:'L_underhead',value_mm:47.540}],
  uncertainty:{schema_version:'hcsi.measurement-uncertainty.v1',quantities:[],primitives:[],
    covariance:{quantities:[],matrix_mm2:[],status:'not_estimated',null_semantics:'not_estimated',note:'phase2e'},
    systematic_bias_ledger:[],systematic_bias_status:'not_estimated'},
} as unknown as MeasurementV2
const authority=buildStandardsAuthorityResult(measurement,STANDARDS_CATALOGUE_V1)
const beforeIds=authority.formal_candidates.map(c=>c.candidate_id)
const m14=authority.formal_candidates.find(c=>c.designation==='M14 × 2.0')
const u916=authority.formal_candidates.find(c=>c.designation==='9/16-12 UNC')
ok(m14&&u916)
const matrix=compileCandidateFeatureMatrix([m14,u916],CANDIDATE_FEATURE_METADATA_V1)
eq(matrix.discriminative_features.length,0)
const discrimination=buildCandidateSemanticDiscrimination(matrix,null,[])
eq(JSON.stringify(beforeIds),JSON.stringify(authority.formal_candidates.map(c=>c.candidate_id)))
eq(discrimination.numeric_score,null);eq(discrimination.posterior_probability,null)
eq(authority.decision.selected_candidate_id,null);eq(authority.decision.purchase_ready,false)
eq(discrimination.decision.selected_candidate_id,null);eq(discrimination.decision.purchase_ready,false)
eq((measurement.observations.find(x=>x.quantity==='D') as any).value_mm,13.700)
eq((measurement.observations.find(x=>x.quantity==='P') as any).value_mm,2.051)
eq((measurement.observations.find(x=>x.quantity==='L_underhead') as any).value_mm,47.540)
eq(authority.formal_candidates.some(c=>/#37-12/i.test(c.designation)),false)

console.log('Phase 2E semantic calibration corpus/admission regressions A-Z passed')
