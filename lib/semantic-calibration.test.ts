import { SEMANTIC_TAXONOMY_VERSION } from './semantic-taxonomy-v1'
import { SEMANTIC_EVIDENCE_SCHEMA,SEMANTIC_EXTRACTOR_VERSION,SEMANTIC_PROMPT_VERSION,type SemanticEvidenceV1,type SemanticObservation } from './semantic-evidence-v1'
import { SEMANTIC_REASON_CODE_TAXONOMY_VERSION } from './semantic-reason-codes-v1'
import { SEMANTIC_CALIBRATION_DATASET_SCHEMA,validateSemanticCalibrationDataset,type SemanticCalibrationDatasetV1 } from './semantic-calibration-dataset-v1'
import { SEMANTIC_CALIBRATION_SCHEMA,type SemanticCalibrationArtifactV1 } from './semantic-calibration-v1'
import { ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS } from './semantic-calibration-registry'
import { SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_SCHEMA,type SemanticCalibrationEligibilityPolicyV1 } from './semantic-calibration-policy-v1'
import { multiclassBrierScore,multiclassLogLoss,expectedCalibrationError,reliabilityBins } from './semantic-calibration-metrics'
import { assessSemanticLikelihoodEligibility,type SemanticRuntimeCalibrationContext } from './semantic-likelihood-eligibility'
import { buildSemanticCalibrationAssessment } from './semantic-calibration-assessment'
import { buildSemanticLikelihoodEvidence } from './semantic-likelihood-evidence-v1'
import { buildCandidateSemanticDiscrimination } from './candidate-semantic-discrimination'
import { compileCandidateFeatureMatrix } from './candidate-feature-compiler'
import { CANDIDATE_FEATURE_METADATA_V1 } from './candidate-feature-metadata-v1'
import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { buildStandardsAuthorityResult } from './standards-shadow-solver'
import { MEASUREMENT_V2_SCHEMA,type MeasurementV2 } from './measurement-v2'

function ok(v:unknown,m='assertion failed'):asserts v{if(!v)throw new Error(m)}
function eq(a:unknown,b:unknown,m='values differ'){if(a!==b)throw new Error(`${m}: ${String(a)} !== ${String(b)}`)}
function near(a:number,b:number,e=1e-12){if(Math.abs(a-b)>e)throw new Error(`${a} != ${b}`)}

const sha=(n:number)=>n.toString(16).padStart(64,'0')
function dataset(scope:SemanticCalibrationDatasetV1['source_scope']='synthetic_test',splits:('calibration'|'validation')[]=['calibration']):SemanticCalibrationDatasetV1{
 return {
  schema_version:SEMANTIC_CALIBRATION_DATASET_SCHEMA,dataset_id:'semantic-test-v1',dataset_version:'1.0.0',created_at:'2026-10-02T00:00:00Z',
  source_scope:scope,source_provenance:{source_class:scope,source_ref:'unit-test-only',independent_acquisition:scope==='independent_real_image'},
  specimens:[{specimen_id:'specimen-001',provenance:{source_class:scope,source_ref:'unit-test-only',physical_identity_verified:true},
   images:splits.map((split,i)=>({image_id:`img-${i}`,sha256:sha(i+1),source_ref:`memory://img-${i}`,split,capture_type:'axial_head',viewpoint:'axial',crop_type:'head_crop',width_px:512,height_px:512,visibility:'clear',occlusion_condition:'none',glare_condition:'none'})),
   ground_truth:[{feature_id:'drive.form',value:'external_hex',gt_source:'independent_fixture',verification_method:'physical_inspection',annotator_or_fixture_provenance:'unit-test-ledger',schema_version:'gt.v1'}]}],
  split_policy:{unit:'physical_specimen',allowed_splits:['fit','calibration','validation'],specimen_may_cross_splits:false},feature_scope:['drive.form'],sensor_scope:['vlm'],
  capture_conditions:{capture_types:['axial_head'],viewpoints:['axial'],crop_types:['head_crop'],visibility:['clear'],occlusion_conditions:['none'],glare_conditions:['none']},
  ground_truth_policy:{independently_verified:true,same_sensor_self_label_forbidden:true,provenance_required:true},
 }
}
const policy:SemanticCalibrationEligibilityPolicyV1={
 schema_version:SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_SCHEMA,policy_id:'unit-test-policy',policy_version:'test-v1',status:'preregistered',
 created_at:'2026-10-02T00:00:00Z',locked_at:'2026-10-02T00:00:00Z',applicable_dataset_schema:SEMANTIC_CALIBRATION_DATASET_SCHEMA,applicable_calibration_schema:SEMANTIC_CALIBRATION_SCHEMA,
 allowed_source_scopes:['independent_real_image'],required_split_policy:{unit:'physical_specimen',calibration_required:true,validation_required:true},
 required_gt_policy:{independently_verified:true,same_sensor_self_label_forbidden:true,provenance_required:true},
 minimum_support:{sample_count:null,per_class:null},metric_requirements:{max_brier_score:null,max_log_loss:null,max_ece:null},
 quality_coverage_requirements:{required:false,description:'unit test only'},artifact_identity_requirements:{exact_sensor_identity:true,exact_feature:true,exact_taxonomy:true},
 admission_rules:[],change_control:{requires_new_version:true,validation_set_must_not_tune_estimator:true},
}
function artifact():SemanticCalibrationArtifactV1{
 return {schema_version:SEMANTIC_CALIBRATION_SCHEMA,calibration_id:'cal-v1',version:'1.0.0',status:'validated',
  sensor_identity:{sensor_type:'vlm',model:'mock-vlm',model_version:'v1',prompt_version:'prompt-v1',extractor_version:'extractor-v1'},
  feature_id:'drive.form',taxonomy_version:SEMANTIC_TAXONOMY_VERSION,dataset_id:'semantic-test-v1',dataset_version:'1.0.0',
  calibration_method:{method_id:'categorical_confusion_counts',method_version:'test-v1'},calibration_payload:null,
  applicability_scope:{visibility:['visible'],capture_types:['axial_head'],viewpoints:['axial'],crop_types:['head_crop'],resolution:{min_width_px:256,min_height_px:256,max_width_px:1024,max_height_px:1024},occlusion_conditions:['none'],glare_conditions:['none']},
  metrics:{brier_score:null,log_loss:null,ece:null,ece_policy_version:null,sample_count:100,per_class_support:{external_hex:50,hex_socket:50}},
  eligibility_policy_version:'test-v1'}
}
const runtime:SemanticRuntimeCalibrationContext={feature_id:'drive.form',sensor_type:'vlm',model:'mock-vlm',model_version:'v1',prompt_version:'prompt-v1',extractor_version:'extractor-v1',taxonomy_version:SEMANTIC_TAXONOMY_VERSION,
 quality:{visibility:'visible',capture_type:'axial_head',viewpoint:'axial',crop_type:'head_crop',width_px:512,height_px:512,occlusion_condition:'none',glare_condition:'none'}}

// A — empty production registry means no artifact, no probability.
eq(ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS.length,0)
let e=assessSemanticLikelihoodEligibility(runtime,null,null,null,null)
eq(e.likelihood_eligible,false);ok(e.reason_codes.includes('no_applicable_validated_calibration_artifact'))

const ds=dataset('synthetic_test'),dv=validateSemanticCalibrationDataset(ds);eq(dv.valid,true);eq(dv.production_eligible_source,false)
// B-E/F mismatch and scope checks remain fail closed even on test-only corpus.
e=assessSemanticLikelihoodEligibility({...runtime,model_version:'v2'},artifact(),ds,dv,policy);eq(e.likelihood_eligible,false);ok(e.reason_codes.includes('artifact_identity_mismatch'))
e=assessSemanticLikelihoodEligibility({...runtime,prompt_version:'prompt-v2'},artifact(),ds,dv,policy);eq(e.likelihood_eligible,false);ok(e.reason_codes.includes('artifact_identity_mismatch'))
e=assessSemanticLikelihoodEligibility({...runtime,feature_id:'head.morphology'},artifact(),ds,dv,policy);eq(e.likelihood_eligible,false);ok(e.reason_codes.includes('artifact_identity_mismatch'))
e=assessSemanticLikelihoodEligibility({...runtime,taxonomy_version:'taxonomy-v2'},artifact(),ds,dv,policy);eq(e.likelihood_eligible,false);ok(e.reason_codes.includes('artifact_identity_mismatch'))
e=assessSemanticLikelihoodEligibility({...runtime,quality:{...runtime.quality,viewpoint:'side'}},artifact(),ds,dv,policy);eq(e.likelihood_eligible,false);ok(e.reason_codes.includes('runtime_quality_out_of_scope'))

// G/H/I source classes stay non-production.
for(const scope of ['regression_fixture','development_fixture','sealed_blind_fixture','synthetic_test'] as const){
 const v=validateSemanticCalibrationDataset(dataset(scope));eq(v.production_eligible_source,false)
}
const leak=dataset('synthetic_test',['calibration','validation']);eq(validateSemanticCalibrationDataset(leak).valid,false)
const same=dataset('synthetic_test',['calibration','calibration'])
// hashes are unique, same specimen/same split is structurally valid.
eq(validateSemanticCalibrationDataset(same).valid,true)

// L — deterministic multiclass calibration metrics.
const probs=[[.9,.1],[.2,.8],[.7,.3],[.4,.6]],labels=[0,1,1,0]
near(multiclassBrierScore(probs,labels),.45);near(multiclassLogLoss(probs,labels),.6121919007930318);near(expectedCalibrationError([.9,.8,.7,.6],[1,1,0,0],2),.25)
eq(reliabilityBins([.9,.8,.7,.6],[1,1,0,0],2).reduce((s,b)=>s+b.count,0),4)

const observation:SemanticObservation={feature_id:'drive.form',feature_family:'drive_form',value:'external_hex',state:'observed',visibility:'visible',raw_score:null,calibrated_probability:null,calibration_status:'uncalibrated',source:'sensor-1',evidence_refs:['full_image_1'],independence_group:'full_image_1',reason_codes:[],freeform_description:null,raw_text:null,normalized_text:null,character_confidence:null}
const semantic:SemanticEvidenceV1={schema_version:SEMANTIC_EVIDENCE_SCHEMA,taxonomy_version:SEMANTIC_TAXONOMY_VERSION,reason_code_taxonomy_version:SEMANTIC_REASON_CODE_TAXONOMY_VERSION,extractor_version:SEMANTIC_EXTRACTOR_VERSION,observation_scope:{mode:'candidate_blind_first_pass',image_sha256:'a'.repeat(64),target_region_ref:'full_image_1',physical_measurements_included:false,standards_candidates_included:false,legacy_nominal_included:false,ground_truth_included:false},observations:[observation],unknown_or_open_set:[],evidence_sources:[{evidence_ref:'sensor-1',sensor_type:'vlm',model:'mock-vlm',model_version:'v1',prompt_version:SEMANTIC_PROMPT_VERSION,crop_ref:'full_image_1',image_sha256:'a'.repeat(64)}],independence_groups:[{group_id:'full_image_1',crop_ref:'full_image_1',image_sha256:'a'.repeat(64),description:'shared crop'}],quality:{status:'usable',reason_codes:[]}}
const before=JSON.stringify(semantic)
const assessment=buildSemanticCalibrationAssessment(semantic,[],{artifacts:[],datasets:[],active_policy:null,registry:[],image_base64:null})
eq(assessment.available,false);eq(assessment.items[0].likelihood_eligible,false);eq(assessment.items[0].calibrated_probability,null);eq(assessment.items[0].raw_score,null);eq(assessment.items[0].independence_group,'full_image_1')
const likelihood=buildSemanticLikelihoodEvidence(assessment);eq(likelihood.available,false);eq(likelihood.items[0].log_likelihood,null);eq(likelihood.items[0].calibrated_log_likelihood_ratio,null)
eq(JSON.stringify(semantic),before)

// M-N-O — no qualitative-to-numeric mapping, candidate universe and decision unchanged.
const measurement={schema_version:MEASUREMENT_V2_SCHEMA,observations:[{quantity:'D',value_mm:13.700},{quantity:'P',value_mm:2.051},{quantity:'L_underhead',value_mm:47.540}],uncertainty:{schema_version:'hcsi.measurement-uncertainty.v1',quantities:[],primitives:[],covariance:{quantities:[],matrix_mm2:[],status:'not_estimated',null_semantics:'not_estimated',note:'2d'},systematic_bias_ledger:[],systematic_bias_status:'not_estimated'}} as unknown as MeasurementV2
const authority=buildStandardsAuthorityResult(measurement,STANDARDS_CATALOGUE_V1)
const m14=authority.formal_candidates.find(c=>c.designation==='M14 × 2.0')!,u916=authority.formal_candidates.find(c=>c.designation==='9/16-12 UNC')!;ok(m14&&u916)
const matrix=compileCandidateFeatureMatrix([m14,u916],CANDIDATE_FEATURE_METADATA_V1);eq(matrix.discriminative_features.length,0)
const discrimination=buildCandidateSemanticDiscrimination(matrix,semantic,[]);eq(JSON.stringify(discrimination.candidate_ids_before),JSON.stringify(discrimination.candidate_ids_after));eq(discrimination.numeric_score,null);eq(discrimination.posterior_probability,null);eq(discrimination.decision.selected_candidate_id,null);eq(discrimination.decision.purchase_ready,false)
eq((measurement.observations.find(x=>x.quantity==='D') as any).value_mm,13.700);eq((measurement.observations.find(x=>x.quantity==='P') as any).value_mm,2.051);eq((measurement.observations.find(x=>x.quantity==='L_underhead') as any).value_mm,47.540);eq(authority.formal_candidates.some(c=>/#37-12/i.test(c.designation)),false)
console.log('Phase 2D semantic calibration regressions A-O passed under Phase 2E authority separation')
